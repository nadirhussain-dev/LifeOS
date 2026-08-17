/**
 * The order of operations in an operator-ordered wipe.
 *
 * Almost all of this service is I/O, and mocking I/O to assert that it was
 * called is usually a test that proves nothing. These four are the exception,
 * because each one is a sequencing rule whose violation is silent and expensive:
 *
 *   - acknowledging a wipe that did not happen tells the operator a device is
 *     clean when it is not, and stops the retry;
 *   - wiping before pushing destroys the data the push existed to preserve;
 *   - reporting an empty loss list when the push failed understates the damage
 *     to somebody who is about to appeal;
 *   - and running any of it for an account in good standing is a catastrophe.
 */

const mockRpc = jest.fn();
const mockEvacuate = jest.fn();
const mockWipe = jest.fn();
const mockSetWipeOutcome = jest.fn();

/** Call order across all four collaborators, which is the actual assertion. */
const mockCalls: string[] = [];

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      mockCalls.push(`rpc:${String(args[0])}`);
      return mockRpc(...args);
    },
  },
}));

jest.mock('@/lib/env', () => ({ isSupabaseConfigured: true }));

jest.mock('@/features/auth/services/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-1' } }) },
}));

jest.mock('@/features/sync/services/sync-engine', () => ({
  evacuateBeforeWipe: (...args: unknown[]) => {
    mockCalls.push('evacuate');
    return mockEvacuate(...args);
  },
}));

jest.mock('@/features/sync/services/account-reconcile', () => ({
  wipeLocalData: (...args: unknown[]) => {
    mockCalls.push('wipe');
    return mockWipe(...args);
  },
}));

jest.mock('@/features/moderation/store/moderation-store', () => ({
  useModerationStore: {
    getState: () => ({ setWipeOutcome: mockSetWipeOutcome }),
  },
}));

jest.mock('@/lib/error-reporting', () => ({ reportError: jest.fn() }));

// Imported after the mocks, deliberately. Babel hoists `jest.mock` above the
// imports it can see, but the module under test pulls in expo-sqlite through
// its own import graph — so it has to be required once every mock is registered,
// or the real database client is loaded and the suite dies on a missing native
// module rather than on anything it is trying to assert.
// eslint-disable-next-line import/first
import { processDeviceCommands } from '@/features/moderation/services/device-commands';

const pendingWipe = {
  data: [{ id: 'cmd-1', command: 'wipe_local', detail: {}, issued_at: '2026-08-05T00:00:00Z' }],
  error: null,
};

beforeEach(() => {
  mockCalls.length = 0;
  jest.clearAllMocks();
  mockEvacuate.mockResolvedValue({ pushed: 12, unsaved: [], deviceOnly: [] });
  mockWipe.mockReturnValue(undefined);
  mockRpc.mockImplementation((fn: string) =>
    fn === 'pending_device_commands'
      ? Promise.resolve(pendingWipe)
      : Promise.resolve({ error: null }),
  );
});

describe('operator-ordered wipe', () => {
  it('pushes, then wipes, then acknowledges — in that order', async () => {
    await processDeviceCommands();

    expect(mockCalls).toEqual([
      'rpc:pending_device_commands',
      'evacuate',
      'wipe',
      'rpc:ack_device_command',
    ]);
  });

  it('does not acknowledge a wipe that failed', async () => {
    // An unacknowledged command is retried on the next launch. Acknowledging a
    // failed wipe converts a recoverable miss into a permanent one, and tells
    // the operator the opposite of the truth.
    mockWipe.mockImplementation(() => {
      throw new Error('database locked');
    });

    await processDeviceCommands();

    expect(mockCalls).toEqual(['rpc:pending_device_commands', 'evacuate', 'wipe']);
    expect(mockRpc).not.toHaveBeenCalledWith('ack_device_command', expect.anything());
    expect(mockSetWipeOutcome).not.toHaveBeenCalled();
  });

  it('still wipes when the final push fails, and says nothing was saved', async () => {
    // The instruction stands either way — the account is blocked. What changes
    // is the honesty of the report: an empty `unsaved` list would claim the
    // data is recoverable from the server when none of it got there.
    mockEvacuate.mockRejectedValue(new Error('offline'));

    await processDeviceCommands();

    expect(mockCalls).toEqual([
      'rpc:pending_device_commands',
      'evacuate',
      'wipe',
      'rpc:ack_device_command',
    ]);
    expect(mockSetWipeOutcome).toHaveBeenCalledWith(expect.objectContaining({ unsaved: ['*'] }));
  });

  it('reports the modules the push could not save', async () => {
    // Both kinds of loss, in one list. The sign-out dialog keeps them apart
    // because it is still asking a question; this is a receipt, and by the time
    // it is written the only fact left is which modules were on the device and
    // are not in the account. The person is owed that list by name before they
    // appeal, not a reassuring summary.
    mockEvacuate.mockResolvedValue({ pushed: 3, unsaved: ['gallery'], deviceOnly: ['private'] });

    await processDeviceCommands();

    expect(mockSetWipeOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ unsaved: ['gallery', 'private'], pushed: 3 }),
    );
    expect(mockRpc).toHaveBeenCalledWith('ack_device_command', {
      p_id: 'cmd-1',
      p_detail: { wiped: true, unsyncedModules: ['gallery', 'private'], pushedRows: 3 },
    });
  });

  it('does nothing at all when there is no pending command', async () => {
    mockRpc.mockImplementation(() => Promise.resolve({ data: [], error: null }));

    await processDeviceCommands();

    expect(mockCalls).toEqual(['rpc:pending_device_commands']);
    expect(mockWipe).not.toHaveBeenCalled();
  });

  it('does nothing when the queue cannot be read', async () => {
    // Offline, or the request failed. The command lives on the server and
    // outlives this attempt; guessing and wiping would be unrecoverable.
    mockRpc.mockImplementation(() =>
      Promise.resolve({ data: null, error: { message: 'network' } }),
    );

    await processDeviceCommands();

    expect(mockWipe).not.toHaveBeenCalled();
  });
});
