import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { getTableName, is, Table } from 'drizzle-orm';

import { getDb, getRawDb } from '@/database/client';
import * as schema from '@/database/schema';

/**
 * Restores a `daykeep-export-*.json` file produced by data-export.ts.
 *
 * The export existed without a counterpart, which made it a file you could
 * generate and then do nothing with. That is not a backup — it only becomes one
 * once it can be put back. Reinstalling the APK (a different signing key, or a
 * plain uninstall/install) drops the app's entire private storage: SQLite and
 * AsyncStorage both go. Without a restore path that is unrecoverable, and the
 * user has no way to know it until it has already happened.
 *
 * ## Merge, not replace
 *
 * Rows go in with `INSERT OR REPLACE` keyed on the primary key, so a restore
 * adds what is missing and refreshes what it recognises, leaving anything
 * created since the export alone. Wiping first would be simpler to reason about
 * and much easier to regret: restoring an older backup would silently destroy
 * newer work, with no undo.
 *
 * ## Schema drift
 *
 * A backup can be older than the app. Columns are intersected with what the
 * table actually has now (`PRAGMA table_info`), so a file written before a
 * column existed still restores, and one written after a column was removed
 * does not fail on it. Missing columns take their schema defaults.
 *
 * ## What it cannot bring back
 *
 * Media files. Imported songs, gallery photos and videos, and voice notes live
 * on disk and the database only stores their paths — the JSON never contained
 * them. Those rows restore with URIs pointing at files that are gone. Counted
 * and reported rather than hidden, so the gap is visible immediately instead of
 * being discovered as a broken thumbnail weeks later.
 */

export type ImportResult =
  | { ok: true; tables: number; rows: number; missingMedia: number }
  | { ok: false; reason: 'cancelled' | 'unreadable' | 'not-a-backup' | 'failed'; detail?: string };

/** Export key (`noteTagLinks`) → SQL table name (`note_tag_links`), derived from
 *  the drizzle schema so the two can never drift apart. */
function tableNamesByExportKey(): Record<string, string> {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(schema)) {
    if (is(value, Table)) entries.push([key, getTableName(value)]);
  }
  return Object.fromEntries(entries);
}

/** Columns that table currently has, for intersecting against the backup. */
function columnsOf(table: string): Set<string> {
  return new Set(
    getRawDb()
      .getAllSync<{ name: string }>(`PRAGMA table_info(${table})`)
      .map((row) => row.name),
  );
}

/** SQLite accepts null, number, string and blob — everything else (objects that
 *  sneak into a JSON column, booleans) has to be coerced or it throws mid-import. */
function toSqlValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return JSON.stringify(value);
}

/** Rows whose media file the database points at but which no longer exists. */
const MEDIA_URI_COLUMNS = ['uri', 'file_uri', 'thumbnail_uri', 'poster_uri'];

function countMissingMedia(table: string, columns: Set<string>, rows: Record<string, unknown>[]) {
  const uriColumns = MEDIA_URI_COLUMNS.filter((c) => columns.has(c));
  if (uriColumns.length === 0) return 0;
  let missing = 0;
  for (const row of rows) {
    for (const column of uriColumns) {
      const uri = row[column];
      if (typeof uri !== 'string' || !uri.startsWith('file://')) continue;
      try {
        if (!new File(uri).exists) missing++;
      } catch {
        missing++;
      }
    }
  }
  return missing;
}

/** Opens the picker, then restores whatever the chosen file contains. */
export async function importDataFromFile(): Promise<ImportResult> {
  let text: string;
  try {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return { ok: false, reason: 'cancelled' };
    text = new File(picked.assets[0].uri).textSync();
  } catch (error) {
    return { ok: false, reason: 'unreadable', detail: describe(error) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-a-backup' };
  }

  return importParsedData(parsed);
}

/** The restore itself, separated from the picker so it can be tested and reused. */
export function importParsedData(parsed: unknown): ImportResult {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'not-a-backup' };
  }

  const payload = parsed as Record<string, unknown>;
  const byKey = tableNamesByExportKey();
  // A backup names at least one known table. Without this any JSON file at all
  // would "restore successfully" while doing nothing.
  const known = Object.keys(payload).filter((key) => key in byKey);
  if (known.length === 0) return { ok: false, reason: 'not-a-backup' };

  getDb();
  const raw = getRawDb();

  let tables = 0;
  let rows = 0;
  let missingMedia = 0;

  raw.execSync('BEGIN');
  try {
    for (const key of known) {
      const value = payload[key];
      if (!Array.isArray(value) || value.length === 0) continue;

      const table = byKey[key];
      const columns = columnsOf(table);
      if (columns.size === 0) continue; // table no longer exists in this build

      const records = value.filter(
        (row): row is Record<string, unknown> => typeof row === 'object' && row !== null,
      );
      if (records.length === 0) continue;

      missingMedia += countMissingMedia(table, columns, records);

      for (const record of records) {
        const present = Object.keys(record).filter((c) => columns.has(c));
        if (present.length === 0) continue;

        // Column names come from the intersection with PRAGMA table_info, so
        // they are real identifiers from this database — never raw input.
        const placeholders = present.map(() => '?').join(', ');
        raw.runSync(
          `INSERT OR REPLACE INTO ${table} (${present.join(', ')}) VALUES (${placeholders})`,
          present.map((c) => toSqlValue(record[c])),
        );
        rows++;
      }
      tables++;
    }
    raw.execSync('COMMIT');
  } catch (error) {
    raw.execSync('ROLLBACK');
    return { ok: false, reason: 'failed', detail: describe(error) };
  }

  return { ok: true, tables, rows, missingMedia };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
