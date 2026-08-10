import { File } from 'expo-file-system';

import { encryptPhotoBytes } from '@/features/private/services/album-crypto';
import { createPhotoRow, markPhotoUploaded } from '@/features/private/services/album-repository';
import { reportError } from '@/lib/error-reporting';
import { supabase } from '@/lib/supabase';

/**
 * Encrypts and uploads one photo into a shared album.
 *
 * Not a modification of media-uploader.ts — that file uploads plaintext bytes
 * to a bucket keyed by owner uid (migration 0026), which is structurally the
 * wrong shape here: this bucket is keyed by album membership (0028) and its
 * bytes must never be plaintext in the first place. What IS reused is the
 * resumability idiom — a deterministic object path plus `upsert: true`, so a
 * retry after a half-finished attempt overwrites rather than orphaning — and
 * the ordering "the row exists before the bytes do," matching
 * `gallery_photos`/`remote_path`: `createPhotoRow` runs first because the
 * object path is built from the row's own id.
 */

export const SHARED_ALBUM_BUCKET = 'shared-albums';

/** Matches the bucket's own file_size_limit (0028). AES-GCM adds a fixed ~28
 *  bytes of overhead, negligible against a 50 MB ceiling, so the plaintext
 *  check below is a fine proxy for the ciphertext one Storage will make. */
const MAX_PLAINTEXT_BYTES = 50 * 1024 * 1024 - 4096;

export type AddPhotoInput = {
  albumId: string;
  albumKey: Uint8Array;
  addedBy: string;
  uri: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  captionCiphertext: string | null;
  position: number;
};

export type AddPhotoResult =
  | { ok: true; photoId: string }
  | { ok: false; reason: 'too-large' | 'unreadable' | 'quota' | 'failed' };

export async function addPhotoToAlbum(input: AddPhotoInput): Promise<AddPhotoResult> {
  let bytes: Uint8Array;
  let size = 0;
  try {
    const file = new File(input.uri);
    if (!file.exists) return { ok: false, reason: 'unreadable' };
    size = file.size ?? 0;
    if (size > MAX_PLAINTEXT_BYTES) return { ok: false, reason: 'too-large' };
    bytes = await file.bytes();
  } catch (error) {
    reportError(error, { scope: 'album-uploader:read' });
    return { ok: false, reason: 'unreadable' };
  }

  const photoId = await createPhotoRow({
    albumId: input.albumId,
    addedBy: input.addedBy,
    captionCiphertext: input.captionCiphertext,
    mimeType: input.mimeType,
    width: input.width,
    height: input.height,
    byteLength: size,
    position: input.position,
  });

  const ciphertext = encryptPhotoBytes(input.albumKey, bytes);
  const path = `${input.albumId}/${photoId}`;

  const { error } = await supabase.storage.from(SHARED_ALBUM_BUCKET).upload(path, ciphertext, {
    // The real type is meaningless once encrypted — see migration 0028's
    // header. What the object actually is lives in the row's own mime_type.
    contentType: 'application/octet-stream',
    upsert: true,
  });

  if (error) {
    // 0028's trigger raises with 'shared album storage quota exceeded'.
    // Recognised so the caller can stop and say so, rather than the rest of
    // the album failing one photo at a time with the same message.
    if (/quota/i.test(error.message)) return { ok: false, reason: 'quota' };
    reportError(error, { scope: 'album-uploader:put' });
    return { ok: false, reason: 'failed' };
  }

  await markPhotoUploaded(photoId, path);
  return { ok: true, photoId };
}
