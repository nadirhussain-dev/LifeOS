import type { ChallengeTier } from '@/features/challenge/types/challenge.types';

/**
 * What a season is doing, in one word.
 *
 * The vocabulary is the server's — `challenge_season_state()` in migration 0055
 * — and nothing in the client is allowed to invent a state of its own. That
 * constraint is the entire point of this file.
 *
 * The bug it exists to prevent already happened. The operator console called a
 * season open when it was enabled inside its date window; the app called it open
 * when it had modules to pick from. Both checks were correct, neither knew about
 * the other, and staging spent weeks showing "Open" to staff and "No season is
 * open right now" to every user. Two screens deriving the same fact from
 * different columns will always eventually disagree, and the disagreement is
 * invisible from either side.
 *
 * So there is one derivation, it lives in SQL next to the data, and both screens
 * quote it. This file only maps the word onto sentences.
 */
export type SeasonState =
  /** No season exists that a user has any business hearing about. */
  | 'none'
  /** Exists, switched off. Nobody can join, and running streaks are paused. */
  | 'closed'
  /** Switched on, but its start date has not arrived. */
  | 'upcoming'
  /** Switched on, past its end date. */
  | 'ended'
  /**
   * Switched on and inside its window, but with fewer eligible modules than it
   * asks people to commit to — so enrolment is impossible by construction.
   * The state staging was in, and the one with an operator fix.
   */
  | 'notReady'
  /** Joinable, except every seat is taken. */
  | 'full'
  /** Joinable right now. */
  | 'open';

/** What `challenge_season_status()` hands back. Server-owned; see 0055. */
export type SeasonStatus = {
  state: SeasonState;
  seasonId?: string;
  name?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  requiredModules?: number;
  moduleLockDays?: number;
  moduleSwapsAllowed?: number;
  minWrites?: number;
  shieldCap?: number;
  shieldEarnDays?: number;
  termsUrl?: string | null;
  /** Null when the season is uncapped. Zero is a real answer, not "unknown". */
  seatsLeft?: number | null;
  modules?: { moduleId: string; estDailySeconds: number }[];
  tiers?: ChallengeTier[];
};

/** The one state in which "Start a run" is a button that can succeed. */
export function canJoin(state: SeasonState): boolean {
  return state === 'open';
}

/**
 * Whether a day can still be earned.
 *
 * `full` counts: a full season is closed to newcomers and completely normal for
 * everybody already in it. Confusing "no room" with "stopped" would tell two
 * hundred people their streak had ended because a two-hundred-and-first person
 * could not start one.
 */
export function isRunning(state: SeasonState): boolean {
  return state === 'open' || state === 'full';
}

/** Whole days from `now` to `iso`, rounded up; negative once `iso` is past. */
export function daysUntil(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.ceil((then - now) / 86_400_000);
}

/**
 * The sentence a user gets, and the one an operator is told the user is getting.
 *
 * Returned as a key plus values rather than a formatted string so both callers
 * translate it themselves — the operator console and the app render the same
 * copy in whatever language each viewer reads.
 *
 * Every state ends somewhere useful. The screen this replaced had one dead end
 * for six different situations, all reading "No season is open right now",
 * which is why nobody — including the person who built it — could tell a season
 * that starts on Tuesday from one nobody had finished configuring.
 */
export type SeasonNotice = {
  titleKey: string;
  bodyKey: string;
  /** `count` is named for i18next's plural rules, which only look at that key. */
  values: { name: string; count: number };
  /**
   * The moment the copy refers to, unformatted.
   *
   * Handed over raw because a date has to be rendered in the *viewer's* locale
   * and calendar, and this function has no business knowing either. The caller
   * formats it and passes it in as `date`.
   */
  dateIso: string | null;
  /** `true` when the answer can change by itself, so the screen offers a retry. */
  retryable: boolean;
};

export function seasonNotice(status: SeasonStatus, now: number = Date.now()): SeasonNotice {
  const name = status.name ?? '';
  const opensIn = daysUntil(status.startsAt, now);
  const endsIn = daysUntil(status.endsAt, now);

  switch (status.state) {
    case 'upcoming':
      return {
        titleKey: 'challenge.stateUpcomingTitle',
        // A date somebody can put in a calendar beats "soon"; a countdown beats
        // the date for anything inside a fortnight. Both exist, and the gap
        // decides — which is the whole reason the server sends `startsAt`
        // rather than a pre-baked sentence.
        bodyKey:
          opensIn !== null && opensIn <= 14
            ? 'challenge.stateUpcomingSoon'
            : 'challenge.stateUpcomingOn',
        values: { name, count: Math.max(opensIn ?? 0, 0) },
        dateIso: status.startsAt ?? null,
        retryable: true,
      };
    case 'ended':
      return {
        titleKey: 'challenge.stateEndedTitle',
        bodyKey: 'challenge.stateEndedBody',
        values: { name, count: 0 },
        dateIso: status.endsAt ?? null,
        retryable: true,
      };
    case 'full':
      return {
        titleKey: 'challenge.stateFullTitle',
        bodyKey: 'challenge.stateFullBody',
        values: { name, count: 0 },
        dateIso: null,
        retryable: true,
      };
    case 'notReady':
      // Deliberately not "no season". Something is being built, the user did
      // nothing wrong, and it is worth coming back for — none of which the
      // blanket message this replaced managed to convey.
      return {
        titleKey: 'challenge.stateNotReadyTitle',
        bodyKey: 'challenge.stateNotReadyBody',
        values: { name, count: 0 },
        dateIso: null,
        retryable: true,
      };
    case 'closed':
      return {
        titleKey: 'challenge.statePausedTitle',
        bodyKey: 'challenge.statePausedBody',
        values: { name, count: 0 },
        dateIso: null,
        retryable: true,
      };
    case 'open':
      return {
        titleKey: 'challenge.stateOpenTitle',
        bodyKey: endsIn !== null ? 'challenge.stateOpenUntil' : 'challenge.stateOpenBody',
        values: { name, count: Math.max(endsIn ?? 0, 0) },
        dateIso: status.endsAt ?? null,
        retryable: false,
      };
    case 'none':
    default:
      return {
        titleKey: 'challenge.stateNoneTitle',
        bodyKey: 'challenge.stateNoneBody',
        values: { name, count: 0 },
        dateIso: null,
        retryable: true,
      };
  }
}

/**
 * What the operator has to do next, if anything.
 *
 * One key per state, and `null` when the season is doing what it should. The
 * console renders it directly under the same word the user's phone is showing,
 * which is the pairing that makes the console self-explanatory: the state, the
 * sentence the user reads, and the fix.
 */
export function operatorFix(state: SeasonState): string | null {
  switch (state) {
    case 'notReady':
      // The one with a button rather than a wait — see `admin_seed_challenge_season`.
      return 'operator.seasonFixNotReady';
    case 'closed':
      return 'operator.seasonFixClosed';
    case 'upcoming':
      return 'operator.seasonFixUpcoming';
    case 'ended':
      return 'operator.seasonFixEnded';
    case 'full':
      return 'operator.seasonFixFull';
    default:
      return null;
  }
}

/** `open` is the only good state; the rest are worth colouring as a problem. */
export function isHealthy(state: SeasonState): boolean {
  return state === 'open';
}

/** `YYYY-MM-DD` from an ISO timestamp, or an em dash. Both consoles show the
 *  window this way, and a season with no bound genuinely has no date to show. */
export function windowLabel(startsAt?: string | null, endsAt?: string | null): string {
  const day = (value?: string | null) => {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toISOString().slice(0, 10);
  };
  return `${day(startsAt)} → ${day(endsAt)}`;
}
