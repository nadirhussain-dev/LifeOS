import type { CycleEntry, CycleFields } from '@/features/private/services/cycle-math';
import {
  createPrivateRecord,
  deletePrivateRecord,
  getPrivateRecord,
  listPrivateRecords,
  updatePrivateRecord,
} from '@/features/private/services/private-repository';
import { deleteVaultFile } from '@/features/private/services/vault-files';

/**
 * Cycle records, through the encrypted store. The derivations live in
 * cycle-math.ts; this file is only the boundary between them and the vault.
 *
 * Every read normalises defensively. A payload written by an older build (or a
 * partially-written one) must degrade to a usable entry rather than crashing
 * the screen — there is no server-side schema to lean on here, and no way to
 * migrate rows we cannot decrypt without the user present.
 */
/** Normalises one decrypted row defensively — a payload written by an older
 *  build (or missing a field this build now expects) must degrade to a
 *  usable entry rather than crashing the screen. Shared by `listCycleEntries`
 *  and `getCycleEntry` so the two can never drift on what "usable" means. */
function normalise(r: Record<string, unknown>, id: string, createdAt: number, updatedAt: number): CycleEntry {
  return {
    id,
    createdAt,
    updatedAt,
    date: typeof r.date === 'string' ? r.date : '',
    flow: (r.flow as CycleEntry['flow']) ?? null,
    symptoms: Array.isArray(r.symptoms) ? (r.symptoms as CycleEntry['symptoms']) : [],
    mood: typeof r.mood === 'number' ? r.mood : null,
    note: typeof r.note === 'string' ? r.note : '',
    basalTempC: typeof r.basalTempC === 'number' ? r.basalTempC : null,
    weightKg: typeof r.weightKg === 'number' ? r.weightKg : null,
    medications: Array.isArray(r.medications) ? (r.medications as string[]) : [],
    customTags: Array.isArray(r.customTags) ? (r.customTags as string[]) : [],
    photoFileNames: Array.isArray(r.photoFileNames) ? (r.photoFileNames as string[]) : [],
  };
}

export function listCycleEntries(): CycleEntry[] {
  return listPrivateRecords<CycleFields>('cycle')
    .map((r) => normalise(r, r.id, r.createdAt, r.updatedAt))
    .filter((entry) => entry.date !== '')
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** One entry by id, or null if it doesn't exist (or the space is locked). */
export function getCycleEntry(id: string): CycleEntry | null {
  const record = getPrivateRecord<CycleFields>('cycle', id);
  if (!record) return null;
  const entry = normalise(record, record.id, record.createdAt, record.updatedAt);
  return entry.date === '' ? null : entry;
}

export function addCycleEntry(fields: CycleFields): string | null {
  return createPrivateRecord('cycle', fields);
}

/** First real caller of `updatePrivateRecord` (private-repository.ts) —
 *  every private-module screen until now was create + delete only. */
export function editCycleEntry(id: string, fields: CycleFields): boolean {
  return updatePrivateRecord('cycle', id, fields);
}

/**
 * Deletes an entry and every photo it attached.
 *
 * Takes the entry (not just an id) specifically so its `photoFileNames` can
 * be cleaned up first — a private_entries row is the only thing that ever
 * points at a vault file by name, so deleting the row without the files
 * first leaves sealed, unreferenced bytes on disk that nothing will ever
 * clean up short of destroying the whole space.
 */
export function removeCycleEntry(entry: Pick<CycleEntry, 'id' | 'photoFileNames'>): void {
  for (const fileName of entry.photoFileNames) deleteVaultFile(fileName);
  deletePrivateRecord(entry.id);
}
