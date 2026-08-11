import {
  decryptBytes,
  decryptString,
  encryptBytes,
  encryptString,
  tryDecryptString,
} from '@/features/private/services/vault-crypto';

/**
 * Ciphertext helpers for shared albums, over vault-crypto.ts's primitives.
 *
 * A separate, thin file rather than importing vault-crypto directly from
 * every album screen and repository function: one place to audit for "does
 * this actually encrypt before it leaves the device", which is the same
 * discipline album-uploader.ts depends on for photo bytes.
 *
 * The key these functions take is an album's own key (see album-keys.ts),
 * never the vault master key — an album's ciphertext and the vault's are not
 * interchangeable, and nothing here confuses the two.
 */

export function encryptAlbumName(albumKey: Uint8Array, name: string): string {
  return encryptString(albumKey, name);
}

export function decryptAlbumName(albumKey: Uint8Array, ciphertext: string): string {
  return decryptString(albumKey, ciphertext);
}

/**
 * Null when this key cannot open it, rather than a throw — a locked album (the
 * key has not arrived yet, or has not been redeemed on this device) is a
 * normal state to render, not an error.
 */
export function tryDecryptAlbumName(albumKey: Uint8Array, ciphertext: string): string | null {
  return tryDecryptString(albumKey, ciphertext);
}

export function encryptCaption(albumKey: Uint8Array, caption: string): string {
  return encryptString(albumKey, caption);
}

export function tryDecryptCaption(albumKey: Uint8Array, ciphertext: string): string | null {
  return tryDecryptString(albumKey, ciphertext);
}

// --- comments & chat (0029) --------------------------------------------------
// Same shape as the caption pair above: encrypt is a throw (the writer always
// holds the key it just used to unlock the screen), decrypt is null-on-failure
// (a reader's key may not have arrived yet, or this may be a message posted
// under a since-rotated key on some future build).

export function encryptComment(albumKey: Uint8Array, body: string): string {
  return encryptString(albumKey, body);
}

export function tryDecryptComment(albumKey: Uint8Array, ciphertext: string): string | null {
  return tryDecryptString(albumKey, ciphertext);
}

export function encryptMessage(albumKey: Uint8Array, body: string): string {
  return encryptString(albumKey, body);
}

export function tryDecryptMessage(albumKey: Uint8Array, ciphertext: string): string | null {
  return tryDecryptString(albumKey, ciphertext);
}

export function encryptPhotoBytes(albumKey: Uint8Array, plaintext: Uint8Array): Uint8Array {
  return encryptBytes(albumKey, plaintext);
}

export function decryptPhotoBytes(albumKey: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  return decryptBytes(albumKey, ciphertext);
}

// --- shared plans, milestones & notes (0038-0040) ----------------------------
// Same shape as comments/messages above: encrypt is a throw, decrypt is
// null-on-failure. Only `title`/`notes`/`body` are ever sealed — the dates
// on events and milestones are plaintext columns (see those migrations'
// headers), so there is nothing here to encrypt/decrypt for them.

export function encryptEventTitle(albumKey: Uint8Array, text: string): string {
  return encryptString(albumKey, text);
}

export function tryDecryptEventTitle(albumKey: Uint8Array, ciphertext: string): string | null {
  return tryDecryptString(albumKey, ciphertext);
}

export function encryptEventNotes(albumKey: Uint8Array, text: string): string {
  return encryptString(albumKey, text);
}

export function tryDecryptEventNotes(albumKey: Uint8Array, ciphertext: string): string | null {
  return tryDecryptString(albumKey, ciphertext);
}

export function encryptMilestoneTitle(albumKey: Uint8Array, text: string): string {
  return encryptString(albumKey, text);
}

export function tryDecryptMilestoneTitle(albumKey: Uint8Array, ciphertext: string): string | null {
  return tryDecryptString(albumKey, ciphertext);
}

export function encryptNoteBody(albumKey: Uint8Array, text: string): string {
  return encryptString(albumKey, text);
}

export function tryDecryptNoteBody(albumKey: Uint8Array, ciphertext: string): string | null {
  return tryDecryptString(albumKey, ciphertext);
}
