/**
 * The push token's lifecycle, and the one case where getting it wrong is a
 * disclosure rather than an inconvenience.
 *
 * Registration used to guard itself with a module-level `lastRegistered`, which
 * is empty on every process start — the same shape of mistake that produced
 * four identical streak notifications. On the way in that cost a redundant RPC
 * per launch. On the way *out* it was worse: `unregisterPushToken` returned
 * early when the variable was null, so signing out of an account you had not
 * signed into in that same session left this device's token attached to it, and
 * the next person to use the phone kept receiving that account's group and
 * album notifications.
 */

const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
  },
}));

jest.mock('expo-device', () => ({ isDevice: true }));

jest.mock('@/lib/notifications', () => ({ notificationsAvailable: true }));

let mockExpoToken: string | null = 'ExponentPushToken[abc]';
let mockPermissionGranted = true;
let tokenListener: (() => void) | null = null;

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: mockPermissionGranted })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: mockPermissionGranted })),
  getExpoPushTokenAsync: jest.fn(async () => {
    if (mockExpoToken === null) throw new Error('no projectId');
    return { data: mockExpoToken, type: 'expo' };
  }),
  addPushTokenListener: jest.fn((listener: () => void) => {
    tokenListener = listener;
    return {
      remove: () => {
        tokenListener = null;
      },
    };
  }),
}));

let mockSession: { user: { id: string } } | null = { user: { id: 'user-1' } };
const rpcCalls: { name: string; params: Record<string, unknown> }[] = [];

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn(async () => ({ data: { session: mockSession } })) },
    rpc: jest.fn(async (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return { error: null };
    }),
    functions: { invoke: jest.fn(async () => ({ data: null, error: null })) },
  },
}));

/* eslint-disable import/first */
import {
  registerPushToken,
  startPushTokenRotationWatch,
  unregisterPushToken,
} from '@/features/split/services/push-registration';
// Imported once, alongside the module under test, so both refer to the same
// mock instance. Requiring it inside a test would hand back a *fresh* instance
// after any `jest.resetModules()` above, and an override applied to that one
// would silently never reach the code being exercised.
import { supabase } from '@/lib/supabase';

beforeEach(() => {
  mockStorage.clear();
  rpcCalls.length = 0;
  mockExpoToken = 'ExponentPushToken[abc]';
  mockPermissionGranted = true;
  mockSession = { user: { id: 'user-1' } };
  tokenListener = null;
});

describe('registering', () => {
  it('registers once and skips the RPC on the next launch', async () => {
    await expect(registerPushToken()).resolves.toBe('ExponentPushToken[abc]');
    expect(rpcCalls.map((c) => c.name)).toEqual(['register_push_token']);

    // A cold start: module state would be empty, but the record is not.
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reloaded = require('@/features/split/services/push-registration') as {
      registerPushToken: typeof registerPushToken;
    };
    await reloaded.registerPushToken();

    expect(rpcCalls).toHaveLength(1);
  });

  it('registers again when the token has actually changed', async () => {
    await registerPushToken();
    mockExpoToken = 'ExponentPushToken[rotated]';
    await registerPushToken();

    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[1].params.p_token).toBe('ExponentPushToken[rotated]');
  });

  it('does nothing without a session', async () => {
    mockSession = null;
    await expect(registerPushToken()).resolves.toBeNull();
    expect(rpcCalls).toEqual([]);
  });

  it('does nothing when permission is refused', async () => {
    mockPermissionGranted = false;
    await expect(registerPushToken()).resolves.toBeNull();
    expect(rpcCalls).toEqual([]);
  });

  it('does not remember a token the RPC rejected', async () => {
    // Otherwise the failure is permanent: the guard would report it registered
    // and never try again.
    (supabase.rpc as jest.Mock).mockImplementationOnce(async () => ({
      error: { message: 'nope' },
    }));

    await expect(registerPushToken()).resolves.toBeNull();

    await registerPushToken();
    expect(rpcCalls.filter((c) => c.name === 'register_push_token')).toHaveLength(1);
  });
});

describe('signing out', () => {
  it('releases the token registered in an earlier process', async () => {
    // The disclosure. Register, then simulate a fresh launch in which nothing
    // has registered yet, and sign out.
    await registerPushToken();
    rpcCalls.length = 0;

    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reloaded = require('@/features/split/services/push-registration') as {
      unregisterPushToken: typeof unregisterPushToken;
    };
    await reloaded.unregisterPushToken();

    expect(rpcCalls).toEqual([
      { name: 'release_push_token', params: { p_token: 'ExponentPushToken[abc]' } },
    ]);
  });

  it('asks the OS when it remembers nothing at all', async () => {
    // Nothing was ever recorded — a build that predates the record, or a failed
    // write. The device still has a token, and it is still the fact.
    await unregisterPushToken();

    expect(rpcCalls).toEqual([
      { name: 'release_push_token', params: { p_token: 'ExponentPushToken[abc]' } },
    ]);
  });

  it('forgets the token so a later sign-in re-registers', async () => {
    await registerPushToken();
    await unregisterPushToken();
    rpcCalls.length = 0;

    await registerPushToken();
    expect(rpcCalls.map((c) => c.name)).toEqual(['register_push_token']);
  });

  it('stays quiet when the device has no token to release', async () => {
    mockExpoToken = null;
    await unregisterPushToken();
    expect(rpcCalls).toEqual([]);
  });
});

describe('rotation', () => {
  it('re-registers when the service hands over a new token', async () => {
    await registerPushToken();
    const stop = startPushTokenRotationWatch();
    rpcCalls.length = 0;

    // The listener carries the *device* token, not the Expo one, so the only
    // correct response is to go and ask for the current Expo token.
    mockExpoToken = 'ExponentPushToken[rotated]';
    tokenListener?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].params.p_token).toBe('ExponentPushToken[rotated]');
    stop();
  });

  it('costs nothing when the token has not really changed', async () => {
    await registerPushToken();
    const stop = startPushTokenRotationWatch();
    rpcCalls.length = 0;

    tokenListener?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(rpcCalls).toEqual([]);
    stop();
  });

  it('stops listening when unsubscribed', () => {
    const stop = startPushTokenRotationWatch();
    expect(tokenListener).not.toBeNull();
    stop();
    expect(tokenListener).toBeNull();
  });
});
