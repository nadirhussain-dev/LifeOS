import { getTableName } from 'drizzle-orm';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { getDb } from '@/database/client';
import { HUB_SECTIONS } from '@/features/hub/config/modules';
import { privatisedModules } from '@/features/private/store/private-store';
import {
  budgetDebts,
  budgetSettings,
  budgetTransactions,
  calendarEvents,
  entryLinks,
  galleryAlbums,
  galleryPhotos,
  goalMilestones,
  goalProgressLogs,
  goals,
  habitCategories,
  habitLogs,
  habitRoutineItems,
  habitRoutines,
  habits,
  habitSkips,
  journalAttachments,
  journalEntries,
  journalPrompts,
  journalReflections,
  noteAttachments,
  noteCategories,
  noteTagLinks,
  noteTags,
  notes,
  playlists,
  playlistSongs,
  savingsGoals,
  sleepSessions,
  sleepSettings,
  songs,
  studySessions,
  studySettings,
  studySubjects,
  taskCategories,
  tasks,
  taskSubtasks,
  waterIntakeLogs,
} from '@/database/schema';

/**
 * Every table the export covers, keyed by the name it takes in the JSON.
 *
 * A map rather than a literal object of queries, so the set of tables and the
 * decision to *run* each query are separate — which is what makes skipping a
 * privatised module possible without hand-maintaining a second list of what to
 * skip. lib/data-coverage.test.ts asserts every schema table appears here.
 */
const EXPORT_TABLES = {
  taskCategories,
  tasks,
  taskSubtasks,
  noteCategories,
  notes,
  noteTags,
  noteTagLinks,
  noteAttachments,
  habitCategories,
  habits,
  habitLogs,
  habitSkips,
  habitRoutines,
  habitRoutineItems,
  journalEntries,
  journalPrompts,
  journalReflections,
  journalAttachments,
  entryLinks,
  calendarEvents,
  waterIntakeLogs,
  songs,
  playlists,
  playlistSongs,
  goals,
  goalMilestones,
  goalProgressLogs,
  sleepSessions,
  sleepSettings,
  studySubjects,
  studySessions,
  studySettings,
  budgetTransactions,
  savingsGoals,
  budgetSettings,
  budgetDebts,
  galleryAlbums,
  galleryPhotos,
} as const;

/**
 * SQL table names belonging to modules the user has moved behind the vault.
 *
 * Note this ignores whether the vault is currently unlocked. Somebody who has
 * chosen to keep their journal private has not asked for it to be excluded
 * *while locked* — they have asked for it not to end up in a JSON file that
 * lands in Files, a chat, or a cloud drive. Making the contents of a backup
 * depend on whether a PIN happened to be entered five minutes earlier would
 * also produce two silently different exports from the same button.
 */
function privatisedTables(): Set<string> {
  const privatised = privatisedModules();
  if (privatised.length === 0) return new Set();

  const tables = new Set<string>();
  for (const section of HUB_SECTIONS) {
    for (const module of section.modules) {
      if (privatised.includes(module.id)) {
        for (const table of module.tables) tables.add(table);
      }
    }
  }
  return tables;
}

/** Dumps every table to a single JSON file and opens the native share sheet —
 * the closest thing this local-only app has to a backup, since there's no
 * real account/cloud sync to restore from yet.
 *
 * `private_entries` is never here: see lib/data-coverage.test.ts. */
export async function exportAllData(): Promise<void> {
  const db = getDb();
  const skip = privatisedTables();

  const data: Record<string, unknown> = { exportedAt: new Date().toISOString() };
  const omitted: string[] = [];

  for (const [key, table] of Object.entries(EXPORT_TABLES)) {
    if (skip.has(getTableName(table))) {
      omitted.push(key);
      continue;
    }
    data[key] = db.select().from(table).all();
  }

  // Recorded in the file itself. An export that quietly contains less than the
  // user expects is how somebody wipes a device believing they have a backup —
  // so the gap is stated, by name, in the thing they keep.
  if (omitted.length > 0) data.omittedPrivateModules = omitted;

  const file = new File(Paths.cache, `daykeep-export-${Date.now()}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(data, null, 2));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: 'Export Daykeep data',
    });
  }
}
