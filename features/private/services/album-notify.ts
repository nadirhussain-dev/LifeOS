import { supabase } from '@/lib/supabase';

/**
 * Push fan-out for shared albums — the client half of
 * supabase/functions/notify-album. Mirrors `notifyGroup`
 * (features/split/services/push-registration.ts) exactly: fire-and-forget,
 * never lets a delivery failure surface to the caller, because the write it
 * accompanies has already succeeded and nothing here should make the caller
 * think otherwise.
 *
 * Deliberately takes plaintext `title`/`body` from the caller rather than an
 * album id it could look up server-side — the album name and message text
 * are end-to-end ciphertext, and this device is the only place that has
 * already decrypted them.
 */
export async function notifyAlbumMessage(input: {
  albumId: string;
  title: string;
  body: string;
  route?: string;
}): Promise<void> {
  try {
    await supabase.functions.invoke('notify-album', {
      body: { ...input, kind: 'message' },
    });
  } catch {
    // Non-fatal by design.
  }
}

/** Nudges an invitee who already has a LifeOS account that an invite is
 *  waiting — never carries the token/code/payload itself, which still only
 *  travels through the existing share-sheet/clipboard link. */
export async function notifyAlbumInvite(input: {
  albumId: string;
  inviteeEmail: string;
  title: string;
  body: string;
}): Promise<void> {
  try {
    await supabase.functions.invoke('notify-album', {
      body: { ...input, kind: 'invite' },
    });
  } catch {
    // Non-fatal by design.
  }
}
