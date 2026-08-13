import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import * as Crypto from 'expo-crypto';

/**
 * The private space's cryptography, and nothing above it.
 *
 * Key hierarchy, which is the part worth understanding:
 *
 *   PIN ──pbkdf2──▶ KEK ──AES-GCM──▶ (wrapped VMK)
 *                                          │
 *                                       unwraps
 *                                          ▼
 *                                         VMK ──AES-GCM──▶ rows, files
 *
 * The Vault Master Key (VMK) is random and never derived from the PIN. That
 * indirection is what makes changing the PIN a re-wrap of 32 bytes instead of
 * re-encrypting every photo, and it is what lets a *second* PIN unwrap a
 * *different* VMK — which is the whole mechanism behind the decoy space.
 *
 * ⚠️  NOT end-to-end encrypted as shipped. When the build carries an operator
 * escrow key, the VMK is ALSO wrapped to that key and uploaded, so the operator
 * can open any private space — see vault-escrow.ts and migration 0015. The
 * crypto below is unchanged and still protects the data at rest and from other
 * users; what it no longer does is exclude the operator.
 *
 * Pure JS on purpose (@noble). It works in a dev client and in Expo Go with no
 * native rebuild, so the vault is real today rather than after a build that
 * `expo export` cannot verify. The cost is speed: see PBKDF2_ITERATIONS.
 */

/**
 * 60k, already well below the OWASP floor for PBKDF2-SHA256 (210k) even
 * before this second trim down from the original 120k, and the reasoning
 * matters more than the number.
 *
 * Stretching cannot rescue a short PIN: at 210k a six-digit PIN still falls in
 * hours to anyone holding the wrapped key, and the honest conclusion is that
 * iteration count is not what protects this. What protects it is that the
 * wrapped key lives in SecureStore — the hardware keystore — so an attacker
 * with the app's files and no device passcode never obtains the blob to attack
 * in the first place (see vault-keys.ts), plus the attempt throttling there.
 *
 * So this is set where it is genuinely useful — real defence in depth if the
 * keystore is ever defeated — without spending a real person's time on every
 * unlock. In pure JS on a mid-range phone this lands well under half a
 * second; `pbkdf2Async` yields between blocks so the UI keeps painting.
 * (On an unaccelerated x86_64 emulator, with no hardware SHA256 and no JIT
 * warmup for the hot loop, the same 60k can still take several seconds —
 * that gap is the environment, not this number; see use-vault-transition.ts
 * for why that wait gets a persistent animated overlay instead of a frozen
 * screen either way.)
 */
const PBKDF2_ITERATIONS = 60_000;
const KEY_BYTES = 32;
/** AES-GCM standard nonce length. Anything else is a compatibility trap. */
const NONCE_BYTES = 12;

export type Ciphertext = string;

// --- encoding ---------------------------------------------------------------

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Hermes has no Buffer and its atob/btoa handling of binary is unreliable, so
 * the two conversions the vault depends on are written out rather than assumed. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += BASE64[a >> 2];
    out += BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : BASE64[c & 63];
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = BASE64.indexOf(clean[i]);
    const b = BASE64.indexOf(clean[i + 1]);
    const c = BASE64.indexOf(clean[i + 2]);
    const d = BASE64.indexOf(clean[i + 3]);
    out[p++] = (a << 2) | (b >> 4);
    if (c >= 0) out[p++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) out[p++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, p);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// --- keys -------------------------------------------------------------------

/** expo-crypto refuses more than 1024 bytes in one call. The vault only ever
 * needs 12–32, but a silent throw the first time somebody asks for more is a
 * bad way to find that out. */
const MAX_RANDOM_CHUNK = 1024;

export function randomBytes(length: number): Uint8Array {
  if (length <= MAX_RANDOM_CHUNK) return Crypto.getRandomBytes(length);
  const out = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += MAX_RANDOM_CHUNK) {
    out.set(Crypto.getRandomBytes(Math.min(MAX_RANDOM_CHUNK, length - offset)), offset);
  }
  return out;
}

/** Stretches a PIN into a key-encryption key. Slow by design. */
export async function deriveKek(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  return pbkdf2Async(sha256, encoder.encode(pin.normalize('NFKC')), salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: KEY_BYTES,
  });
}

export function generateMasterKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

// --- symmetric encryption ---------------------------------------------------

/** Encrypts bytes under `key`, returning `nonce || ciphertext||tag`. A fresh
 * nonce per call is not optional with GCM — reusing one with the same key
 * leaks the plaintext relationship between the two messages. */
export function encryptBytes(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const nonce = randomBytes(NONCE_BYTES);
  const sealed = gcm(key, nonce).encrypt(plaintext);
  const out = new Uint8Array(nonce.length + sealed.length);
  out.set(nonce, 0);
  out.set(sealed, nonce.length);
  return out;
}

/**
 * Reverses encryptBytes. Throws when the key is wrong — GCM authenticates, so a
 * bad key fails loudly rather than returning plausible garbage.
 *
 * That failure is load-bearing twice over: it is how a wrong PIN is detected
 * without storing anything to compare against, and it is how the decoy space
 * stays empty (real rows simply refuse to open under the decoy key).
 */
export function decryptBytes(key: Uint8Array, payload: Uint8Array): Uint8Array {
  const nonce = payload.subarray(0, NONCE_BYTES);
  const sealed = payload.subarray(NONCE_BYTES);
  return gcm(key, nonce).decrypt(sealed);
}

export function encryptString(key: Uint8Array, plaintext: string): Ciphertext {
  return toBase64(encryptBytes(key, encoder.encode(plaintext)));
}

export function decryptString(key: Uint8Array, payload: Ciphertext): string {
  return decoder.decode(decryptBytes(key, fromBase64(payload)));
}

/** Decrypts, or returns null if this key cannot open it. The only place a
 * failed decrypt is normal rather than an error: reading a mixed list where
 * some rows belong to the other space. */
export function tryDecryptString(key: Uint8Array, payload: Ciphertext): string | null {
  try {
    return decryptString(key, payload);
  } catch {
    return null;
  }
}
