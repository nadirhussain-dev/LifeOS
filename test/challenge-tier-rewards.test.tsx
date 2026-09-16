import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import React from 'react';

import { MilestoneSheet } from '@/features/challenge/components/milestone-sheet';
import { useSeasonStatus } from '@/features/challenge/hooks/use-challenge';
import type { ChallengeTier } from '@/features/challenge/types/challenge.types';

/**
 * The reload screen on `/challenge`, and the shape that caused it.
 *
 * `challenge_season_status()` builds its `tiers` array field by field and was
 * never updated when 0071 added `challenge_tiers.rewards`, so every rung it
 * hands back was missing that field. The screen prefers the `challenge_tiers`
 * table read and falls back to those tiers whenever it has not answered — every
 * cold open, and permanently against a database still on pre-0071, where the
 * table read selects a column that does not exist and only ever errors.
 *
 * `MilestoneSheet` is mounted unconditionally on the screen — `visible` controls
 * the `Modal`, not whether the component body runs — so it reached
 * `tier.rewards.some(...)` on a rung with no `rewards` and threw. The throw
 * reached the root `ErrorBoundary`, which is the "Something went wrong /
 * Reload" screen, i.e. the whole app, not just the sheet.
 *
 * Two tests, because they close the bug from both ends and fail for different
 * reasons: the component must be total over a rung with no payouts, and the
 * query must not let such a rung into the tree in the first place.
 *
 * Deliberately not a whole-screen render. `test/repro-challenge-render.test.tsx`
 * tried that and was removed with this change: under those mocks the screen
 * renders an empty tree, so it asserted nothing and passed just as happily with
 * the bug present.
 */

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

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));
jest.mock('@/features/auth/services/auth-store', () => ({
  useAuthStore: jest.fn((sel: (s: unknown) => unknown) => sel({ session: { user: { id: 'u1' } } })),
}));

/** Exactly what the server returned: no `rewards` key on any rung. */
const STATUS_TIERS = [
  {
    dayThreshold: 3,
    name: 'Embers',
    rewardKind: 'digital',
    rewardTitle: null,
    rewardDescription: null,
  },
  {
    dayThreshold: 7,
    name: 'Flame',
    rewardKind: 'digital',
    rewardTitle: null,
    rewardDescription: null,
  },
  {
    dayThreshold: 30,
    name: 'Keystone',
    rewardKind: 'digital',
    rewardTitle: null,
    rewardDescription: null,
  },
];

const TODAY = {
  enrolled: true,
  seasonId: 's1',
  seasonName: 'Spring',
  required: ['habits', 'tasks', 'journal'],
  qualifiedDays: 5,
  perfectRun: 5,
  shields: 1,
  shieldEarnDays: 30,
  minWrites: 1,
  todayOutcome: 'qualified',
  tierThresholds: [3, 7, 30],
};

function chainable(result: { data: unknown; error: unknown }) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    then: jest.fn((resolve: (v: unknown) => void) => resolve(result)),
  };
}

beforeEach(() => {
  mockRpc = jest.fn(async (name: string) => {
    if (name === 'challenge_today') return { data: TODAY, error: null };
    if (name === 'challenge_season_status')
      return {
        data: { state: 'open', seasonId: 's1', name: 'Spring', tiers: STATUS_TIERS },
        error: null,
      };
    if (name === 'challenge_live_today')
      return {
        data: {
          enrolled: true,
          localDay: '2026-08-24',
          liveRequired: false,
          minWrites: 1,
          attested: {},
        },
        error: null,
      };
    if (name === 'challenge_rank') return { data: { ranked: false }, error: null };
    return { data: null, error: null };
  });

  // The `challenge_tiers` read fails the way a pre-0071 database fails it:
  // `select ... rewards` names a column that is not there. That is what pins the
  // screen onto the season-status fallback for good.
  mockFrom = jest.fn((table: string) =>
    table === 'challenge_tiers'
      ? chainable({
          data: null,
          error: { message: 'column challenge_tiers.rewards does not exist', code: '42703' },
        })
      : chainable({ data: [], error: null }),
  );
});

/**
 * Every client this suite builds, so `afterEach` can shut them down.
 *
 * Without that this suite does not exit. A query that goes unused schedules its
 * own garbage collection through `timeoutManager.setTimeout` (query-core's
 * removable.js) and nothing unrefs it, so the handle holds the Node worker open
 * for the full `gcTime` — five minutes on the v5 default. In the whole run that
 * surfaced as jest's "a worker process has failed to exit gracefully … force
 * exited" at the end of an otherwise green suite; run on its own, the file
 * simply sat there for five minutes after its last assertion.
 *
 * `--detectOpenHandles` never showed it, because it forces `--runInBand` and
 * the main process tears down on its own — so the warning only ever appeared in
 * the mode that could not explain it.
 */
const clients: QueryClient[] = [];

const qc = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        refetchOnWindowFocus: false,
        // Nothing here outlives its test, so there is no cache worth keeping —
        // and a zero gcTime means no timer is ever scheduled to keep alive.
        gcTime: 0,
      },
    },
  });
  clients.push(client);
  return client;
};

afterEach(() => {
  // Testing Library unmounts the tree, but the client is not part of the tree:
  // `clear()` drops the cache (and any gc timer still pending with it) and
  // `unmount()` removes the focus/online listeners the client subscribed.
  for (const client of clients.splice(0)) {
    client.clear();
    client.unmount();
  }
});

it('MilestoneSheet survives a rung that carries no rewards', () => {
  expect(() =>
    render(
      <MilestoneSheet
        // False, and it still has to hold: the body runs on every render of the
        // challenge screen regardless, which is why this took the whole app down.
        visible={false}
        slugs={[]}
        // Cast because the whole point is a rung the type system says cannot
        // exist. `ChallengeTier` requires `rewards`; the server sent rungs
        // without it for four migrations, and TypeScript believing otherwise is
        // exactly how this reached a device.
        tiers={STATUS_TIERS as unknown as ChallengeTier[]}
        qualifiedDays={5}
        onShare={() => undefined}
        onDismiss={() => undefined}
      />,
    ),
  ).not.toThrow();
});

it('normalizes the ladder embedded in the season status', async () => {
  let seen: { rewards?: unknown }[] | undefined;
  function Probe() {
    seen = useSeasonStatus().data?.tiers;
    return null;
  }

  render(
    <QueryClientProvider client={qc()}>
      <Probe />
    </QueryClientProvider>,
  );
  await new Promise((r) => setTimeout(r, 200));

  expect(seen).toHaveLength(STATUS_TIERS.length);
  for (const tier of seen ?? []) expect(tier.rewards).toEqual([]);
});
