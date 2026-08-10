import {
  decryptBytes,
  deriveKek,
  encryptBytes,
  fromBase64,
  randomBytes,
  toBase64,
} from '@/features/private/services/vault-crypto';

/**
 * Moving the vault key to a second device the same person owns.
 *
 * ## Why this is the missing piece and not the whole feature
 *
 * Private modules already sync end-to-end. `private_entries.payload` has been
 * `base64(nonce || AES-GCM(...))` since the vault was built, 0015 gave the
 * server a table to hold it with per-user RLS, and the sync engine moves it like
 * any other row. The server has never been able to read a byte of it.
 *
 * What has never worked is *opening* it anywhere else. The key is wrapped under
 * PBKDF2(PIN, salt) where the salt is generated per device and lives in that
 * device's keystore, so the same PIN on a second phone derives a different key
 * and the ciphertext stays closed. Syncing the rows without moving the key just
 * gives the second device a pile of noise.
 *
 * ## The protocol
 *
 * Two channels, and the separation is the entire security argument:
 *
 *   - The **payload** — the master key, wrapped under a key derived from a
 *     one-time code — can travel however the user likes. Message it, AirDrop it,
 *     paste it. It is useless on its own.
 *   - The **code** travels separately, ideally spoken. Six groups of four
 *     characters from an unambiguous alphabet, so it can be read aloud down a
 *     phone line without "was that a B or a D".
 *
 * Neither ever reaches our server, which is the requirement TODO.md states for
 * this whole family of features: anything that posts the key to Supabase
 * silently converts an end-to-end scheme into a server-readable one.
 *
 * ## What this is not
 *
 * Not a recovery mechanism. There is no server-side path back into a vault whose
 * PIN is forgotten and whose devices are gone, deliberately — that would be
 * escrow by another name, and this app already has one escrow scheme it is
 * honest about.
 */

/**
 * Crockford-style base32 minus the characters people mishear or mistype.
 * No I, L, O, U, 0 or 1 — the pairs that break a code read down a phone.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE_GROUPS = 6;
const GROUP_SIZE = 4;

/** 24 characters from a 30-symbol alphabet is about 118 bits — far past what a
 *  code with one use and no online guessing surface needs, and still readable. */
export function generateTransferCode(): string {
  const bytes = randomBytes(CODE_GROUPS * GROUP_SIZE);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  const groups: string[] = [];
  for (let i = 0; i < CODE_GROUPS; i += 1) {
    groups.push(chars.slice(i * GROUP_SIZE, (i + 1) * GROUP_SIZE).join(''));
  }
  return groups.join('-');
}

/**
 * Accepts a code however the user typed it.
 *
 * Case and separators are noise — somebody reading a code off a screen onto
 * another screen should not be defeated by having typed spaces instead of
 * dashes. The alphabet has no ambiguous characters, so nothing here has to
 * guess what was meant.
 */
export function normaliseTransferCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export type TransferBundle = {
  /** Shown on the sending device, read aloud or typed on the receiving one. */
  code: string;
  /** The wrapped key. Safe to send over any channel; useless without the code. */
  payload: string;
};

const VERSION = 1;

/**
 * Wraps `masterKey` for transfer.
 *
 * The salt is fresh per transfer, so the same vault moved twice produces two
 * unrelated payloads — a payload captured from an earlier transfer cannot be
 * opened with a later code, and vice versa.
 */
export async function createTransfer(masterKey: Uint8Array): Promise<TransferBundle> {
  const code = generateTransferCode();
  const salt = randomBytes(16);
  const wrappingKey = await deriveKek(normaliseTransferCode(code), salt);
  const sealed = encryptBytes(wrappingKey, masterKey);

  // version.salt.sealed — the version prefix so a future format change can be
  // refused with a clear message rather than failing as a bad decrypt.
  return { code, payload: `${VERSION}.${toBase64(salt)}.${toBase64(sealed)}` };
}

export type RedeemResult =
  | { ok: true; masterKey: Uint8Array }
  | { ok: false; reason: 'malformed' | 'unsupported-version' | 'wrong-code' };

/**
 * Unwraps a transfer payload with the code that accompanies it.
 *
 * `wrong-code` and a corrupted payload are deliberately the same answer to the
 * caller: AES-GCM fails identically either way, and inventing a distinction the
 * cryptography does not make would mean guessing.
 */
export async function redeemTransfer(payload: string, code: string): Promise<RedeemResult> {
  const parts = payload.trim().split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };

  const [version, saltRaw, sealedRaw] = parts;
  if (version !== String(VERSION)) return { ok: false, reason: 'unsupported-version' };

  let salt: Uint8Array;
  let sealed: Uint8Array;
  try {
    salt = fromBase64(saltRaw);
    sealed = fromBase64(sealedRaw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (salt.length !== 16 || sealed.length === 0) return { ok: false, reason: 'malformed' };

  try {
    const wrappingKey = await deriveKek(normaliseTransferCode(code), salt);
    const masterKey = decryptBytes(wrappingKey, sealed);
    // A 32-byte result is the only shape a vault master key has; anything else
    // means the decrypt "succeeded" on something that was never a key.
    if (masterKey.length !== 32) return { ok: false, reason: 'wrong-code' };
    return { ok: true, masterKey };
  } catch {
    return { ok: false, reason: 'wrong-code' };
  }
}
