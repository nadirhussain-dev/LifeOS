import { confirmAndSignOut } from '@/features/auth/services/sign-out-flow';

/**
 * What the user is told before a sign-out clears their phone.
 *
 * The distinction under test is not cosmetic. Two very different facts end a
 * module up in the "not in your account" pile:
 *
 *  - the push FAILED — unexpected, and fixable by cancelling and retrying;
 *  - sync is OFF for it — the user's own setting, working exactly as the screen
 *    behind this dialog describes, and never fixable by waiting.
 *
 * Describing the second as the first ("hasn't reached your account yet") promises
 * a delay that never ends, and buries the one action that would actually save
 * the data. Describing the first as the second would be worse: it would present
 * a recoverable failure as a settled choice.
 */

const mockConfirm = jest.fn();
const mockEvacuate = jest.fn();
const mockSignOut = jest.fn();

jest.mock('@/lib/dialog-store', () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
}));

jest.mock('@/features/sync/services/sync-engine', () => ({
  evacuateBeforeWipe: () => mockEvacuate(),
}));

jest.mock('@/features/auth/services/auth-store', () => ({
  useAuthStore: {
    getState: () => ({ session: { user: { id: 'u1' } }, signOut: mockSignOut }),
  },
}));

jest.mock('@/lib/error-reporting', () => ({ reportError: jest.fn() }));

jest.mock('@/lib/i18n', () => ({
  __esModule: true,
  // Keys and interpolations, not prose: asserting on English sentences would
  // turn every copy edit into a failing test, and the question here is which
  // message is chosen, not how it is worded.
  default: {
    t: (key: string, options?: Record<string, unknown>) =>
      options?.modules ? `${key}:${String(options.modules)}` : key,
  },
}));

/** The second dialog, or undefined when the flow only asked once. */
const warning = () => mockConfirm.mock.calls[1]?.[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockConfirm.mockResolvedValue(true);
  mockEvacuate.mockResolvedValue({ pushed: 4, unsaved: [], deviceOnly: [] });
});

describe('when everything is safely in the account', () => {
  it('asks once and signs out', async () => {
    await expect(confirmAndSignOut()).resolves.toBe(true);

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalled();
  });
});

describe('when a module is device-only by choice', () => {
  beforeEach(() => {
    mockEvacuate.mockResolvedValue({ pushed: 4, unsaved: [], deviceOnly: ['private'] });
  });

  it('does not call the user’s own setting a sync failure', async () => {
    await confirmAndSignOut();

    expect(warning().title).toBe('sync.signOutDeviceOnlyTitle');
    expect(warning().message).toBe('sync.signOutDeviceOnlyBody:syncModule.private');
    // "Anyway" asks somebody to overrule a warning. The decision here is a
    // deletion, and the button should say so.
    expect(warning().confirmLabel).toBe('sync.signOutAndDelete');
  });

  it('still lets them through', async () => {
    await expect(confirmAndSignOut()).resolves.toBe(true);
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('takes cancel for an answer, and does not sign out', async () => {
    mockConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(confirmAndSignOut()).resolves.toBe(false);
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});

describe('when a push actually failed', () => {
  it('says so, and names retrying as the remedy', async () => {
    mockEvacuate.mockResolvedValue({ pushed: 0, unsaved: ['budget'], deviceOnly: [] });

    await confirmAndSignOut();

    expect(warning().title).toBe('sync.signOutUnsyncedTitle');
    expect(warning().message).toBe('sync.signOutUnsyncedBody:syncModule.budget');
  });

  /**
   * Both at once. The failure sets the tone — it is the half the user did not
   * choose and the half still worth cancelling for — but the device-only
   * modules are about to be deleted too, and a warning that lists only half of
   * what is at stake is the one people quote back afterwards.
   */
  it('names both kinds when both are at stake', async () => {
    mockEvacuate.mockResolvedValue({ pushed: 1, unsaved: ['budget'], deviceOnly: ['private'] });

    await confirmAndSignOut();

    expect(warning().title).toBe('sync.signOutUnsyncedTitle');
    expect(warning().message).toContain('sync.signOutUnsyncedBody:syncModule.budget');
    expect(warning().message).toContain('sync.signOutDeviceOnlyBody:syncModule.private');
  });

  /** A push that never ran cannot report which modules are at risk, so it must
   *  not imply the rest are safe. */
  it('treats an evacuation that threw as the whole account being at risk', async () => {
    mockEvacuate.mockRejectedValue(new Error('offline'));

    await confirmAndSignOut();

    expect(warning().title).toBe('sync.signOutUnsyncedTitle');
    expect(warning().message).toBe('sync.signOutUnsyncedOffline');
  });
});
