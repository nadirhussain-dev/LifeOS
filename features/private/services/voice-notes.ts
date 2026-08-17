import { File, Directory, Paths } from 'expo-file-system';

import {
  decryptPhotoBytes,
  encryptMessage,
  encryptPhotoBytes,
} from '@/features/private/services/album-crypto';
import {
  createVoiceMessageRow,
  markVoiceUploaded,
} from '@/features/private/services/album-repository';
import { SHARED_ALBUM_BUCKET } from '@/features/private/services/album-uploader';
import { reportError } from '@/lib/error-reporting';
import { supabase } from '@/lib/supabase';

/**
 * Sending and opening voice notes.
 *
 * The upload half mirrors `album-uploader.ts` exactly — row first (the object
 * path is built from its id), deterministic path, `upsert: true` so a retry
 * overwrites instead of orphaning, `voice_path` written last as the record
 * that the bytes landed.
 *
 * ## The plaintext file, which is a real compromise
 *
 * `album-cache.ts` never writes a decrypted photo to disk: it decrypts into a
 * `data:` URI that lives for one render. That is not available here. Both
 * platforms' audio players want a file or a streamable URL, and neither plays
 * a `data:` URI reliably, so playing a voice note means a decrypted file
 * exists for as long as it is playing.
 *
 * What is done about it, given it cannot be avoided:
 *
 *  * The file goes in `Paths.cache`, not `Paths.document` — the OS may evict
 *    it, it is excluded from device backups, and it is the correct place for
 *    something we are willing to lose.
 *  * `releaseVoiceNote` deletes it as soon as playback stops or the bubble
 *    unmounts, so the window is the length of the note, not the session.
 *  * `purgeVoiceScratch` empties the whole directory, and the player hook
 *    calls it the moment the vault locks — the case that actually matters,
 *    since "locked" is the state the user believes protects this.
 *
 * The ciphertext copy is cached separately and permanently, exactly like a
 * photo's; only the decrypted scratch file is transient.
 */

/** Matches migration 0054's `enforce_voice_object_size` — refuse locally with
 *  a sentence rather than letting the trigger raise at the end of an upload
 *  the user has already waited through. */
const MAX_VOICE_CIPHERTEXT_BYTES = 16 * 1024 * 1024;

/** Matches the `voice_duration_ms` check constraint (10 minutes). */
export const MAX_VOICE_DURATION_MS = 600000;

const SCRATCH_DIRNAME = 'voice-scratch';

/** The path convention migration 0054's premium carve-out keys off. The
 *  `voice/` segment is load-bearing — an object stored anywhere else in this
 *  bucket is gated behind a paid plan. */
export function voiceObjectPath(albumId: string, messageId: string): string {
  return `${albumId}/voice/${messageId}.bin`;
}

/**
 * mm:ss. Voice notes are capped at ten minutes, so an hours component would be
 * dead code everybody after us still has to read.
 *
 * Lives here rather than beside the bubble that renders it because that
 * component imports `expo-audio`, which does not load under jest — a pure
 * formatter is not worth making untestable to keep next to its only caller.
 */
export function formatVoiceDuration(ms: number | null): string {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export type SendVoiceNoteInput = {
  albumId: string;
  albumKey: Uint8Array;
  authorId: string;
  authorName: string | null;
  /** Local file the recorder produced. */
  uri: string;
  durationMs: number;
  replyToId?: string | null;
};

export type SendVoiceNoteResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: 'too-long' | 'too-large' | 'unreadable' | 'quota' | 'failed' };

export async function sendVoiceNote(input: SendVoiceNoteInput): Promise<SendVoiceNoteResult> {
  if (input.durationMs > MAX_VOICE_DURATION_MS) return { ok: false, reason: 'too-long' };

  let plaintext: Uint8Array;
  try {
    const file = new File(input.uri);
    if (!file.exists) return { ok: false, reason: 'unreadable' };
    plaintext = await file.bytes();
  } catch (error) {
    reportError(error, { scope: 'voice-notes:read' });
    return { ok: false, reason: 'unreadable' };
  }

  const ciphertext = encryptPhotoBytes(input.albumKey, plaintext);
  if (ciphertext.byteLength > MAX_VOICE_CIPHERTEXT_BYTES) return { ok: false, reason: 'too-large' };

  // The body column is `not null`, and a voice note has no text. Encrypting an
  // empty string rather than storing '' keeps every body in this table opaque
  // — one plaintext value would be the exception somebody later reasons from.
  const messageId = await createVoiceMessageRow({
    albumId: input.albumId,
    authorId: input.authorId,
    authorName: input.authorName,
    bodyCiphertext: encryptMessage(input.albumKey, ''),
    durationMs: Math.round(input.durationMs),
    byteLength: ciphertext.byteLength,
    replyToId: input.replyToId ?? null,
  });

  const path = voiceObjectPath(input.albumId, messageId);
  const { error } = await supabase.storage.from(SHARED_ALBUM_BUCKET).upload(path, ciphertext, {
    contentType: 'application/octet-stream',
    upsert: true,
  });

  if (error) {
    if (/quota/i.test(error.message)) return { ok: false, reason: 'quota' };
    reportError(error, { scope: 'voice-notes:put' });
    return { ok: false, reason: 'failed' };
  }

  await markVoiceUploaded(messageId, path);
  return { ok: true, messageId };
}

function scratchDirectory(): Directory {
  const dir = new Directory(Paths.cache, SCRATCH_DIRNAME);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** `.m4a`, because both platforms' players pick a decoder from the extension
 *  and a bare id decodes as nothing. Matches `RecordingPresets.HIGH_QUALITY`,
 *  which is what the recorder is configured with. */
function scratchFile(messageId: string): File {
  return new File(scratchDirectory(), `${messageId}.m4a`);
}

/**
 * Downloads, decrypts and writes a playable file, returning its URI.
 *
 * Returns null rather than throwing for every failure — offline, a key this
 * device has not redeemed, an upload that never finished. A voice note that
 * cannot be opened is a state the bubble renders, not an error, matching
 * `decryptPhotoAsDataUri`.
 */
export async function materializeVoiceNote(
  messageId: string,
  remotePath: string,
  albumKey: Uint8Array,
): Promise<string | null> {
  try {
    const target = scratchFile(messageId);
    if (target.exists) return target.uri;

    const { data, error } = await supabase.storage.from(SHARED_ALBUM_BUCKET).download(remotePath);
    if (error || !data) return null;

    const plaintext = decryptPhotoBytes(albumKey, new Uint8Array(await data.arrayBuffer()));
    target.create({ overwrite: true });
    target.write(plaintext);
    return target.uri;
  } catch (error) {
    reportError(error, { scope: 'voice-notes:materialize' });
    return null;
  }
}

/** Deletes one decrypted scratch file. Safe to call when it is not there. */
export function releaseVoiceNote(messageId: string): void {
  try {
    const target = scratchFile(messageId);
    if (target.exists) target.delete();
  } catch (error) {
    reportError(error, { scope: 'voice-notes:release' });
  }
}

/** Empties the scratch directory. Called when the vault locks — see the
 *  header; this is the case the whole compromise rests on. */
export function purgeVoiceScratch(): void {
  try {
    const dir = new Directory(Paths.cache, SCRATCH_DIRNAME);
    if (dir.exists) dir.delete();
  } catch (error) {
    reportError(error, { scope: 'voice-notes:purge' });
  }
}
