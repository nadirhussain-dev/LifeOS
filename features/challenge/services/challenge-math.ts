import type { ChallengeTier, ChecklistItem } from '@/features/challenge/types/challenge.types';

/**
 * The challenge arithmetic, mirrored on the client for display only.
 *
 * **The server is the authority.** Every function here has a counterpart in
 * `supabase/migrations/0048_streak_challenge.sql`, and where the two ever
 * disagree the migration is right and this file is a bug. Nothing here decides
 * whether a day counts — it exists so the app can draw "next shield in 12 days"
 * and "48 to the next rung" without a round trip, and so the picker can show
 * what a selection costs before anybody commits to a year of it.
 *
 * `challenge-math.test.ts` runs the same fixtures the SQL tests use
 * (scripts/test-migrations.mjs, "streak challenge (0048)") for exactly that
 * reason: two implementations of one rule drift silently unless something
 * checks them against the same numbers.
 */

/** The rung somebody stands on at a given number of qualified days; 0 for none. */
export function tierDayAt(tiers: ChallengeTier[], qualifiedDays: number): number {
  let best = 0;
  for (const t of tiers) {
    if (t.dayThreshold <= qualifiedDays && t.dayThreshold > best) best = t.dayThreshold;
  }
  return best;
}

/** The next rung above where they are, or `null` once the ladder is finished. */
export function nextTier(tiers: ChallengeTier[], qualifiedDays: number): ChallengeTier | null {
  let next: ChallengeTier | null = null;
  for (const t of tiers) {
    if (t.dayThreshold > qualifiedDays && (next === null || t.dayThreshold < next.dayThreshold)) {
      next = t;
    }
  }
  return next;
}

/**
 * Days left to the next rung.
 *
 * Always phrase progress against the *next* reward rather than the final one —
 * a target a year away exerts no pull, and the ladder exists precisely so there
 * is always a nearer number to quote.
 */
export function daysToNextTier(tiers: ChallengeTier[], qualifiedDays: number): number | null {
  const next = nextTier(tiers, qualifiedDays);
  return next === null ? null : next.dayThreshold - qualifiedDays;
}

/**
 * Days of clean running until the next shield, or `null` when the buffer is
 * already full and another one could not be granted.
 *
 * Mirrors the server's grant condition exactly, cap included: a shield arrives
 * when `perfectRun` next hits a multiple of the interval, and never while
 * already holding `shieldCap`.
 */
export function daysToNextShield(
  perfectRun: number,
  shieldEarnDays: number,
  shields: number,
  shieldCap: number,
): number | null {
  if (shields >= shieldCap) return null;
  if (shieldEarnDays <= 0) return null;
  const into = perfectRun % shieldEarnDays;
  return shieldEarnDays - into;
}

/**
 * Where progress would land if a day were lost right now — used to make the
 * at-risk warning specific ("this would cost you 3 days") instead of vague.
 *
 * A held shield absorbs the miss entirely, so the answer is "nothing changes".
 * Otherwise it is the kinder of the rung below and `maxDemotionDays` back,
 * which is the correction that stops the penalty inverting at the top of the
 * ladder: without the cap, a miss on day 8 costs one day and a miss on day 364
 * costs 64.
 */
export function demotionTarget(
  tiers: ChallengeTier[],
  qualifiedDays: number,
  recentMisses: number,
  maxDemotionDays: number,
  shields: number,
): number {
  if (shields > 0) return qualifiedDays;

  const below = (limit: number): number => {
    let best = 0;
    for (const t of tiers) {
      if (t.dayThreshold < limit && t.dayThreshold > best) best = t.dayThreshold;
    }
    return best;
  };

  // `recentMisses` is the count *before* this miss, so a second unshielded miss
  // inside the window steps one rung further down.
  let previous = below(qualifiedDays);
  if (recentMisses + 1 > 1) previous = below(previous);

  const floor = Math.max(qualifiedDays - maxDemotionDays, 0);
  return Math.min(qualifiedDays, Math.max(previous, floor));
}

/**
 * The shield interval somebody would get, given how many modules they commit to
 * and which plan they are on.
 *
 * Quoted in the picker, then resolved once by the server at enrolment and
 * stored on the run — a subscription lapsing mid-season must never silently
 * change the rules underneath somebody who is two hundred days in.
 *
 * More effort buys more forgiveness, never faster progress: the finish line is
 * the same number of days for everybody.
 */
export function resolveShieldEarnDays(
  base: number,
  floor: number,
  extraModules: number,
  isAnnualPlan: boolean,
): number {
  const fromExtras = extraModules >= 2 ? 5 : extraModules === 1 ? 3 : 0;
  const fromPlan = isAnnualPlan ? 5 : 0;
  return Math.max(base - fromExtras - fromPlan, floor);
}

/**
 * Today's checklist: one line per committed module, in the order committed.
 *
 * Built from the client's own buffered write counts so the tick lands the
 * instant somebody logs something, with no network in the way. It is display
 * state and nothing more — the day is credited only when the server says so.
 */
export function buildChecklist(
  required: string[],
  writes: Record<string, number>,
  minWrites: number,
): ChecklistItem[] {
  return required.map((moduleId) => {
    const n = writes[moduleId] ?? 0;
    return { moduleId, writes: n, done: n >= minWrites };
  });
}

/** The committed modules still untouched today. Drives the "one away" nudge. */
export function outstandingModules(
  required: string[],
  writes: Record<string, number>,
  minWrites: number,
): string[] {
  return buildChecklist(required, writes, minWrites)
    .filter((item) => !item.done)
    .map((item) => item.moduleId);
}

/** How long a chosen set of modules is likely to take each day, in minutes. */
export function estimatedDailyMinutes(
  moduleIds: string[],
  estSecondsByModule: Record<string, number>,
): number {
  const seconds = moduleIds.reduce((sum, id) => sum + (estSecondsByModule[id] ?? 60), 0);
  return Math.max(1, Math.round(seconds / 60));
}
