/**
 * Types for the streak challenge.
 *
 * Field names mirror the JSON the server hands back (`challenge_today()`,
 * `record_challenge_day()` — supabase/migrations/0048_streak_challenge.sql)
 * rather than the snake_case column names, because that is what the client
 * actually receives.
 */

/** One rung of the ladder. */
export type ChallengeTier = {
  /** Qualified days needed to stand on this rung. */
  dayThreshold: number;
  name: string;
  /**
   * Only ever `'digital'` while the engine ships without a prize. The field
   * exists from the first migration because the code that opens a claim keys
   * off it, and adding it later would mean backfilling a decision.
   */
  rewardKind: 'digital' | 'physical';
  rewardTitle: string | null;
  rewardDescription: string | null;
};

/**
 * The four counters, kept apart because they answer different questions.
 * See the header of 0048 for why collapsing them makes the mechanic
 * unexplainable to the person living with it.
 */
export type ChallengeRun = {
  seasonId: string;
  /** Progress toward the next rung — the number on screen. */
  qualifiedDays: number;
  /** Consecutive days with no miss of any kind. Earns shields, ages out misses. */
  perfectRun: number;
  shields: number;
  shieldEarnDays: number;
  tierDay: number;
};

/** Whether today is already in the ledger, and what it still owes. */
export type ChallengeToday = {
  enrolled: boolean;
  /** The *server's* idea of the local date. Never the device's. */
  localDay: string;
  required: string[];
  todayOutcome: 'qualified' | 'shielded' | 'missed' | null;
  minWrites: number;
};

/** One module's line in today's checklist. */
export type ChecklistItem = {
  moduleId: string;
  writes: number;
  /** Local evidence: this phone recorded enough writes. Instant, and on its own
   *  no longer sufficient — see `counts`. */
  done: boolean;
  /** The server witnessed a live write for this module today (0065). */
  attested: boolean;
  /** The season demands live writes, so `done` without `attested` is a line
   *  that will not credit the day. */
  liveRequired: boolean;
  /**
   * Whether this line will actually count toward today.
   *
   * The one field the UI should key its tick off. `done` and `counts` are the
   * same thing on a season without the live rule and deliberately diverge on
   * one with it — that divergence is the entire user-visible surface of 0065,
   * and collapsing the two back into one boolean is how somebody ends up
   * watching a green checklist fail at midnight.
   */
  counts: boolean;
};

/**
 * One day of the ledger, as the braid draws it.
 *
 * `modulesHit` is what makes a per-module strand possible at all: the outcome
 * alone says whether the day held, and only the array says *which* commitment
 * was the one that didn't.
 */
export type ChainDay = {
  localDay: string;
  outcome: 'qualified' | 'shielded' | 'missed';
  modulesHit: string[];
};
