import { useQuery } from '@tanstack/react-query';

import { useAuthStore } from '@/features/auth/services/auth-store';
import { buildChecklist } from '@/features/challenge/services/challenge-math';
import {
  isRunning,
  type SeasonState,
  type SeasonStatus,
} from '@/features/challenge/services/season-state';
import { currentDay, useChallengeStore } from '@/features/challenge/store/challenge-store';
import type {
  ChainDay,
  ChallengeTier,
  ChecklistItem,
  FinishedRun,
} from '@/features/challenge/types/challenge.types';
import { isSupabaseConfigured } from '@/lib/env';
import { reportError } from '@/lib/error-reporting';
import { supabase } from '@/lib/supabase';

/** What `challenge_today()` returns. Server-owned; see migrations 0048, 0055 and 0069. */
export type ChallengeTodayResponse = {
  /**
   * A run is in progress. Deliberately still false for a finished one — every
   * caller reads this as "there is a day to be won", and 0069 hands the
   * finished run back separately rather than widening it.
   */
  enrolled: boolean;
  /** The last run that is over, for the summary. Null until there is one. */
  finishedRun?: FinishedRun | null;
  /**
   * The last local day this run may earn, and how many days that leaves —
   * counting today, so a run ending today has one left rather than none (0070).
   *
   * Both come from the server. Deriving the count here would use the device
   * clock, which is the one number this engine never trusts, and the date alone
   * cannot be turned into a countdown without it.
   *
   * Null on a season with no end configured at all, which is a real state and
   * must read as "no deadline" rather than as zero.
   */
  runEndsOn?: string | null;
  daysLeft?: number | null;
  seasonId?: string;
  seasonName?: string;
  /**
   * The season's state as the server names it (0055). Anything other than
   * `open` or `full` is the reason today's work will not count, and the
   * checklist owes the user that reason *before* they do the work rather than
   * after — a paused season used to be completely invisible from in here:
   * `record_challenge_day` refused with `season paused` and the ticks simply
   * never arrived.
   */
  seasonState?: SeasonState;
  seasonEndsAt?: string | null;
  localDay?: string;
  required?: string[];
  todayOutcome?: 'qualified' | 'shielded' | 'missed' | null;
  qualifiedDays?: number;
  perfectRun?: number;
  shields?: number;
  shieldEarnDays?: number;
  tierDay?: number;
  minWrites?: number;
  minActiveSeconds?: number;
  swapsLeft?: number;
  /** Local date from which the module picker unlocks, `YYYY-MM-DD`. */
  swapsUnlockDay?: string;
  /** Unshielded misses already inside the escalation window (0067). */
  recentMisses?: number;
  maxDemotionDays?: number;
  /** Every rung's day threshold, ascending — the ladder `demotionTarget()`
   *  reads the fall off. */
  tierThresholds?: number[];
};

/**
 * The server's view of the run: what day it thinks it is, what is owed today,
 * and where the counters stand.
 *
 * Refetched rather than cached hard, because the nightly settler can change all
 * of it while the app is closed — somebody who opens the app after missing a
 * day must not be shown yesterday's optimistic streak.
 */
export function useChallengeToday() {
  const session = useAuthStore((s) => s.session);
  const setEnrolment = useChallengeStore((s) => s.setEnrolment);
  const clearEnrolment = useChallengeStore((s) => s.clearEnrolment);
  const setStanding = useChallengeStore((s) => s.setStanding);

  return useQuery({
    queryKey: ['challenge', 'today', session?.user.id ?? null],
    enabled: isSupabaseConfigured && Boolean(session),
    staleTime: 60 * 1000,
    queryFn: async (): Promise<ChallengeTodayResponse> => {
      const { data, error } = await supabase.rpc('challenge_today');
      if (error) throw new Error(error.message);
      const response = (data ?? { enrolled: false }) as ChallengeTodayResponse;

      // Mirrored into the store so the checklist survives a cold start with no
      // network — the query cache does not persist, and the first paint of the
      // most-used screen in the feature should not be an empty state.
      if (response.enrolled && response.seasonId) {
        setEnrolment({
          seasonId: response.seasonId,
          required: response.required ?? [],
          minWrites: response.minWrites ?? 1,
        });
        // Cached for the reminder, which is rebuilt outside React on every
        // write and cannot fetch anything. Absent fields fall back to values
        // that make `demotionTarget` quote no cost at all rather than a wrong
        // one — a server that predates 0067 should produce the old reminder,
        // not an invented number.
        setStanding({
          qualifiedDays: response.qualifiedDays ?? 0,
          shields: response.shields ?? 0,
          recentMisses: response.recentMisses ?? 0,
          maxDemotionDays: response.maxDemotionDays ?? 0,
          tierThresholds: response.tierThresholds ?? [],
        });
      } else {
        clearEnrolment();
      }
      return response;
    },
  });
}

/**
 * The programme's state, in one read.
 *
 * `challenge_season_status()` (0055) replaces three round trips *and*, more to
 * the point, replaces a guess. This hook used to fetch the season, its tiers and
 * its modules, then conclude "no season is open" whenever the module list came
 * back empty — which was true, and useless. By the time the conclusion was
 * drawn the reason had been thrown away, so a season starting on Tuesday, a
 * season that ended last week, a full season and a half-configured one were all
 * shown to the user as the same dead end.
 *
 * The server now names the state and the screen quotes it. See
 * `features/challenge/services/season-state.ts` for why that derivation is not
 * allowed to live here.
 *
 * Readable signed-out, like `module_flags`, because it describes the programme
 * rather than a person — which is what lets the join screen show somebody what
 * they would be signing up for before they have an account.
 */
export function useSeasonStatus() {
  return useQuery({
    queryKey: ['challenge', 'season'],
    enabled: isSupabaseConfigured,
    // Short, because every state in here is one an operator can change from the
    // console while somebody is looking at the screen, and the screen offers a
    // "check again" that has to actually check.
    staleTime: 60 * 1000,
    queryFn: async (): Promise<SeasonStatus> => {
      const { data, error } = await supabase.rpc('challenge_season_status');
      if (error) throw new Error(error.message);
      const status = (data ?? { state: 'none' }) as SeasonStatus;

      // Not fatal — a run without a ladder still runs — but the ladder is what
      // the feature promises, so it should not go missing quietly. `notReady`
      // is reported by the console instead, where somebody can act on it.
      if (status.state === 'open' && (status.tiers ?? []).length === 0) {
        reportError(new Error(`challenge season "${status.name}" has no reward tiers`), {
          scope: 'challenge-season',
          seasonId: status.seasonId ?? '',
        });
      }
      return status;
    },
  });
}

/**
 * The ladder of one specific season — the one the caller is actually in.
 *
 * Separate from `useSeasonStatus` because that hook answers "what could I
 * join", which is not the same season as "what am I in". They are usually the
 * same row and occasionally not: somebody two hundred days into season one,
 * while season two is already open for enrolment, would otherwise have their
 * progress ring measured against a ladder they are not climbing.
 *
 * `challenge_tiers` is readable by everyone (0048) — it describes the programme,
 * not a person — so this needs no session.
 */
export function useChallengeTiers(seasonId: string | undefined) {
  return useQuery({
    queryKey: ['challenge', 'tiers', seasonId ?? null],
    enabled: isSupabaseConfigured && Boolean(seasonId),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ChallengeTier[]> => {
      const { data, error } = await supabase
        .from('challenge_tiers')
        .select('day_threshold, name, reward_kind, reward_title, reward_description, rewards')
        .eq('season_id', seasonId)
        .order('day_threshold');
      if (error) throw new Error(error.message);
      return (data ?? []).map((t) => ({
        dayThreshold: t.day_threshold as number,
        name: t.name as string,
        rewardKind: t.reward_kind as ChallengeTier['rewardKind'],
        rewardTitle: (t.reward_title as string | null) ?? null,
        rewardDescription: (t.reward_description as string | null) ?? null,
        // Defaulted rather than assumed present: `challenge_today()` embeds its
        // own copy of the ladder without this column, and a build talking to a
        // database that has not had 0071 applied yet gets an undefined here.
        // An empty payout renders as a rung with no art, which is what a
        // pre-0071 ladder honestly is.
        rewards: Array.isArray(t.rewards) ? (t.rewards as ChallengeTier['rewards']) : [],
      }));
    },
  });
}

/**
 * The ledger — what the chain draws from.
 *
 * `modules_hit` comes along for the per-module strips: the same rows answer
 * "which days did I keep" and "which commitment is the weak one", and asking
 * twice would be two round trips for one table.
 */
export function useChallengeChain(seasonId: string | undefined) {
  const session = useAuthStore((s) => s.session);

  return useQuery({
    queryKey: ['challenge', 'chain', seasonId ?? null],
    enabled: isSupabaseConfigured && Boolean(session) && Boolean(seasonId),
    staleTime: 60 * 1000,
    queryFn: async (): Promise<ChainDay[]> => {
      const { data, error } = await supabase
        .from('challenge_days')
        .select('local_day, outcome, modules_hit')
        .eq('season_id', seasonId)
        .order('local_day', { ascending: true })
        .limit(400);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({
        localDay: row.local_day as string,
        outcome: row.outcome as ChainDay['outcome'],
        modulesHit: (row.modules_hit as string[] | null) ?? [],
      }));
    },
  });
}

/**
 * Where the caller stands among everybody who started the same season.
 *
 * Server-side, because the honest answer needs the whole cohort and RLS — quite
 * rightly — shows an account only its own row. Comes back unranked while the
 * cohort is too small for a percentage to mean anything.
 */
export function useChallengeRank() {
  const session = useAuthStore((s) => s.session);

  return useQuery({
    queryKey: ['challenge', 'rank', session?.user.id ?? null],
    enabled: isSupabaseConfigured && Boolean(session),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{ ranked: boolean; topPercent?: number; cohort?: number }> => {
      const { data, error } = await supabase.rpc('challenge_rank');
      if (error) throw new Error(error.message);
      return (data ?? { ranked: false }) as { ranked: boolean; topPercent?: number };
    },
  });
}

export type ChallengeEvent = {
  id: number;
  kind: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

/** The readable history: every rung, shield and fall, newest first. */
export function useChallengeEvents(seasonId: string | undefined) {
  const session = useAuthStore((s) => s.session);

  return useQuery({
    queryKey: ['challenge', 'events', seasonId ?? null],
    enabled: isSupabaseConfigured && Boolean(session) && Boolean(seasonId),
    staleTime: 60 * 1000,
    queryFn: async (): Promise<ChallengeEvent[]> => {
      const { data, error } = await supabase
        .from('challenge_events')
        .select('id, kind, detail, created_at')
        .eq('season_id', seasonId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({
        id: row.id as number,
        kind: row.kind as string,
        detail: (row.detail as Record<string, unknown>) ?? {},
        createdAt: row.created_at as string,
      }));
    },
  });
}

/** What `challenge_live_today()` returns (0065). */
export type ChallengeLiveTodayResponse = {
  enrolled: boolean;
  localDay?: string;
  /** Whether this season demands server-witnessed writes at all. */
  liveRequired?: boolean;
  minWrites?: number;
  /** Module id → how many writes the server actually watched happen today. */
  attested?: Record<string, number>;
};

/**
 * What the server has witnessed today — the other half of the checklist.
 *
 * Separate from `useChallengeToday` rather than folded into it, because the two
 * change on completely different cadences. `challenge_today()` answers "what is
 * owed and where do the counters stand", which moves once a day. This moves
 * every time the user does anything, and under the live rule it is the field
 * the checklist's ticks actually key off.
 *
 * `attestChallengeWrite` already writes each success straight into the store,
 * so the common case needs no round trip at all. This exists for the two cases
 * that optimistic state cannot cover: a cold start part-way through the day,
 * and a second device — the ledger is per account, so work done on a tablet at
 * lunchtime has to be able to show up on the phone in the evening.
 */
export function useChallengeLiveToday() {
  const session = useAuthStore((s) => s.session);
  const setAttested = useChallengeStore((s) => s.setAttested);
  const setLiveRequired = useChallengeStore((s) => s.setLiveRequired);

  return useQuery({
    queryKey: ['challenge', 'live', session?.user.id ?? null],
    enabled: isSupabaseConfigured && Boolean(session),
    // Short: this is the field that decides whether somebody's evening counted,
    // and a minute of staleness on the screen they are staring at is a minute
    // of them believing the wrong thing.
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ChallengeLiveTodayResponse> => {
      const { data, error } = await supabase.rpc('challenge_live_today');
      if (error) throw new Error(error.message);
      const response = (data ?? { enrolled: false }) as ChallengeLiveTodayResponse;

      if (response.enrolled && response.localDay) {
        setLiveRequired(response.liveRequired === true);
        const minWrites = response.minWrites ?? 1;
        setAttested(
          Object.entries(response.attested ?? {})
            .filter(([, n]) => n >= minWrites)
            .map(([moduleId]) => moduleId),
          response.localDay,
        );
      }
      return response;
    },
  });
}

/**
 * Today's checklist, merged.
 *
 * The committed modules and the write threshold come from the server; the ticks
 * come from the local buffer, so one lands the instant something is logged with
 * no round trip in the way. **Local is for feedback, never for verdicts** — the
 * day is credited only when the server says it is, which is why `done` here is
 * separate from `qualified` below.
 */
export function useChallengeChecklist(): {
  items: ChecklistItem[];
  outstanding: string[];
  /** The server has this day in the ledger. The only authoritative answer. */
  qualified: boolean;
  /** Everything the client can see is done, but the server has not said so yet. */
  awaitingServer: boolean;
  /**
   * The season stopped accepting days, and why. Null while it is running.
   *
   * Without this the checklist has a failure mode with no symptom: a season
   * switched off or past its end date makes `record_challenge_day` refuse every
   * submission, and a screen that only knows "not qualified yet" renders that
   * as an ordinary unfinished day — forever. Somebody does the work, ticks
   * everything locally, and the day never lands, with nothing anywhere saying
   * why.
   */
  blockedBy: SeasonState | null;
  /** The season demands server-witnessed writes (0065). */
  liveRequired: boolean;
  /**
   * Modules the user has genuinely worked in today that will *not* count,
   * because the server never saw the write — almost always: they were offline.
   *
   * The single most important thing this hook returns under the live rule. It
   * is the difference between "you did the work and it did not count, and here
   * is which part and why" and a checklist that silently lies until midnight.
   */
  offlineModules: string[];
} {
  const today = useChallengeToday();
  const live = useChallengeLiveToday();
  const required = useChallengeStore((s) => s.required);
  const minWrites = useChallengeStore((s) => s.minWrites);
  const days = useChallengeStore((s) => s.days);

  const buffer = days[currentDay()];
  const writes = buffer?.writes ?? {};
  const serverRequired = today.data?.required ?? required;
  // The store's copy, not the query's, so an attestation that just landed shows
  // up without waiting for the next refetch — `attestChallengeWrite` writes
  // there directly and `useChallengeLiveToday` reconciles it.
  const attested = buffer?.attested ?? [];
  // Absent means the pre-0065 rule, never the strict one. A server that has not
  // run the migration, or a response that failed to arrive, must not be able to
  // tell somebody their finished day does not count.
  const liveRequired = live.data?.liveRequired === true;
  const items = buildChecklist(
    serverRequired,
    writes,
    today.data?.minWrites ?? minWrites,
    attested,
    liveRequired,
  );
  const outstanding = items.filter((i) => !i.counts).map((i) => i.moduleId);
  const qualified = today.data?.todayOutcome === 'qualified';

  // Absent on an older server, and absent is not "blocked" — a missing field
  // must never be able to tell somebody their run has stopped.
  const state = today.data?.seasonState;
  const blockedBy = state && !isRunning(state) ? state : null;

  return {
    items,
    outstanding,
    qualified,
    // A day that cannot be submitted is not a day awaiting confirmation. Left
    // as it was, a paused season would sit on "All done — confirming" until the
    // app was uninstalled.
    awaitingServer: !qualified && !blockedBy && outstanding.length === 0 && items.length > 0,
    blockedBy,
    liveRequired,
    // Worked on, locally, and still not counting. Only meaningful under the
    // live rule — without it `done` and `counts` are the same field and this is
    // always empty, which is the correct answer for a season that never asked
    // the user to be online.
    offlineModules: items.filter((i) => i.done && !i.counts).map((i) => i.moduleId),
  };
}
