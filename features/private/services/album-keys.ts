import * as SecureStore from 'expo-secure-store';

import {
  decryptBytes,
  encryptBytes,
  fromBase64,
  toBase64,
} from '@/features/private/services/vault-crypto';

/**
 * Custody of shared-album keys — the extension of the vault's own key
 * hierarchy that a shared album needs, and nothing more.
 *
 * Each album has its own random 32-byte key (see album-invite.ts, where it is
 * generated and handed to a co-member out of band). What this file adds is
 * somewhere for THIS device to keep its own copy: wrapped under the vault
 * master key — `encryptBytes(vaultKey, albumKey)` — and stored in SecureStore,
 * one item per album. Unwrapping therefore requires the vault to already be
 * unlocked, which is deliberate: a shared album is reachable only from inside
 * the already-unlocked private space (see private-modules.ts's
 * `requiresRealSpace`), and this ties the album key's own protection to that
 * same gate rather than inventing a second one.
 *
 * ⚠️ This blob must NEVER be synced, backed up, or escrowed — not to Supabase,
 * not via vault-escrow.ts's operator-escrow pattern, not by any future
 * "helpfully back this up" change. The album's whole end-to-end promise is
 * stronger than the vault's own (the vault carries an operator-escrow
 * exception; the album does not, by product decision) and it stays that way
 * only because this wrapped blob exists on-device and nowhere else. If you are
 * reading this because you want album keys to survive a reinstall: they
 * cannot, without reintroducing exactly the asterisk this was built to avoid.
 * Recovery is re-running the out-of-band transfer with a co-member, the same
 * as if the vault's own key-transfer had never happened for this device.
 */

function keyItem(albumId: string): string {
  return `daykeep.album.${albumId}.key`;
}

/** Wraps and stores this device's copy of `albumId`'s key. Called once, right
 *  after this device redeems the out-of-band transfer (or creates the album). */
export async function storeAlbumKey(
  albumId: string,
  vaultKey: Uint8Array,
  albumKey: Uint8Array,
): Promise<void> {
  await SecureStore.setItemAsync(keyItem(albumId), toBase64(encryptBytes(vaultKey, albumKey)), {
    // WHEN_UNLOCKED, matching vault-keys.ts: this is not reachable while the
    // phone is sitting locked on a table.
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}

/**
 * Unwraps this device's copy of `albumId`'s key with the currently-unlocked
 * vault key.
 *
 * Returns `null` rather than throwing on any failure — a decoy-space unlock,
 * a key that has not been redeemed on this device yet, or a corrupted blob
 * all read as "locked", the same idiom as vault-crypto.ts's
 * `tryDecryptString`. A locked album is a state the UI renders, not an error.
 */
export async function unwrapAlbumKey(
  vaultKey: Uint8Array,
  albumId: string,
): Promise<Uint8Array | null> {
  let wrapped: string | null;
  try {
    wrapped = await SecureStore.getItemAsync(keyItem(albumId));
  } catch {
    wrapped = null;
  }
  if (!wrapped) return null;

  try {
    return decryptBytes(vaultKey, fromBase64(wrapped));
  } catch {
    return null;
  }
}

/** Whether this device holds a copy of `albumId`'s key at all, independent of
 *  whether the vault is currently unlocked to unwrap it. */
export async function hasAlbumKey(albumId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(keyItem(albumId))) !== null;
  } catch {
    return false;
  }
}

/** Forgets this device's copy of `albumId`'s key — on leaving, being removed,
 *  or destroying the vault. Does not touch anything server-side; there is
 *  nothing server-side to touch, by design. */
export async function forgetAlbumKey(albumId: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyItem(albumId)).catch(() => undefined);
}
