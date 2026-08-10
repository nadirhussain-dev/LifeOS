import * as SecureStore from 'expo-secure-store';

import { deleteEscrow, uploadEscrow } from '@/features/private/services/vault-escrow';

import {
  decryptBytes,
  deriveKek,
  encryptBytes,
  fromBase64,
  generateMasterKey,
  randomBytes,
  toBase64,
} from '@/features/private/services/vault-crypto';

/**
 * Setting up, opening and changing the private space's keys.
 *
 * Everything persisted here goes to SecureStore rather than AsyncStorage, and
 * that is the load-bearing decision. AsyncStorage is a plaintext file: it rides
 * along in an ADB backup and is readable on a rooted device, which would hand
 * an attacker the wrapped key to grind offline at their leisure. SecureStore
 * keeps it in the iOS Keychain / Android Keystore behind the device passcode,
 * so the offline attack does not start.
 *
 * ⚠️  A copy of the master key may also be escrowed to the operator — see
 * vault-escrow.ts. Nothing in this file uploads anything, but "the key never
 * leaves the device" stopped being true the moment escrow was configured, and
 * a reader of this file should not be left believing otherwise.
 *
 * Two spaces, one mechanism
 * -------------------------
 * A real PIN and a decoy PIN each wrap a *different* random master key. Both
 * wrapped blobs sit side by side and are indistinguishable — uniform random
 * bytes of identical length. Unlocking tries each in turn and takes whichever
 * opens.
 *
 * This is why the decoy holds up: it is not a UI that hides rows. Content
 * written in the real space is encrypted under the real key and genuinely
 * cannot be opened with the decoy key, so a decoy unlock shows an empty space
 * because the space *is* empty, and nothing on the device says otherwise.
 * Anything written while in decoy mode is real data in the decoy space, which
 * is what makes it look lived-in rather than staged.
 */

const SALT_KEY = 'lifeos.vault.salt';
const REAL_KEY = 'lifeos.vault.wrapped';
const DECOY_KEY = 'lifeos.vault.wrapped.alt';
const ATTEMPTS_KEY = 'lifeos.vault.attempts';

/** Short enough to be memorable, long enough that throttling can outlast a
 * person with the phone in their hand. */
export const MIN_PIN_LENGTH = 6;

export type VaultSpace = 'real' | 'decoy';

export type UnlockResult =
  | { ok: true; space: VaultSpace; key: Uint8Array }
  | { ok: false; reason: 'wrong-pin' | 'not-set-up' | 'throttled'; retryInMs?: number };

async function readItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, {
    // WHEN_UNLOCKED, not AFTER_FIRST_UNLOCK: the vault key should not be
    // reachable while the phone is sitting locked on a table.
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}

export async function isVaultSetUp(): Promise<boolean> {
  return (await readItem(REAL_KEY)) !== null;
}

export async function hasDecoy(): Promise<boolean> {
  return (await readItem(DECOY_KEY)) !== null;
}

// --- attempt throttling -----------------------------------------------------

/**
 * Escalating delay after repeated wrong PINs — the actual defence against
 * somebody guessing a six-digit PIN with the unlocked phone in their hand.
 * Deliberately NOT a wipe-after-N: the person most likely to trip this is the
 * owner misremembering their own PIN, and destroying their data for it would
 * be a far worse bug than a slow retry.
 */
const THROTTLE_AFTER = 5;
const THROTTLE_STEP_MS = 30_000;
const THROTTLE_MAX_MS = 15 * 60_000;

type Attempts = { count: number; lastAt: number };

async function readAttempts(): Promise<Attempts> {
  const raw = await readItem(ATTEMPTS_KEY);
  if (!raw) return { count: 0, lastAt: 0 };
  try {
    return JSON.parse(raw) as Attempts;
  } catch {
    return { count: 0, lastAt: 0 };
  }
}

function penaltyMs(count: number): number {
  if (count < THROTTLE_AFTER) return 0;
  return Math.min(THROTTLE_MAX_MS, (count - THROTTLE_AFTER + 1) * THROTTLE_STEP_MS);
}

async function recordFailure(): Promise<void> {
  const attempts = await readAttempts();
  await writeItem(
    ATTEMPTS_KEY,
    JSON.stringify({ count: attempts.count + 1, lastAt: Date.now() } satisfies Attempts),
  );
}

async function clearFailures(): Promise<void> {
  await SecureStore.deleteItemAsync(ATTEMPTS_KEY).catch(() => undefined);
}

// --- setup / unlock ---------------------------------------------------------

/** Creates the real space. Generates a fresh master key and wraps it under the
 * PIN; the key returned is the one to hold in memory for this session. */
export async function setUpVault(pin: string): Promise<Uint8Array> {
  const salt = randomBytes(16);
  const kek = await deriveKek(pin, salt);
  const masterKey = generateMasterKey();

  await writeItem(SALT_KEY, toBase64(salt));
  await writeItem(REAL_KEY, toBase64(encryptBytes(kek, masterKey)));
  await clearFailures();
  return masterKey;
}

/**
 * Creates the real space around a master key that already exists.
 *
 * The second half of a device transfer (`key-transfer.ts`). Identical to
 * `setUpVault` except that the key is given rather than generated, which is the
 * whole point: the ciphertext already syncing to this device was sealed under
 * that key, and a freshly generated one would leave it permanently unreadable
 * while looking like a working vault.
 *
 * The PIN and salt are this device's own. Two phones holding the same vault do
 * not have to share a PIN, and their keystores never hold the same bytes — only
 * the key underneath is common.
 */
export async function adoptVault(pin: string, masterKey: Uint8Array): Promise<void> {
  const salt = randomBytes(16);
  const kek = await deriveKek(pin, salt);

  await writeItem(SALT_KEY, toBase64(salt));
  await writeItem(REAL_KEY, toBase64(encryptBytes(kek, masterKey)));
  // Any decoy from a previous vault on this device belonged to a different
  // master key and could never be opened again; leaving it would be a PIN that
  // silently fails forever.
  await SecureStore.deleteItemAsync(DECOY_KEY).catch(() => undefined);
  await clearFailures();
}

/**
 * Adds the decoy space. Shares the salt (so the two derivations cost the same
 * and neither can be told apart by timing) but wraps an entirely separate
 * master key.
 */
export async function setUpDecoy(pin: string): Promise<void> {
  const saltRaw = await readItem(SALT_KEY);
  if (!saltRaw) throw new Error('vault not set up');
  const kek = await deriveKek(pin, fromBase64(saltRaw));
  await writeItem(DECOY_KEY, toBase64(encryptBytes(kek, generateMasterKey())));
}

export async function removeDecoy(): Promise<void> {
  await SecureStore.deleteItemAsync(DECOY_KEY).catch(() => undefined);
}

/**
 * Tries a PIN against both spaces.
 *
 * Always attempts the decoy wrap too, even after the real one opens — a
 * short-circuit would make the real PIN measurably faster to check than a wrong
 * one, and timing is exactly the sort of side channel that undoes a decoy.
 */
export async function unlockVault(pin: string): Promise<UnlockResult> {
  const [saltRaw, realWrapped, decoyWrapped] = await Promise.all([
    readItem(SALT_KEY),
    readItem(REAL_KEY),
    readItem(DECOY_KEY),
  ]);
  if (!saltRaw || !realWrapped) return { ok: false, reason: 'not-set-up' };

  const attempts = await readAttempts();
  const penalty = penaltyMs(attempts.count);
  const waited = Date.now() - attempts.lastAt;
  if (penalty > 0 && waited < penalty) {
    return { ok: false, reason: 'throttled', retryInMs: penalty - waited };
  }

  const kek = await deriveKek(pin, fromBase64(saltRaw));

  let real: Uint8Array | null = null;
  try {
    real = decryptBytes(kek, fromBase64(realWrapped));
  } catch {
    real = null;
  }

  let decoy: Uint8Array | null = null;
  if (decoyWrapped) {
    try {
      decoy = decryptBytes(kek, fromBase64(decoyWrapped));
    } catch {
      decoy = null;
    }
  }

  if (real) {
    await clearFailures();
    /**
     * Backfill for vaults the escrow never covered.
     *
     * `uploadEscrow` runs at setup, so a space created while signed out — or
     * created before 0015 existed — has no row, and the app's own privacy copy
     * says operator access is possible. Leaving those two facts disagreeing is
     * the worst of the options: some vaults reachable, some not, with nothing
     * on screen saying which, and a policy document that is wrong either way.
     * A successful unlock while signed in is the one moment the master key and
     * the account are both in hand, so it is where this belongs. The upsert is
     * idempotent, so a covered vault costs one small write and nothing else.
     *
     * **Real space only.** Escrowing the decoy's key would seal the wrong vault
     * and — far worse — a row whose contents changed between unlocks is itself
     * evidence that a second space exists, which is the whole thing the decoy is
     * for. Not awaited, for the same reason: the unlock must not take
     * measurably longer when a decoy is in play.
     */
    void uploadEscrow(real).catch(() => undefined);
    return { ok: true, space: 'real', key: real };
  }
  if (decoy) {
    // Not counted as a success against the throttle in any visible way, and not
    // counted as a failure either — the decoy must behave exactly like the real
    // thing from the outside.
    await clearFailures();
    return { ok: true, space: 'decoy', key: decoy };
  }

  await recordFailure();
  return { ok: false, reason: 'wrong-pin' };
}

/**
 * Changes the PIN for the real space by re-wrapping the same master key, so
 * nothing already encrypted has to be touched. Requires the current PIN.
 */
export async function changePin(currentPin: string, nextPin: string): Promise<boolean> {
  const result = await unlockVault(currentPin);
  if (!result.ok || result.space !== 'real') return false;

  const salt = randomBytes(16);
  const kek = await deriveKek(nextPin, salt);
  await writeItem(SALT_KEY, toBase64(salt));
  await writeItem(REAL_KEY, toBase64(encryptBytes(kek, result.key)));

  // The decoy was wrapped under the old salt and is now unopenable; drop it
  // rather than leaving a blob that can never be unlocked again.
  await removeDecoy();
  await clearFailures();
  return true;
}

/**
 * Forgets every key.
 *
 * Note this does NOT remove the operator's escrowed copy — that lives on the
 * server (supabase/migrations/0015) and is deleted with the account, not with
 * the local keys. Destroying the space locally therefore makes the data
 * unreadable *to the user*, while anything already synced remains openable by
 * the operator until the account itself is deleted.
 */
export async function destroyVaultKeys(): Promise<void> {
  // The server copy first, and awaited. Clearing the local keystore is what
  // makes the space unreadable to its owner; leaving the escrow behind is what
  // keeps it readable to an operator. Doing the local half and skipping the
  // remote one gets that exactly backwards, which is what happened before
  // migration 0025 added a delete policy for the row.
  await deleteEscrow().catch(() => false);

  await Promise.all(
    [SALT_KEY, REAL_KEY, DECOY_KEY, ATTEMPTS_KEY].map((key) =>
      SecureStore.deleteItemAsync(key).catch(() => undefined),
    ),
  );
}
