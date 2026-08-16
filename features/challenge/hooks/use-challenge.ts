import { useQuery } from '@tanstack/react-query';

import { useAuthStore } from '@/features/auth/services/auth-store';
import { buildChecklist } from '@/features/challenge/services/challenge-math';
import { currentDay, useChallengeStore } from '@/features/challenge/store/challenge-store';
import type {
  ChainDay,
  ChallengeTier,
  ChecklistItem,
} from '@/features/challenge/types/challenge.types';
import { isSupabaseConfigured } from '@/lib/env';
import { supabase } from '@/lib/supabase';

/** What `challenge_today()` returns. Server-owned; see migration 0048. */
export type ChallengeTodayResponse = {
  enrolled: boolean;
  seasonId?: string;
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
 * The season that is currently open, with its ladder and eligible modules.
 *
 * Readable signed-out, like `module_flags`, because it describes the program
 * rather than a person — which is what lets the join screen show somebody what
 * they would be signing up for before they have an account.
 */
export function useOpenSeason() {
  return useQuery({
    queryKey: ['challenge', 'season'],
    enabled: isSupabaseConfigured,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: seasons, error } = await supabase
        .from('challenge_seasons')
        .select(
          'id, name, required_modules, module_lock_days, shield_cap, shield_earn_days, shield_floor_days',
        )
        .eq('enabled', true)
        .limit(1);
      if (error) throw new Error(error.message);

      const season = seasons?.[0];
      if (!season) return null;

      const [tiers, modules] = await Promise.all([
        supabase
          .from('challenge_tiers')
          .select('day_threshold, name, reward_kind, reward_title, reward_description')
          .eq('season_id', season.id)
          .order('day_threshold'),
        supabase
          .from('challenge_modules')
          .select('module_id, est_daily_seconds, sort_order')
          .eq('season_id', season.id)
          .eq('eligible', true)
          .order('sort_order'),
      ]);
      if (tiers.error) throw new Error(tiers.error.message);
      if (modules.error) throw new Error(modules.error.message);

      return {
        id: season.id as string,
        name: season.name as string,
        requiredModules: season.required_modules as number,
        moduleLockDays: season.module_lock_days as number,
        shieldCap: season.shield_cap as number,
        tiers: (tiers.data ?? []).map((t) => ({
          dayThreshold: t.day_threshold as number,
          name: t.name as string,
          rewardKind: t.reward_kind as ChallengeTier['rewardKind'],
          rewardTitle: (t.reward_title as string | null) ?? null,
          rewardDescription: (t.reward_description as string | null) ?? null,
        })),
        modules: (modules.data ?? []).map((m) => ({
          moduleId: m.module_id as string,
          estDailySeconds: m.est_daily_seconds as number,
        })),
      };
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

  return {
    items,
    outstanding,
    qualified,
    awaitingServer: !qualified && outstanding.length === 0 && items.length > 0,
  };
}
