import { Directory, File, Paths } from 'expo-file-system';

import { decryptPhotoBytes } from '@/features/private/services/album-crypto';
import { SHARED_ALBUM_BUCKET } from '@/features/private/services/album-uploader';
import { toBase64 } from '@/features/private/services/vault-crypto';
import { reportError } from '@/lib/error-reporting';
import { supabase } from '@/lib/supabase';

/**
 * Caches shared-album photo CIPHERTEXT on device, and decrypts to memory only
 * at the point of rendering.
 *
 * Not a modification of media-cache.ts — that cache holds plaintext by
 * design, which is exactly what must not happen here. The file this writes to
 * disk stays exactly as encrypted as the object in Storage; only
 * `decryptPhotoAsDataUri`'s return value is ever plaintext, and it lives in
 * memory for the lifetime of one render — the same discipline
 * `vault-files.ts`'s `readVaultFileAsDataUri` uses for vault images, and for
 * the same reason: a decrypted copy on disk outlives the lock.
 */

const CACHE_DIRNAME = 'shared-album-cache';

function cacheDirectory(): Directory {
  const dir = new Directory(Paths.document, CACHE_DIRNAME);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** In-flight downloads, so two components rendering the same photo in the
 *  same frame produce one request rather than two — mirrors media-cache.ts. */
const inFlight = new Map<string, Promise<Uint8Array | null>>();

/** Downloads (or reuses a cached copy of) a photo's ciphertext. Returns null
 *  rather than throwing when the bytes cannot be had — offline, a revoked
 *  session, a deleted object. */
export function ensureLocalCiphertext(
  photoId: string,
  remotePath: string,
): Promise<Uint8Array | null> {
  const existing = inFlight.get(photoId);
  if (existing) return existing;

  const job = download(photoId, remotePath).finally(() => inFlight.delete(photoId));
  inFlight.set(photoId, job);
  return job;
}

async function download(photoId: string, remotePath: string): Promise<Uint8Array | null> {
  try {
    const target = new File(cacheDirectory(), photoId);
    if (target.exists) return target.bytesSync();

    const { data, error } = await supabase.storage.from(SHARED_ALBUM_BUCKET).download(remotePath);
    if (error || !data) return null;

    const bytes = new Uint8Array(await data.arrayBuffer());
    target.create({ overwrite: true });
    target.write(bytes);
    return bytes;
  } catch (error) {
    reportError(error, { scope: 'album-cache:download' });
    return null;
  }
}

/**
 * Fetches (if needed) and decrypts a photo, returning a `data:` URI.
 *
 * Returns null when the bytes cannot be fetched OR when `albumKey` cannot
 * open them — the latter is a locked photo (this device has not redeemed the
 * album's key yet), not an error, and the caller cannot tell which happened
 * from the result alone, matching `tryDecryptString`'s reasoning.
 */
export async function decryptPhotoAsDataUri(
  photoId: string,
  remotePath: string,
  mimeType: string | null,
  albumKey: Uint8Array,
): Promise<string | null> {
  const ciphertext = await ensureLocalCiphertext(photoId, remotePath);
  if (!ciphertext) return null;

  try {
    const plaintext = decryptPhotoBytes(albumKey, ciphertext);
    return `data:${mimeType ?? 'application/octet-stream'};base64,${toBase64(plaintext)}`;
  } catch {
    return null;
  }
}

/** Total bytes held by the cache — still ciphertext. */
export function cachedSharedAlbumBytes(): number {
  try {
    const dir = new Directory(Paths.document, CACHE_DIRNAME);
    if (!dir.exists) return 0;
    return dir
      .list()
      .reduce((sum, entry) => sum + (entry instanceof File ? (entry.size ?? 0) : 0), 0);
  } catch {
    return 0;
  }
}

/** Removes every cached ciphertext file. Originals stay in Storage and can be
 *  re-fetched — nothing here is the only copy of anything, unlike the vault's
 *  local-only files. */
export function clearSharedAlbumCache(): void {
  try {
    const dir = new Directory(Paths.document, CACHE_DIRNAME);
    if (dir.exists) dir.delete();
  } catch (error) {
    reportError(error, { scope: 'album-cache:clear' });
  }
}
