import type { JournalEntry } from '@/features/journal/types/journal.types';

/**
 * "On this day" — the same calendar date, in earlier years.
 *
 * The reason this exists is worth stating, because it is not a feature request:
 * a journal that only ever writes is a drawer. Everything you put in it goes one
 * way, and the reason to open the app tomorrow is duty. A journal that *gives
 * something back* — your own words from a year ago, unasked — is the difference
 * between a habit somebody keeps and a habit somebody abandons in March.
 *
 * It is also the cheapest emotional payload in the app. No new table, no sync,
 * no server: entries are already keyed by a `YYYY-MM-DD` string, so the whole
 * feature is a suffix match and a sort.
 *
 * ## Why the matching is on the string
 *
 * `entryDate` is stored as text, and the match is on the last five characters.
 * Parsing to `Date` and comparing month and day would go through the device's
 * timezone twice for no benefit, and it is exactly how an entry written at
 * 23:30 ends up filed under the wrong day.
 */

/** The `MM-DD` of a `YYYY-MM-DD` key. */
export function monthDay(dateKey: string): string {
  return dateKey.slice(5);
}

/** The year of a `YYYY-MM-DD` key, as a number. */
export function yearOf(dateKey: string): number {
  return Number(dateKey.slice(0, 4));
}

export type OnThisDayEntry = {
  entry: JournalEntry;
  /** How many years ago, for "1 year ago" / "3 years ago". Always >= 1. */
  yearsAgo: number;
};

/**
 * Past entries sharing today's month and day, most recent first.
 *
 * Deliberately excludes today itself. Somebody looking at "on this day" wants
 * the past, and showing them the entry they are currently writing beneath a
 * heading that says "a year ago" reads as a bug.
 *
 * ## The 29th of February
 *
 * A leap-day entry surfaces only on leap days, which is correct and slightly
 * sad — it is also what every alternative gets wrong. Mapping it onto the 28th
 * or the 1st means a March entry appearing under a February heading, and the
 * date shown would contradict the date stored. Rare and honest beats frequent
 * and wrong.
 */
export function onThisDay(entries: JournalEntry[], today: string): OnThisDayEntry[] {
  const target = monthDay(today);
  const thisYear = yearOf(today);

  return entries
    .filter((entry) => {
      if (entry.entryDate === today) return false;
      if (monthDay(entry.entryDate) !== target) return false;
      // A future-dated entry is not a memory. Guarded because nothing stops a
      // user backdating — or forward-dating — an entry by hand.
      return yearOf(entry.entryDate) < thisYear;
    })
    .map((entry) => ({ entry, yearsAgo: thisYear - yearOf(entry.entryDate) }))
    .sort((a, b) => a.yearsAgo - b.yearsAgo);
}

/**
 * A short preview of an entry's body.
 *
 * Cut on a word boundary rather than mid-word: a memory that opens with
 * "I remember thinking abo…" is a worse invitation to tap than one that stops
 * cleanly. Newlines collapse, because a card is one or two lines and a body
 * that starts with a blank line would render as an empty card.
 */
export function preview(body: string, limit = 120): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
