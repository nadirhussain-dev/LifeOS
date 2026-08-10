import { x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { useAuthStore } from '@/features/auth/services/auth-store';
import {
  encryptBytes,
  fromBase64,
  randomBytes,
  toBase64,
} from '@/features/private/services/vault-crypto';
import { env, isSupabaseConfigured } from '@/lib/env';
import { reportError } from '@/lib/error-reporting';
import { supabase } from '@/lib/supabase';

/**
 * Sealing the vault master key to the operator, so the operator can open a
 * user's private space.
 *
 * ⚠️  This is the mechanism that ends end-to-end encryption in LifeOS. It is a
 * deliberate product decision (abuse handling), not an accident, and the app's
 * copy and privacy policy have been changed to say so. If you are here because
 * you assumed the vault was E2E: it is not, and has not been since 0015.
 *
 * How the sealing works
 * ---------------------
 * Standard ECIES over X25519, which is the right shape for "encrypt to a
 * recipient who is not present":
 *
 *   1. Generate a throwaway X25519 keypair on the device.
 *   2. Derive a shared secret from the ephemeral private key and the operator's
 *      public key, and hash it into an AES key.
 *   3. AES-GCM the vault master key under it.
 *   4. Upload the ephemeral *public* key and the sealed blob; discard the
 *      ephemeral private key.
 *
 * The operator later derives the same shared secret from their private key and
 * the stored ephemeral public key. Nobody else can — not another user, not
 * somebody holding a full database dump, not the app itself after step 4.
 *
 * Where the operator private key must live
 * ----------------------------------------
 * Offline. Not in this repo, not in an env var on the same platform as the
 * database, ideally in an HSM. It is the one secret whose exposure turns every
 * escrow row into plaintext, and the database it opens is a far more likely
 * breach target than a key kept out of the deployment entirely.
 *
 * If `EXPO_PUBLIC_VAULT_ESCROW_PUBLIC_KEY` is unset, escrow silently does not
 * happen and the vault stays genuinely private. That is the safe default: a
 * misconfigured build must not quietly upload keys, and it also means a fork of
 * this app that removes the key is E2E again.
 */

/** Bumped when the operator keypair is rotated, so old blobs stay openable by
 * the key they were actually sealed to. */
const ESCROW_KEY_VERSION = 1;

function operatorPublicKey(): Uint8Array | null {
  const encoded = env.EXPO_PUBLIC_VAULT_ESCROW_PUBLIC_KEY;
  if (!encoded) return null;
  try {
    const key = fromBase64(encoded);
    // X25519 public keys are exactly 32 bytes; anything else is a
    // misconfiguration that would otherwise fail deep inside the curve code.
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export function isEscrowConfigured(): boolean {
  return operatorPublicKey() !== null;
}

export type EscrowBlob = {
  keyVersion: number;
  ephemeralPublicKey: string;
  wrappedKey: string;
};

/** Seals `masterKey` to the operator. Returns null when escrow is not
 * configured for this build. */
export function sealToOperator(masterKey: Uint8Array): EscrowBlob | null {
  const operatorKey = operatorPublicKey();
  if (!operatorKey) return null;

  const ephemeralPrivate = randomBytes(32);
  const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate);

  // Hashed rather than used raw: the X25519 shared secret is a curve point,
  // not a uniformly random key, and AES wants the latter.
  const shared = sha256(x25519.getSharedSecret(ephemeralPrivate, operatorKey));

  const wrapped = encryptBytes(shared, masterKey);

  // The ephemeral private key and the derived secret are both dead now. They
  // are local `const`s, so they go out of scope here and nothing on the device
  // can reconstruct the wrap.
  return {
    keyVersion: ESCROW_KEY_VERSION,
    ephemeralPublicKey: toBase64(ephemeralPublic),
    wrappedKey: toBase64(wrapped),
  };
}

/**
 * Uploads the escrow blob for the signed-in account.
 *
 * No-ops for guests: there is no account to attach it to, and a guest's vault
 * therefore stays genuinely unopenable. Worth knowing when reasoning about
 * what the operator can actually reach.
 */
export async function uploadEscrow(masterKey: Uint8Array): Promise<boolean> {
  const uid = useAuthStore.getState().user?.id;
  if (!uid || !isSupabaseConfigured) return false;

  const blob = sealToOperator(masterKey);
  if (!blob) return false;

  /**
   * Through an RPC, not a table write — and this is the fix for a bug that made
   * the whole escrow scheme inert.
   *
   * `vault_escrow` has no SELECT policy, by design: the sealed blob is meant to
   * leave only through the audited admin function. But Postgres refuses
   * `INSERT … ON CONFLICT DO UPDATE` against a table the caller cannot select
   * from — the conflict path has to read the row — and it refuses it **whether
   * or not a conflicting row exists**. PostgREST's `.upsert()` emits exactly
   * that statement, so every escrow upload since 0015 failed silently, and the
   * one caller `await`s this without checking the result. `vault_escrow` has
   * been empty the whole time.
   *
   * The same gap rules out the obvious repairs: `UPDATE … WHERE user_id = …`
   * and `DELETE … WHERE user_id = …` both need the WHERE clause to see the row,
   * so both match nothing and report success. Migration 0025 adds a SECURITY
   * DEFINER function instead, which runs outside RLS and takes no user id.
   */
  const { error } = await supabase.rpc('set_own_vault_escrow', {
    p_key_version: blob.keyVersion,
    p_ephemeral_public_key: blob.ephemeralPublicKey,
    p_wrapped_key: blob.wrappedKey,
  });
  if (error) reportError(error, { scope: 'vault-escrow:upload' });
  return !error;
}

/**
 * Removes this account's escrow row.
 *
 * Called when the private space is destroyed. Until migration 0025 there was no
 * delete policy on `vault_escrow`, so destroying the space cleared the local
 * keystore and left the sealed key on the server — the space became unreadable
 * to its owner while staying readable to an operator, which is exactly
 * backwards for the most explicit "I want this gone" the app offers.
 *
 * Returns false when there was nothing to do or the delete failed, so the caller
 * can tell the difference between "removed" and "assume it is still there".
 */
export async function deleteEscrow(): Promise<boolean> {
  const uid = useAuthStore.getState().user?.id;
  if (!uid || !isSupabaseConfigured) return false;

  // An RPC for the same reason as the upload: with no SELECT policy on the
  // table, `DELETE … WHERE user_id = …` cannot see the row it is filtering on,
  // so it deletes nothing and reports success — the worst possible answer for a
  // "remove my key from your servers" button.
  const { error } = await supabase.rpc('delete_own_vault_escrow');
  if (error) reportError(error, { scope: 'vault-escrow:delete' });
  return !error;
}

/**
 * Operator-side unwrap. Not called by the app — it lives here so the two halves
 * of the scheme are read together, and so the format is documented by working
 * code rather than by prose that drifts.
 *
 * Run it from a trusted machine holding the operator private key, never from
 * anything with the database credentials on it.
 */
export function unsealAsOperator(
  operatorPrivateKey: Uint8Array,
  blob: EscrowBlob,
  decrypt: (key: Uint8Array, payload: Uint8Array) => Uint8Array,
): Uint8Array {
  const shared = sha256(
    x25519.getSharedSecret(operatorPrivateKey, fromBase64(blob.ephemeralPublicKey)),
  );
  return decrypt(shared, fromBase64(blob.wrappedKey));
}

/** Generates an operator keypair. Run once, offline, and keep the private half
 * out of this repository and out of the deployment. */
export function generateOperatorKeypair(): { publicKey: string; privateKey: string } {
  const privateKey = randomBytes(32);
  return {
    publicKey: toBase64(x25519.getPublicKey(privateKey)),
    privateKey: toBase64(privateKey),
  };
}
