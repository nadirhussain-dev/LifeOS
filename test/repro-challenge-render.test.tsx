import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('react-native-reanimated', () => {
  const Reanimated = jest.requireActual('react-native-reanimated/mock');
  Reanimated.default.call = Reanimated.call = () => Reanimated;
  return Reanimated;
});
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn() }));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));
jest.mock('@/lib/env', () => ({
  isSupabaseConfigured: true,
  supabaseProjectRef: 'ref',
  appEnv: 'development',
  isProductionEnv: false,
}));
jest.mock('@/lib/error-reporting', () => ({ reportError: jest.fn() }));
jest.mock('@/lib/toast-store', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
  ToastHost: () => null,
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

let mockRpc: jest.Mock;
let mockFrom: jest.Mock;
let mockSessionState: { session: { user: { id: string } } | null };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));
jest.mock('@/features/auth/services/auth-store', () => ({
  useAuthStore: jest.fn((sel) => sel(mockSessionState)),
}));

const TIERS = [
  { day_threshold: 3, name: 'Embers', reward_kind: 'digital', reward_title: null, reward_description: null, rewards: [] },
  { day_threshold: 7, name: 'Flame', reward_kind: 'digital', reward_title: null, reward_description: null, rewards: [{ kind: 'badge', slug: 'badge:ember' }] },
  { day_threshold: 14, name: 'Blaze', reward_kind: 'digital', reward_title: null, reward_description: null, rewards: [] },
  { day_threshold: 30, name: 'Keystone', reward_kind: 'digital', reward_title: null, reward_description: null, rewards: [] },
];

function chainable(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    then: jest.fn((resolve: (v: unknown) => void) => resolve({ data, error: null })),
  };
}

interface Scenario {
  label: string;
  route: 'index' | 'rewards';
  session: boolean;
  today?: unknown;
  todayError?: boolean;
  season?: unknown;
  live?: unknown;
  rank?: unknown;
  tiers?: unknown;
  days?: unknown;
  events?: unknown;
  rewards?: unknown;
  rewardsError?: boolean;
}

function wire(s: Scenario) {
  const today = s.todayError
    ? { data: null, error: { message: 'challenge_today failed', code: 'XX000' } }
    : { data: s.today ?? (s.route === 'index' ? null : undefined), error: null };

  mockRpc = jest.fn(async (name: string) => {
    if (name === 'challenge_today') return today;
    if (name === 'challenge_season_status') return { data: s.season ?? { state: 'open', seasonId: 's1', name: 'Spring', tiers: s.tiers ?? TIERS }, error: null };
    if (name === 'challenge_live_today') return { data: s.live ?? { enrolled: true, localDay: '2026-08-24', liveRequired: false, minWrites: 1, attested: {} }, error: null };
    if (name === 'challenge_rank') return { data: s.rank ?? { ranked: false }, error: null };
    if (name === 'sync_my_challenge_rewards') return { data: s.rewards ?? [], error: null };
    if (name === 'my_challenge_rewards') return s.rewardsError ? { data: null, error: { message: 'rewards failed' } } : { data: s.rewards ?? [], error: null };
    return { data: null, error: null };
  });

  const fromMap: Record<string, unknown> = {
    challenge_tiers: s.tiers ?? TIERS,
    challenge_days: s.days ?? [],
    challenge_events: s.events ?? [],
  };
  mockFrom = jest.fn((table: string) => chainable(fromMap[table] ?? []));

  mockSessionState = { session: s.session ? { user: { id: 'u1' } } : null };
}

const qc = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false } },
  });

const scenarios: Scenario[] = [
  { label: 'enrolled no events', route: 'index', session: true, today: { enrolled: true, seasonId: 's1', seasonName: 'Spring', required: ['habits', 'tasks', 'journal'], qualifiedDays: 5, perfectRun: 5, shields: 1, shieldEarnDays: 30, minWrites: 1, todayOutcome: 'qualified', shieldCap: 3, tierThresholds: [3, 7, 14, 30] } },
  { label: 'enrolled unseen reward', route: 'index', session: true, today: { enrolled: true, seasonId: 's1', required: ['habits', 'tasks', 'journal'], qualifiedDays: 30, perfectRun: 30, shields: 0, shields: 0, shieldEarnDays: 30, minWrites: 1, todayOutcome: 'qualified', shieldCap: 3, tierThresholds: [3, 7, 14, 30] }, events: [{ id: 11, kind: 'reward_granted', detail: { slugs: ['badge:ember', 'theme:flame-dusk'], qualifiedDays: 30 } }] },
  { label: 'enrolled unseen demotion', route: 'index', session: true, today: { enrolled: true, seasonId: 's1', required: ['habits', 'tasks', 'journal'], qualifiedDays: 5, perfectRun: 2, shields: 0, shieldEarnDays: 30, minWrites: 1, todayOutcome: 'missed', shieldCap: 3, tierThresholds: [3, 7, 14, 30] }, events: [{ id: 5, kind: 'demoted', detail: { fromDays: 14, toDays: 3 } }] },
  { label: 'enrolled tier_reached toast', route: 'index', session: true, today: { enrolled: true, seasonId: 's1', required: ['habits', 'tasks', 'journal'], qualifiedDays: 6, perfectRun: 6, shields: 0, shieldEarnDays: 30, minWrites: 1, todayOutcome: 'qualified', shieldCap: 3, tierThresholds: [3, 7, 14, 30] }, events: [{ id: 4, kind: 'tier_reached', detail: { dayThreshold: 7 } }] },
  { label: 'not enrolled signed-in', route: 'index', session: true, today: { enrolled: false } },
  { label: 'signed out', route: 'index', session: false, today: { enrolled: false } },
  { label: 'today query errors', route: 'index', session: true, todayError: true },
  { label: 'season query errors', route: 'index', session: true, today: { enrolled: true, seasonId: 's1', required: ['habits'], qualifiedDays: 5, perfectRun: 5, shields: 0, shieldEarnDays: 30, minWrites: 1, todayOutcome: 'qualified', shieldCap: 3, tierThresholds: [3, 7, 14, 30] }, season: { state: 'open', seasonId: 's1', name: 'Spring', tiers: TIERS } },
  { label: 'rewards screen with cosmetics', route: 'rewards', session: true, rewards: [{ slug: 'badge:ember', kind: 'badge' }, { slug: 'theme:flame-dusk', kind: 'theme' }, { slug: 'chain:ember-glow', kind: 'chain' }, { slug: 'frame:blaze-ring', kind: 'frame' }, { slug: 'premium:s1:90', kind: 'premium', detail: { days: 90 }, tierDay: 30 }] },
  { label: 'rewards screen empty', route: 'rewards', session: true },
  { label: 'rewards screen errors', route: 'rewards', session: true, rewardsError: true },
];

describe('ChallengeScreen / ChallengeRewardsScreen render', () => {
  it.each(scenarios)('%s', async (s) => {
    wire(s);
    const mod = require(s.route === 'rewards' ? '@/app/challenge/rewards' : '@/app/challenge');
    const Screen = mod.default;
    let err: unknown = null;
    try {
      const utils = render(
        <QueryClientProvider client={qc()}>
          <SafeAreaProvider>
            <Screen />
          </SafeAreaProvider>
        </QueryClientProvider>
      );
      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      err = e;
    }
    if (err) {
      console.error(`RENDER CRASH [${s.label}]:`, (err as Error)?.message);
    }
    expect(err).toBeNull();
  });
});
