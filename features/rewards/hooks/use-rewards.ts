import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useAuthStore } from '@/features/auth/services/auth-store';
import { BADGES, CHAINS, FRAMES, THEMES, parseSlug } from '@/features/rewards/config/catalog';
import {
  isCosmetic,
  type CosmeticKind,
  type UserReward,
} from '@/features/rewards/types/rewards.types';
import { isSupabaseConfigured } from '@/lib/env';
import { supabase } from '@/lib/supabase';

/**
 * The shelf.
 *
 * One query for everything somebody owns, rather than one per kind. The trophy
 * case, the equip pickers, the avatar frame and the braid's colours all ask the
 * same question — "what does this account hold" — and four queries for one
 * answer is four chances for two surfaces to disagree about it.
 *
 * `staleTime` is long because the answer changes on the order of once a week at
 * the very best. It is invalidated explicitly at the two moments it can move: a
 * qualified day landing (`use-challenge-tracking`) and the resync below.
 */
export function useRewards() {
  const session = useAuthStore((s) => s.session);

  return useQuery({
    queryKey: ['rewards', 'mine', session?.user.id ?? null],
    enabled: isSupabaseConfigured && Boolean(session),
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<UserReward[]> => {
      const { data, error } = await supabase.rpc('my_challenge_rewards');
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as UserReward[];
      return rows.filter((r) => typeof r?.slug === 'string');
    },
  });
}

/**
 * Asks the server to re-derive anything owed.
 *
 * Exposed to the client deliberately — see the header of
 * `sync_my_challenge_rewards` in migration 0071. It cannot manufacture a day,
 * and a day is the only thing worth manufacturing; every insert it can cause is
 * one the unique index would refuse a second time. What it buys is that a
 * payout lost to a crash, a failed deploy, or a rung an operator added after
 * people had passed it heals the next time the screen opens, instead of sitting
 * there as a badge that visibly did not arrive.
 *
 * Deliberately quiet about failure. This runs on a screen open, nobody asked
 * for it, and a toast saying a background reconciliation failed is a toast
 * about something the user cannot act on.
 */
export function useSyncRewards() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.rpc('sync_my_challenge_rewards');
      if (error) throw new Error(error.message);
      return (data ?? []) as string[];
    },
    onSuccess: (granted) => {
      // Only when something actually arrived. An unconditional invalidate here
      // would refetch the shelf on every screen open for the ninety-nine days
      // out of a hundred where the answer has not moved.
      if (granted.length > 0) {
        void queryClient.invalidateQueries({ queryKey: ['rewards'] });
      }
    },
    onError: () => {
      // Nothing. See the header.
    },
  });
}

/**
 * The shelf, split by kind and reduced to the bare names the catalog is keyed
 * by — `spark`, not `badge:spark`.
 *
 * Filters out anything this build cannot draw. A slug an operator invented in
 * the console, or one from a build newer than this one, would otherwise render
 * as an empty tile with no explanation; dropping it means an older app shows
 * fewer rewards rather than broken ones, which is the right way round.
 */
export type OwnedCosmetics = Record<CosmeticKind, string[]> & {
  isLoading: boolean;
  /** Whether anything at all has been earned. What decides between the trophy
   *  case and the empty state. */
  any: boolean;
};

export function useOwnedCosmetics(): OwnedCosmetics {
  const rewards = useRewards();

  return useMemo(() => {
    const owned: Record<CosmeticKind, string[]> = {
      badge: [],
      theme: [],
      chain: [],
      frame: [],
      icon: [],
    };
    const art: Record<string, Record<string, unknown>> = {
      badge: BADGES,
      theme: THEMES,
      chain: CHAINS,
      frame: FRAMES,
    };

    for (const reward of rewards.data ?? []) {
      if (!isCosmetic(reward.kind)) continue;
      const parsed = parseSlug(reward.slug);
      if (!parsed) continue;
      // `icon` has no art map — nothing seeds it and nothing can draw it yet.
      // See the note in 0071.
      if (parsed.kind !== 'icon' && !art[parsed.kind]?.[parsed.name]) continue;
      owned[parsed.kind as CosmeticKind]?.push(parsed.name);
    }

    return {
      ...owned,
      isLoading: rewards.isLoading,
      any: Object.values(owned).some((list) => list.length > 0),
    };
  }, [rewards.data, rewards.isLoading]);
}
