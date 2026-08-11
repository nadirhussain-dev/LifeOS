import {
  addYears,
  differenceInCalendarDays,
  isSameDay,
  parseISO,
  setYear,
  subYears,
} from 'date-fns';

import type { AlbumMilestone, AlbumPhoto } from '@/features/private/types/shared-album.types';

/**
 * The couple-facing half of shared albums: not new data, purely rules over
 * what's already there — resurfacing an old photo, and noticing when "days
 * together" lands on a date worth pausing on. Kept as pure functions, same
 * split as cycle-math.ts and recovery-math.ts, so they're testable without a
 * screen or a decrypted photo in hand.
 */

/** Milestones "days together" (the album's own age — see together-strip.tsx)
 *  is checked against for the small celebration in TogetherStrip. Denser
 *  early on, when a new shared space is least likely to feel established
 *  yet and a nudge matters most; yearly after that. */
export const TOGETHER_MILESTONES = [7, 30, 100, 365, 500, 730, 1000, 1825, 3650] as const;

export type OnThisDayMatch = { photo: AlbumPhoto; yearsAgo: number };

/**
 * "On this day": the closest thing a photo album has to a reason to open it
 * unprompted. Looks for a photo taken exactly N years ago on today's date
 * first — the anniversary a couple actually notices — and falls back to the
 * oldest photo once the album itself is at least a year old, so a young
 * album isn't silently excluded from ever having a memory to show, it just
 * waits until it has one worth showing.
 *
 * Only ever looks at photos whose bytes have finished uploading
 * (`remotePath` set) — nothing here can decrypt anyway, decryption is the
 * caller's job once it has the album key.
 *
 * `maxYearsLookback` is the one knob a caller has: the screen that renders
 * this is what decides how far back "on this day" is allowed to reach (see
 * app/private/albums/[id].tsx, which passes a plan-gated value) — this
 * function stays free of any notion of a plan, same as every other pure
 * service in this codebase never importing billing. At 1, only the most
 * recent exact-anniversary match is ever returned and the oldest-photo
 * fallback is skipped entirely, since that fallback is itself a "look back
 * further" feature.
 */
export function onThisDay(
  photos: AlbumPhoto[],
  now = new Date(),
  maxYearsLookback = 15,
): OnThisDayMatch | null {
  const live = photos.filter((p) => p.remotePath !== null);
  if (live.length === 0) return null;

  for (let years = 1; years <= maxYearsLookback; years += 1) {
    const target = subYears(now, years);
    const match = live.find((p) => isSameDay(new Date(p.createdAt), target));
    if (match) return { photo: match, yearsAgo: years };
  }

  if (maxYearsLookback <= 1) return null;

  const oldest = [...live].sort((a, b) => a.createdAt - b.createdAt)[0];
  const days = differenceInCalendarDays(now, new Date(oldest.createdAt));
  if (days >= 365) return { photo: oldest, yearsAgo: Math.floor(days / 365) };

  return null;
}

/**
 * Custom milestones (migration 0039) — user-named, dated anniversaries
 * alongside TOGETHER_MILESTONES' day-count ones above. `milestoneDate` is
 * `yyyy-MM-dd`; for a `recurring` one only the month/day repeat, the stored
 * year is just whenever it was first entered.
 */

function recurringMatch(milestone: AlbumMilestone, now: Date): boolean {
  const stored = parseISO(milestone.milestoneDate);
  return stored.getMonth() === now.getMonth() && stored.getDate() === now.getDate();
}

/** Is today the day for any of these milestones? First match wins — ties are
 *  rare enough (one couple, one day) that "which one" rarely matters, and the
 *  caller can still render every entry from a full list if it does.
 *
 *  Generic over `T` (rather than fixed to `AlbumMilestone`) so a caller
 *  passing `DecryptedMilestone[]` (use-album-milestones.ts) gets a
 *  `DecryptedMilestone | null` back, with its extra decrypted `title` field
 *  intact — not just the base ciphertext shape. */
export function todaysMilestone<T extends AlbumMilestone>(
  milestones: T[],
  now = new Date(),
): T | null {
  return (
    milestones.find((m) =>
      m.recurring ? recurringMatch(m, now) : isSameDay(parseISO(m.milestoneDate), now),
    ) ?? null
  );
}

/**
 * The nearest milestone from today onward (today itself counts as 0 days
 * away, same as todaysMilestone would report it). A recurring milestone
 * whose month/day already passed this year rolls forward to next year; a
 * non-recurring one that's already in the past is skipped entirely — it
 * happened, it doesn't come back.
 */
export function nextMilestone<T extends AlbumMilestone>(
  milestones: T[],
  now = new Date(),
): { milestone: T; daysAway: number } | null {
  let best: { milestone: T; daysAway: number } | null = null;

  for (const milestone of milestones) {
    const stored = parseISO(milestone.milestoneDate);
    let next = milestone.recurring ? setYear(stored, now.getFullYear()) : stored;
    let daysAway = differenceInCalendarDays(next, now);
    if (milestone.recurring && daysAway < 0) {
      next = addYears(next, 1);
      daysAway = differenceInCalendarDays(next, now);
    }
    if (daysAway < 0) continue;
    if (!best || daysAway < best.daysAway) best = { milestone, daysAway };
  }

  return best;
}
