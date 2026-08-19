import { sql } from 'drizzle-orm';

import { getDb } from '@/database/client';

/**
 * Full-text note search, with a LIKE fallback.
 *
 * `LIKE '%term%'` cannot use an index and scans every note body on every
 * keystroke. That is fine at fifty notes and visibly bad at several thousand,
 * which is exactly the user this module is built for — the one with wiki-links,
 * backlinks and templates.
 *
 * The fallback is not defensive padding. FTS5 is a compile-time SQLite option,
 * and while `node:sqlite` has it and op-sqlite is expected to, "expected" is not
 * "verified on every device this ships to" — see `buildSearchIndex`. A slower
 * search is an acceptable outcome; a search screen that throws is not.
 */

/** Resolved once per session. The answer cannot change while the app runs: the
 *  table either got created at bootstrap or it did not. */
let indexAvailable: boolean | null = null;

function hasSearchIndex(): boolean {
  if (indexAvailable !== null) return indexAvailable;
  try {
    getDb().run(sql`SELECT 1 FROM notes_fts LIMIT 1`);
    indexAvailable = true;
  } catch {
    indexAvailable = false;
  }
  return indexAvailable;
}

/**
 * Turns what somebody typed into an FTS5 query.
 *
 * Every token gets a `*` so search is incremental — "ren" finds "renovation"
 * while it is still being typed, which is what a search field is for.
 *
 * FTS5 has its own query syntax, so raw input is a syntax error waiting to
 * happen: a stray quote, a `NEAR`, a bare `*` or an unbalanced parenthesis all
 * throw. Tokens are therefore reduced to alphanumerics and quoted, which trades
 * the ability to write FTS queries — something no user of a notes app is trying
 * to do — for a search field that cannot be crashed by punctuation.
 */
export function toFtsQuery(input: string): string | null {
  const tokens = input
    .toLowerCase()
    // `\p{M}` — combining marks — is not optional. Devanagari matras and Arabic
    // diacritics are Marks, not Letters, so splitting on non-Letter/Number alone
    // tears Hindi and Urdu words apart mid-character: "रसोई" becomes "रस" and
    // "ई". The app ships in four languages and three of them are affected.
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"*`).join(' AND ');
}

/**
 * Note ids matching a query, most relevant first.
 *
 * Returns ids rather than notes so the caller keeps using the repository it
 * already trusts for shaping, soft-delete filtering and archive rules — this
 * function's only job is which notes, in what order.
 */
export function searchNoteIds(query: string, limit = 100): string[] {
  const trimmed = query.trim();
  if (trimmed === '') return [];

  if (hasSearchIndex()) {
    const match = toFtsQuery(trimmed);
    if (match === null) return [];
    try {
      const rows = getDb().all<{ note_id: string }>(sql`
        SELECT note_id FROM notes_fts
        WHERE notes_fts MATCH ${match}
        ORDER BY bm25(notes_fts, 0.0, 10.0, 1.0)
        LIMIT ${limit}
      `);
      return rows.map((row) => row.note_id);
    } catch {
      // A query FTS5 rejected despite the sanitising above. Falling through is
      // better than an empty result, which would read as "you have no notes
      // about this".
      indexAvailable = false;
    }
  }

  const like = `%${trimmed.toLowerCase()}%`;
  return getDb()
    .all<{ id: string }>(
      sql`
      SELECT id FROM notes
      WHERE deleted_at IS NULL
        AND (lower(title) LIKE ${like} OR lower(COALESCE(body, '')) LIKE ${like})
      LIMIT ${limit}
    `,
    )
    .map((row) => row.id);
}

/** Test seam: forgets the cached capability so both paths can be exercised. */
export function __resetSearchIndexCache(): void {
  indexAvailable = null;
}
