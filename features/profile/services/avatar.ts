import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import { useAuthStore } from '@/features/auth/services/auth-store';
import { isSupabaseConfigured } from '@/lib/env';
import { hasMediaAccess } from '@/lib/media-permissions';
import { supabase } from '@/lib/supabase';
import { errorKind, type SupabaseErrorKind } from '@/lib/supabase-error';

/**
 * Profile pictures, in Supabase Storage.
 *
 * The stored value is a *path*, not a URL (0013). A public bucket today can
 * become a signed-URL bucket tomorrow without every profile row turning into a
 * dead link — and the choice of which is a policy decision that should not be
 * baked into thirty thousand database rows.
 *
 * The path is always `<uid>/avatar.jpg`. Keying on the user id means the
 * storage policy is a one-line prefix check, and re-uploading replaces rather
 * than accumulating: an avatar changed weekly for a year is one object, not
 * fifty-two.
 */
export const AVATAR_BUCKET = 'avatars';

function avatarPath(uid: string): string {
  return `${uid}/avatar.jpg`;
}

export type AvatarResult =
  | { ok: true; path: string }
  | { ok: false; error: 'cancelled' | 'not-signed-in' | 'permission-denied' }
  // `kind` distinguishes *why* the upload failed (offline, RLS, a missing
  // bucket, ...) instead of the one flat message every failure used to
  // collapse into — see lib/supabase-error.ts's header for the problem this
  // solves. `errors.${kind}` in the locale files is the string to show.
  | { ok: false; error: 'upload-failed'; kind: SupabaseErrorKind };

/**
 * Picks an image and uploads it.
 *
 * `exif: false` matters more than it looks: a photo straight from the camera
 * roll carries GPS coordinates, and a profile picture is the single most
 * public thing in the app. Stripping it here means a user's home address does
 * not travel with their face.
 */
export async function pickAndUploadAvatar(): Promise<AvatarResult> {
  const uid = useAuthStore.getState().user?.id;
  if (!uid || !isSupabaseConfigured) return { ok: false, error: 'not-signed-in' };

  if (!(await hasMediaAccess('library'))) return { ok: false, error: 'permission-denied' };

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.85,
    exif: false,
  });
  if (result.canceled || result.assets.length === 0) return { ok: false, error: 'cancelled' };

  const asset = result.assets[0];
  const file = new File(asset.uri);
  if (!file.exists) return { ok: false, error: 'upload-failed', kind: 'unknown' };

  try {
    const path = avatarPath(uid);
    const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file.bytesSync(), {
      contentType: 'image/jpeg',
      // One object per user, replaced in place.
      upsert: true,
    });
    if (error) return { ok: false, error: 'upload-failed', kind: errorKind(error) };

    // `avatar_updated_at` is a cache-buster: the storage URL never changes, so
    // without it every device keeps showing the previous picture indefinitely.
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ avatar_path: path, avatar_updated_at: Date.now() })
      .eq('id', uid);
    if (profileError) return { ok: false, error: 'upload-failed', kind: errorKind(profileError) };

    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: 'upload-failed', kind: errorKind(e) };
  }
}

export async function removeAvatar(): Promise<boolean> {
  const uid = useAuthStore.getState().user?.id;
  if (!uid || !isSupabaseConfigured) return false;

  try {
    await supabase.storage.from(AVATAR_BUCKET).remove([avatarPath(uid)]);
    const { error } = await supabase
      .from('profiles')
      .update({ avatar_path: null, avatar_updated_at: Date.now() })
      .eq('id', uid);
    return !error;
  } catch {
    return false;
  }
}

/** Public URL for a stored avatar, with the cache-buster appended. */
export function avatarUrl(path: string | null, updatedAt: number | null): string | null {
  if (!path || !isSupabaseConfigured) return null;
  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) return null;
  return updatedAt ? `${data.publicUrl}?v=${updatedAt}` : data.publicUrl;
}

/** How long a fallback signed URL stays good for. An hour is far longer than
 *  any single visit to the profile screen and short enough that the URL is not
 *  a durable credential if it leaks into a log. */
const SIGNED_TTL_SECONDS = 3600;

/**
 * The same object, reached through a signed URL instead of the public one.
 *
 * `getPublicUrl()` is pure string construction — it returns a URL whether or
 * not the bucket is actually public, and whether or not the object is there.
 * So a project where the `avatars` bucket predates 0036 (created by hand, or
 * flipped private) hands the app a URL that 400s, and the only symptom is a
 * picture that never appears. Signing works in both cases, because the read
 * goes through the owner's own session rather than the bucket's public flag.
 *
 * Only used as a retry after the public URL has actually failed — see
 * features/profile/components/avatar.tsx. Signing on every render would cost a
 * network round-trip to display a picture that normally loads straight from
 * cache.
 */
export async function signedAvatarUrl(
  path: string | null,
  updatedAt: number | null,
): Promise<string | null> {
  if (!path || !isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(path, SIGNED_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    // Same cache-buster as the public URL: the signed URL's own token changes
    // every call, but expo-image keys its disk cache on the whole string and a
    // stale entry for the previous picture would otherwise win.
    return updatedAt ? `${data.signedUrl}&v=${updatedAt}` : data.signedUrl;
  } catch {
    return null;
  }
}

/** Initials fallback, so a profile without a picture still reads as a person
 * rather than an empty circle. */
export function initialsFor(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.split('@')[0] || '';
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
