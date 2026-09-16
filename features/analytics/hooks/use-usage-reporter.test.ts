import { renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { useUsageReporter } from '@/features/analytics/hooks/use-usage-reporter';

/**
 * Session counting, which is the denominator of every retention figure the
 * product will be steered by.
 *
 * The failure here is not a crash, it is a plausible wrong number. iOS sends
 * `active` after any passing interruption — a notification banner, the app
 * switcher, a permission sheet — so counting every `active` would report a
 * handful of sessions for one genuine open. Retention computed against that
 * denominator looks *worse* than reality and moves for reasons nobody can
 * trace, which is the kind of metric that gets a good product changed in the
 * wrong direction.
 */

jest.mock('@/features/analytics/services/funnel-reporter', () => ({
  flushFunnel: jest.fn(async () => undefined),
}));
jest.mock('@/features/analytics/services/usage-reporter', () => ({
  flushUsage: jest.fn(async () => undefined),
}));
jest.mock('@/features/hub/config/route-modules', () => ({
  moduleForPath: () => null,
}));
jest.mock('expo-router', () => ({ usePathname: () => '/' }));

const mockTrackFunnel = jest.fn();
jest.mock('@/features/analytics/store/funnel-store', () => ({
  trackFunnel: (...args: unknown[]) => mockTrackFunnel(...args),
}));

const mockUsageState = { hydrated: true };
jest.mock('@/features/analytics/store/usage-store', () => ({
  trackModuleOpen: jest.fn(),
  useUsageStore: (selector: (state: typeof mockUsageState) => unknown) => selector(mockUsageState),
}));

let changeHandler: ((next: AppStateStatus) => void) | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  changeHandler = undefined;
  mockUsageState.hydrated = true;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _event: string,
    handler: (next: AppStateStatus) => void,
  ) => {
    changeHandler = handler;
    return { remove: jest.fn() };
  }) as unknown as typeof AppState.addEventListener);
});

afterEach(() => jest.restoreAllMocks());

const opens = () => mockTrackFunnel.mock.calls.filter(([metric]) => metric === 'app_opened').length;

describe('app_opened', () => {
  it('counts the cold start', async () => {
    await renderHook(() => useUsageReporter());

    expect(opens()).toBe(1);
  });

  it('counts a return from background as a second session', async () => {
    await renderHook(() => useUsageReporter());

    changeHandler?.('background');
    changeHandler?.('active');

    expect(opens()).toBe(2);
  });

  it('does not count a passing interruption', async () => {
    // The case that would inflate the denominator. `inactive → active` is a
    // banner or the app switcher, not somebody opening the app.
    await renderHook(() => useUsageReporter());

    changeHandler?.('inactive');
    changeHandler?.('active');

    expect(opens()).toBe(1);
  });

  it('does not count repeated actives without an intervening background', async () => {
    await renderHook(() => useUsageReporter());

    changeHandler?.('active');
    changeHandler?.('active');
    changeHandler?.('active');

    expect(opens()).toBe(1);
  });

  it('counts each background→active round trip exactly once', async () => {
    await renderHook(() => useUsageReporter());

    for (let i = 0; i < 3; i++) {
      changeHandler?.('background');
      changeHandler?.('active');
    }

    expect(opens()).toBe(4); // the cold start plus three returns
  });

  it('records nothing until consent has been read from storage', async () => {
    // Firing before hydration would either lose the count or record it against
    // a consent answer that had not been loaded yet.
    mockUsageState.hydrated = false;

    await renderHook(() => useUsageReporter());

    expect(opens()).toBe(0);
    expect(changeHandler).toBeUndefined();
  });
});
