import { SYNC_MODULES } from '@/features/sync/config/sync-tables';

/**
 * Which module a database table belongs to.
 *
 * Derived from the sync registry rather than written out again, because that
 * registry already has to name every table a module owns — and has a contract
 * test holding it to that. A second hand-maintained list would drift the first
 * time somebody adds a table, and the symptom would be a module that quietly
 * stops counting toward the challenge for the people using its newest feature.
 *
 * It follows that **the challenge's module ids are the sync registry's keys**
 * (`habits`, `water`, `journal`, …), not the Hub's route ids. Whatever seeds
 * `challenge_modules` on the server has to use the same vocabulary; the column
 * is untyped text precisely so the vocabulary can be chosen here.
 */
const TABLE_TO_MODULE: Record<string, string> = Object.fromEntries(
  SYNC_MODULES.flatMap((m) => m.tables.map((t) => [t.name.toLowerCase(), m.key as string])),
);

/**
 * Tables that record something *about* a module rather than work done in it.
 *
 * A settings singleton is written when somebody changes a reminder time, which
 * is configuration, not use — and counting it would let a user hold a streak by
 * toggling a switch every evening. Excluded by suffix rather than by name so a
 * new module's settings table is excluded the day it is added.
 */
const CONFIGURATION_SUFFIX = '_settings';

/** The module a write belongs to, or `null` if it counts toward nothing. */
export function moduleForTable(table: string): string | null {
  const name = table.toLowerCase();
  if (name.endsWith(CONFIGURATION_SUFFIX)) return null;
  return TABLE_TO_MODULE[name] ?? null;
}

/** Every module id the attribution map can produce. */
export function attributableModules(): string[] {
  return [...new Set(Object.values(TABLE_TO_MODULE))].sort();
}
