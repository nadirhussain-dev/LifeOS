import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { getOrCreateDbKey } from '@/features/security/lib/db-key';

/**
 * The key to the encrypted database, and the only copy of it that exists.
 *
 * Every assertion here guards the same failure: returning a *different* key
 * than the one the database was encrypted with. SQLCipher does not report that
 * as "wrong password" anywhere the user can see — the file simply stops
 * opening, on their device, with no server copy for the modules that do not
 * sync (media, settings singletons, join tables). It is unrecoverable and it
 * is silent, which is why a 27-line file gets six tests.
 *
 * Note what is deliberately pinned as a literal below: `daykeep.db.key`. The
 * constant is not exported, and it must not be — but if it is ever edited,
 * every existing install looks like a fresh one and every local row becomes
 * unreadable. Duplicating the string here is the point: the test fails, loudly,
 * the moment the id moves.
 */

const DB_KEY_ID = 'daykeep.db.key';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

jest.mock('expo-crypto', () => ({
  // Distinct, deterministic bytes by default; overridden where a test cares
  // about a specific byte value.
  getRandomBytes: jest.fn((n: number) =>
    Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256),
  ),
}));

const getRandomBytes = Crypto.getRandomBytes as jest.MockedFunction<typeof Crypto.getRandomBytes>;

beforeEach(async () => {
  await SecureStore.deleteItemAsync(DB_KEY_ID);
  jest.clearAllMocks();
});

describe('database encryption key', () => {
  it('returns the same key on every call after the first', async () => {
    // The property the whole file exists for. A second call that generates
    // rather than reads is not a subtle bug: the next `initDatabase()` hands
    // SQLCipher a key the file was never encrypted with, and every row on the
    // device is gone.
    const first = await getOrCreateDbKey();
    const second = await getOrCreateDbKey();
    const third = await getOrCreateDbKey();

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(getRandomBytes).toHaveBeenCalledTimes(1);
  });

  it('never writes over a key that already exists', async () => {
    // The same loss by a different route. Reading, then unconditionally
    // storing, would round-trip fine in a single session and destroy the
    // database on the next launch — so the absence of a write is asserted
    // directly, not inferred from the returned value.
    await getOrCreateDbKey();
    jest.clearAllMocks();

    await getOrCreateDbKey();

    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(getRandomBytes).not.toHaveBeenCalled();
  });

  it('persists the key it returns, not a different one', async () => {
    // Generating a key, storing it, and returning something else would pass
    // both tests above on a fresh install and fail on the second launch only.
    const returned = await getOrCreateDbKey();
    const stored = await SecureStore.getItemAsync(DB_KEY_ID);

    expect(stored).toBe(returned);
  });

  it('generates 256 bits as 64 lowercase hex characters', async () => {
    // SQLCipher takes the key as text. A short or mixed-case string is still a
    // valid key — just a weaker one than intended, with nothing to notice it.
    const key = await getOrCreateDbKey();

    expect(getRandomBytes).toHaveBeenCalledWith(32);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('pads bytes below 0x10 to two digits', async () => {
    // `toString(16)` gives "5" for 0x05. Without the padStart the key silently
    // shortens — and, worse, two different byte arrays can encode to the same
    // string, which is a real collision in the one value that must be unique.
    getRandomBytes.mockReturnValueOnce(new Uint8Array(32));

    const key = await getOrCreateDbKey();

    expect(key).toBe('0'.repeat(64));
  });

  it('stores the key as readable after first unlock', async () => {
    // Not cosmetic. The root layout rebuilds every reminder and refreshes the
    // widget at launch, and both read the database — which can happen while
    // the device is locked. Under WHEN_UNLOCKED those reads fail and reminders
    // silently stop being scheduled.
    await getOrCreateDbKey();

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      DB_KEY_ID,
      expect.stringMatching(/^[0-9a-f]{64}$/),
      { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK },
    );
  });
});
