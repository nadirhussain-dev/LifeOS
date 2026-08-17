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

/**
 * Version 1 seals the 32-byte master key and nothing else. Version 2 seals a
 * JSON object holding that key **and** this device's shared-album keys.
 *
 * ## Why v2 exists
 *
 * Moving the vault used to move the vault only. Shared albums have their own
 * per-album keys (album-keys.ts), kept wrapped in this device's keystore and
 * nowhere else — so a person who moved to a new phone arrived with every
 * private module intact and every shared album shut: the messages and photos
 * synced down from the server exactly as designed and could not be opened,
 * which reads as data loss and is indistinguishable from it.
 *
 * The album keys ride inside the *same sealed blob* as the master key rather
 * than in a second transfer. That is the property worth protecting: they are
 * covered by the same one-time code, over the same two channels, and they still
 * never touch a server. Nothing about the security argument in this file's
 * header changes — the payload got bigger, not weaker.
 *
 * ## Why v1 is still emitted
 *
 * `album-invite.ts` reuses `createTransfer` to hand ONE album key to a
 * co-member. That payload must stay a bare key: the recipient is not adopting a
 * vault and has no business receiving a map of albums they are not in. So
 * `createTransfer` is untouched and v2 has its own entry point.
 *
 * A v2 payload presented to an older build is refused as `unsupported-version`,
 * which is the one honest answer available and already has a message.
 */
const VERSION = 1;
const VERSION_WITH_ALBUMS = 2;

/** Album id → the album's 32-byte key, as this device holds them. */
export type AlbumKeyMap = Record<string, Uint8Array>;

/** The wire shape of a v2 payload, before sealing. Keys are single letters
 *  because this blob is base64'd into something a person may have to paste. */
type VaultBundleJson = {
  /** base64 master key. */
  k: string;
  /** album id → base64 album key. */
  a: Record<string, string>;
};

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

/**
 * Wraps `masterKey` **and** this device's album keys for transfer to another
 * device the same person owns.
 *
 * Same code, same salt-per-transfer, same two channels as `createTransfer` —
 * see the note on `VERSION_WITH_ALBUMS` for why the albums travel inside the
 * one sealed blob instead of alongside it.
 */
export async function createVaultTransfer(
  masterKey: Uint8Array,
  albumKeys: AlbumKeyMap,
): Promise<TransferBundle> {
  const code = generateTransferCode();
  const salt = randomBytes(16);
  const wrappingKey = await deriveKek(normaliseTransferCode(code), salt);

  const bundle: VaultBundleJson = {
    k: toBase64(masterKey),
    a: Object.fromEntries(Object.entries(albumKeys).map(([id, key]) => [id, toBase64(key)])),
  };
  const sealed = encryptBytes(wrappingKey, new TextEncoder().encode(JSON.stringify(bundle)));

  return {
    code,
    payload: `${VERSION_WITH_ALBUMS}.${toBase64(salt)}.${toBase64(sealed)}`,
  };
}

export type RedeemResult =
  | {
      ok: true;
      masterKey: Uint8Array;
      /** Empty for a v1 payload and for an album invite, which carries one key
       *  and is not a vault adoption — see `createTransfer`. */
      albumKeys: AlbumKeyMap;
    }
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
  const carriesAlbums = version === String(VERSION_WITH_ALBUMS);
  if (version !== String(VERSION) && !carriesAlbums) {
    return { ok: false, reason: 'unsupported-version' };
  }

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
    const plaintext = decryptBytes(wrappingKey, sealed);

    if (!carriesAlbums) {
      // A 32-byte result is the only shape a vault master key has; anything else
      // means the decrypt "succeeded" on something that was never a key.
      if (plaintext.length !== 32) return { ok: false, reason: 'wrong-code' };
      return { ok: true, masterKey: plaintext, albumKeys: {} };
    }

    return parseVaultBundle(plaintext);
  } catch {
    return { ok: false, reason: 'wrong-code' };
  }
}

/**
 * Reads a v2 blob back into keys.
 *
 * Every failure here answers `wrong-code`, and that is not laziness: this runs
 * only after AES-GCM has already authenticated the plaintext, so a blob that
 * decrypts and then does not parse is not a wrong code and not a corrupt
 * payload either — it is something that was never one of ours. There is no
 * third answer worth inventing, and the two that exist both mean "start again".
 *
 * A malformed album entry is skipped rather than failing the whole transfer.
 * Arriving with the vault and nine albums out of ten is strictly better than
 * arriving with nothing, and the tenth is recoverable by re-sharing with a
 * co-member — which is exactly what a device that never had it would do.
 */
function parseVaultBundle(plaintext: Uint8Array): RedeemResult {
  let parsed: VaultBundleJson;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext)) as VaultBundleJson;
  } catch {
    return { ok: false, reason: 'wrong-code' };
  }
  if (!parsed || typeof parsed.k !== 'string') return { ok: false, reason: 'wrong-code' };

  let masterKey: Uint8Array;
  try {
    masterKey = fromBase64(parsed.k);
  } catch {
    return { ok: false, reason: 'wrong-code' };
  }
  if (masterKey.length !== 32) return { ok: false, reason: 'wrong-code' };

  const albumKeys: AlbumKeyMap = {};
  for (const [id, encoded] of Object.entries(parsed.a ?? {})) {
    if (typeof encoded !== 'string') continue;
    try {
      const key = fromBase64(encoded);
      if (key.length === 32) albumKeys[id] = key;
    } catch {
      // Skipped — see the note above.
    }
  }

  return { ok: true, masterKey, albumKeys };
}
