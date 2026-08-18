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
} from '@/features/challenge/types/challenge.types';
import { isSupabaseConfigured } from '@/lib/env';
import { reportError } from '@/lib/error-reporting';
import { supabase } from '@/lib/supabase';

/** What `challenge_today()` returns. Server-owned; see migrations 0048 and 0055. */
export type ChallengeTodayResponse = {
  enrolled: boolean;
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
        .select('day_threshold, name, reward_kind, reward_title, reward_description')
        .eq('season_id', seasonId)
        .order('day_threshold');
      if (error) throw new Error(error.message);
      return (data ?? []).map((t) => ({
        dayThreshold: t.day_threshold as number,
        name: t.name as string,
        rewardKind: t.reward_kind as ChallengeTier['rewardKind'],
        rewardTitle: (t.reward_title as string | null) ?? null,
        rewardDescription: (t.reward_description as string | null) ?? null,
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
} {
  const today = useChallengeToday();
  const required = useChallengeStore((s) => s.required);
  const minWrites = useChallengeStore((s) => s.minWrites);
  const days = useChallengeStore((s) => s.days);

  const writes = days[currentDay()]?.writes ?? {};
  const serverRequired = today.data?.required ?? required;
  const items = buildChecklist(serverRequired, writes, today.data?.minWrites ?? minWrites);
  const outstanding = items.filter((i) => !i.done).map((i) => i.moduleId);
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
  };
}
