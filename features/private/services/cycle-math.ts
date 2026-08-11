import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';

/**
 * Cycle derivations, kept free of the encrypted store so they can be tested
 * directly — the same split as split-math.ts and habit-streaks.ts.
 *
 * Scope is deliberately narrow: describe what was logged and project the next
 * period from the person's own history. There is no fertility window and
 * nothing a reader could take as contraceptive guidance. That is a medical
 * claim, it is wrong often enough to matter, and being wrong about it changes
 * lives.
 */

export type Flow = 'spotting' | 'light' | 'medium' | 'heavy';

export const SYMPTOMS = [
  'cramps',
  'headache',
  'bloating',
  'fatigue',
  'backPain',
  'nausea',
  'tender',
  'acne',
  'cravings',
  'insomnia',
] as const;

export type Symptom = (typeof SYMPTOMS)[number];

export type CycleFields = {
  /** `YYYY-MM-DD`, and inside the ciphertext — the date is half the secret. */
  date: string;
  /** Null on a symptom-only day (PMS logged before bleeding starts). */
  flow: Flow | null;
  symptoms: Symptom[];
  /** 1–5, or null when not recorded. */
  mood: number | null;
  note: string;
  /** Celsius. No unit toggle — this app has no metric/imperial preference
   *  anywhere to hook into (checked water-intake, sleep, settings), so one
   *  canonical unit, same call the rest of the app already makes. */
  basalTempC: number | null;
  weightKg: number | null;
  /** Free-text, user-typed — no persisted "medication list" entity, just
   *  what was actually typed on this entry. */
  medications: string[];
  /** Same free-text shape as `medications`, for anything not already covered
   *  by the fixed `SYMPTOMS` list below. */
  customTags: string[];
  /** `vault-files.ts` filenames — the vault's encrypted file store is
   *  module-agnostic (addressed by opaque name, keyed only by the shared
   *  vault key), so a Cycle entry can reference files there directly without
   *  going through vault-items.ts, which is Vault-module-specific metadata. */
  photoFileNames: string[];
};

export type CycleEntry = CycleFields & { id: string; createdAt: number; updatedAt: number };

/** A run of bleeding days. A single missed day does not start a new one —
 * people forget to log, and treating that as a new period would double the
 * period count and halve every average built on it. */
export type Period = { start: string; end: string; days: number };

/**
 * All date arithmetic goes through date-fns calendar functions, never
 * milliseconds.
 *
 * Adding `28 * 86400000` to a local midnight lands an hour early across a
 * daylight-saving boundary, and the ISO date then reads as the *previous* day —
 * so a cycle predicted for 26 March displayed as 25 March, twice a year, for
 * anybody in a DST timezone. `addDays` and `differenceInCalendarDays` operate
 * on calendar fields and are immune to it.
 */
const toDate = (date: string) => parseISO(date);
const toKey = (date: Date) => format(date, 'yyyy-MM-dd');
const spanDays = (from: string, to: string) =>
  differenceInCalendarDays(toDate(to), toDate(from)) + 1;

export function periodsFrom(entries: CycleEntry[]): Period[] {
  const bleeding = entries
    .filter((e) => e.flow !== null)
    .map((e) => e.date)
    .sort();
  if (bleeding.length === 0) return [];

  const periods: Period[] = [];
  let start = bleeding[0];
  let previous = bleeding[0];

  for (const date of bleeding.slice(1)) {
    if (differenceInCalendarDays(toDate(date), toDate(previous)) > 2) {
      periods.push({ start, end: previous, days: spanDays(start, previous) });
      start = date;
    }
    previous = date;
  }
  periods.push({ start, end: previous, days: spanDays(start, previous) });

  // Newest first — every caller wants the current cycle.
  return periods.reverse();
}

/**
 * Mean gap between period starts, from this person's own history.
 *
 * Needs three periods before it answers. A single gap is a data point, not an
 * average, and presenting one as though it were is how a tracker ends up
 * confidently naming the wrong week.
 */
export function averageCycleLength(periods: Period[]): number | null {
  if (periods.length < 3) return null;

  const starts = periods.map((p) => p.start).sort();
  const gaps: number[] = [];
  for (let i = 1; i < starts.length; i += 1) {
    const gap = differenceInCalendarDays(toDate(starts[i]), toDate(starts[i - 1]));
    // Drop implausible gaps: a mistyped year is the common case, and without
    // this one bad date drags the mean into nonsense.
    if (gap >= 15 && gap <= 60) gaps.push(gap);
  }
  if (gaps.length < 2) return null;

  return Math.round(gaps.reduce((sum, g) => sum + g, 0) / gaps.length);
}

export function predictedNextStart(periods: Period[], averageLength: number | null): string | null {
  if (!averageLength || periods.length === 0) return null;
  return toKey(addDays(toDate(periods[0].start), averageLength));
}

/** Days since the most recent period started, counting its first day as 1. */
export function dayOfCycle(periods: Period[], now = new Date()): number | null {
  if (periods.length === 0) return null;
  return differenceInCalendarDays(now, toDate(periods[0].start)) + 1;
}

/**
 * Every distinct tag/medication string already used across `entries`,
 * newest-entry-first, deduped case-insensitively but returned in whichever
 * casing was typed first. Powers the tag input's autocomplete row — there is
 * no separate persisted "tag registry", this is the whole of it.
 */
export function distinctTags(
  entries: CycleEntry[],
  field: 'customTags' | 'medications',
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // entries is already newest-first (listCycleEntries sorts by date desc).
  for (const entry of entries) {
    for (const tag of entry[field]) {
      const key = tag.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(tag.trim());
    }
  }
  return out;
}
