import { differenceInCalendarDays, isSameDay, subYears } from 'date-fns';

import type { AlbumPhoto } from '@/features/private/types/shared-album.types';

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
 */
export function onThisDay(photos: AlbumPhoto[], now = new Date()): OnThisDayMatch | null {
  const live = photos.filter((p) => p.remotePath !== null);
  if (live.length === 0) return null;

  for (let years = 1; years <= 15; years += 1) {
    const target = subYears(now, years);
    const match = live.find((p) => isSameDay(new Date(p.createdAt), target));
    if (match) return { photo: match, yearsAgo: years };
  }

  const oldest = [...live].sort((a, b) => a.createdAt - b.createdAt)[0];
  const days = differenceInCalendarDays(now, new Date(oldest.createdAt));
  if (days >= 365) return { photo: oldest, yearsAgo: Math.floor(days / 365) };

  return null;
}
