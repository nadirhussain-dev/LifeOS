/**
 * Shared Notes' check-in framing — not a new backend concept, just what the
 * composer suggests writing about. A deterministic rotation (day-of-year mod
 * the prompt count) rather than anything random or server-fetched: both
 * partners opening the composer on the same calendar day see the identical
 * prompt, with no round-trip and no state to keep in sync.
 */

// Nested under the `private` namespace in the locale files (private.checkIn.*)
// — same as every other string this module uses.
const CHECK_IN_PROMPTS = [
  'private.checkIn.smile',
  'private.checkIn.onYourMind',
  'private.checkIn.gratefulFor',
  'private.checkIn.lookingForwardTo',
  'private.checkIn.proudOf',
  'private.checkIn.needFromEachOther',
  'private.checkIn.favoriteMoment',
  'private.checkIn.somethingNew',
  'private.checkIn.howAreWeDoing',
  'private.checkIn.hopeFor',
  'private.checkIn.missed',
  'private.checkIn.wantToRemember',
] as const;

/** Day-of-year, 1-indexed, in LOCAL time — same "never toISOString for a
 *  calendar boundary" rule as cycle-math.ts and together.ts. */
function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  const diffMs = date.getTime() - start.getTime();
  return Math.floor(diffMs / 86_400_000) + 1;
}

/** An i18n key (under `private.checkIn.*`) for today's prompt — the caller
 *  translates it, this file has no i18n dependency of its own. */
export function nextCheckInPrompt(date = new Date()): string {
  const index = dayOfYear(date) % CHECK_IN_PROMPTS.length;
  return CHECK_IN_PROMPTS[index];
}
