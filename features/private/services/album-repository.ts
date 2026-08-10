import type {
  AlbumActivity,
  AlbumMember,
  AlbumPhoto,
  SharedAlbum,
} from '@/features/private/types/shared-album.types';
import { generateId } from '@/lib/id';
import { supabase } from '@/lib/supabase';
import { toSupabaseError } from '@/lib/supabase-error';

/**
 * Supabase access for shared albums.
 *
 * Same shape as split-repository.ts, for the same reason: album data is
 * shared, so the server is the source of truth and react-query holds the
 * cache — there is no local SQLite table for any of this. Reads rely on the
 * RLS policies from migration 0027; there is no explicit "where I am a
 * member" clause because the database already refuses to return anything
 * else.
 *
 * Deliberately no crypto here. `name_ciphertext`/`caption_ciphertext` pass
 * through as opaque columns — decrypting them is the hook layer's job
 * (use-shared-albums.ts), once it has the album key. Keeping this file free
 * of vault-crypto/album-crypto imports is itself the audit: if this file ever
 * needs one, the separation has broken down.
 */

type Row = Record<string, unknown>;

const num = (v: unknown, fallback = 0) => (typeof v === 'number' ? v : fallback);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

const toAlbum = (r: Row): SharedAlbum => ({
  id: String(r.id),
  nameCiphertext: String(r.name_ciphertext),
  createdBy: str(r.created_by),
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at),
  deletedAt: typeof r.deleted_at === 'number' ? r.deleted_at : null,
});

const toMember = (r: Row): AlbumMember => ({
  id: String(r.id),
  albumId: String(r.album_id),
  userId: str(r.user_id),
  email: str(r.email),
  displayName: str(r.display_name),
  role: (str(r.role) ?? 'member') as AlbumMember['role'],
  joinedAt: typeof r.joined_at === 'number' ? r.joined_at : null,
  keyConfirmedAt: typeof r.key_confirmed_at === 'number' ? r.key_confirmed_at : null,
  removedAt: typeof r.deleted_at === 'number' ? r.deleted_at : null,
});

const toPhoto = (r: Row): AlbumPhoto => ({
  id: String(r.id),
  albumId: String(r.album_id),
  remotePath: str(r.remote_path),
  captionCiphertext: str(r.caption_ciphertext),
  mimeType: str(r.mime_type),
  width: typeof r.width === 'number' ? r.width : null,
  height: typeof r.height === 'number' ? r.height : null,
  byteLength: typeof r.byte_length === 'number' ? r.byte_length : null,
  addedBy: str(r.added_by),
  position: num(r.position),
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at),
});

const toActivity = (r: Row): AlbumActivity => ({
  id: String(r.id),
  albumId: String(r.album_id),
  actorId: str(r.actor_id),
  actorName: str(r.actor_name),
  action: String(r.action) as AlbumActivity['action'],
  photoId: str(r.photo_id),
  meta: (r.meta as Record<string, unknown> | null) ?? null,
  createdAt: num(r.created_at),
});

/** Supabase returns `{ data, error }`; make the error a throw so react-query
 *  surfaces it instead of silently rendering an empty list. */
function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw toSupabaseError(result.error);
  return (result.data ?? []) as T;
}

function assertOk(error: unknown): void {
  if (error) throw toSupabaseError(error);
}

// --- reads -------------------------------------------------------------------

export async function listAlbums(): Promise<SharedAlbum[]> {
  const res = await supabase
    .from('shared_albums')
    .select('*')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  return unwrap<Row[]>(res).map(toAlbum);
}

export async function getAlbum(id: string): Promise<SharedAlbum | null> {
  const res = await supabase
    .from('shared_albums')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  assertOk(res.error);
  return res.data ? toAlbum(res.data as Row) : null;
}

/** Everyone who has ever been in the album, removed members included — same
 *  reasoning as split-repository.ts's listMembers: a removed member's added
 *  photos and activity entries stay attributable rather than orphaned.
 *  Callers that need only the current line-up filter on `removedAt`. */
export async function listMembers(albumId: string): Promise<AlbumMember[]> {
  const res = await supabase
    .from('shared_album_members')
    .select('*')
    .eq('album_id', albumId)
    .order('created_at');
  return unwrap<Row[]>(res).map(toMember);
}

export async function listPhotos(albumId: string): Promise<AlbumPhoto[]> {
  const res = await supabase
    .from('shared_album_photos')
    .select('*')
    .eq('album_id', albumId)
    .is('deleted_at', null)
    .order('position');
  return unwrap<Row[]>(res).map(toPhoto);
}

export async function listActivity(albumId: string, limit = 50): Promise<AlbumActivity[]> {
  const res = await supabase
    .from('shared_album_activity')
    .select('*')
    .eq('album_id', albumId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return unwrap<Row[]>(res).map(toActivity);
}

// --- writes ------------------------------------------------------------------

export async function createAlbum(input: {
  nameCiphertext: string;
  displayName: string | null;
}): Promise<string> {
  const albumId = generateId();
  const { error } = await supabase.rpc('create_shared_album', {
    p_album_id: albumId,
    p_name_ciphertext: input.nameCiphertext,
    p_member_id: generateId(),
    p_display_name: input.displayName,
    p_activity_id: generateId(),
    p_now: Date.now(),
  });
  assertOk(error);
  return albumId;
}

export async function renameAlbum(albumId: string, nameCiphertext: string): Promise<void> {
  const { error } = await supabase
    .from('shared_albums')
    .update({ name_ciphertext: nameCiphertext, updated_at: Date.now() })
    .eq('id', albumId);
  assertOk(error);
}

/** Adds somebody by email as a placeholder member — the invite flow's
 *  Postgres half. Mirrors split-repository.ts's addMemberByEmail exactly,
 *  including generating its own id rather than returning one: the invite
 *  screen reads the member's id back off the refetched member list, the
 *  same way the Split invite screen does. */
export async function addMemberByEmail(input: {
  albumId: string;
  email: string;
  displayName: string | null;
}): Promise<void> {
  const now = Date.now();
  const { error } = await supabase.from('shared_album_members').insert({
    id: generateId(),
    album_id: input.albumId,
    user_id: null,
    email: input.email.trim().toLowerCase(),
    display_name: input.displayName,
    role: 'member',
    created_at: now,
    updated_at: now,
  });
  assertOk(error);
}

/** Removes a member, or leaves the album when it is your own membership. Goes
 *  through the RPC so the removal is authorised and logged in one step — see
 *  migration 0027's remove_album_member. */
export async function removeMember(memberId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_album_member', {
    p_member_id: memberId,
    p_activity_id: generateId(),
    p_now: Date.now(),
  });
  assertOk(error);
}

/** Retires an album. Owner only, and soft — the activity trail and remaining
 *  members' history stay intact. */
export async function deleteAlbum(albumId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_shared_album', {
    p_album_id: albumId,
    p_activity_id: generateId(),
    p_now: Date.now(),
  });
  assertOk(error);
}

/**
 * Registers a photo row before its bytes are uploaded. album-uploader.ts
 * (Stage 3) needs the id to build the storage path, so the row is created
 * first with `remote_path: null`, and the uploader fills that in once the
 * ciphertext object exists — the same resumability idiom as
 * `gallery_photos`.
 */
export async function createPhotoRow(input: {
  albumId: string;
  addedBy: string;
  captionCiphertext: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  byteLength: number;
  position: number;
}): Promise<string> {
  const photoId = generateId();
  const now = Date.now();
  const { error } = await supabase.from('shared_album_photos').insert({
    id: photoId,
    album_id: input.albumId,
    remote_path: null,
    added_by: input.addedBy,
    caption_ciphertext: input.captionCiphertext,
    mime_type: input.mimeType,
    width: input.width,
    height: input.height,
    byte_length: input.byteLength,
    position: input.position,
    created_at: now,
    updated_at: now,
  });
  assertOk(error);
  return photoId;
}

/** Called by album-uploader.ts once the ciphertext object exists — the
 *  "uploaded" marker that `pendingPhotos`-style queries key off. */
export async function markPhotoUploaded(photoId: string, remotePath: string): Promise<void> {
  const { error } = await supabase
    .from('shared_album_photos')
    .update({ remote_path: remotePath, updated_at: Date.now() })
    .eq('id', photoId);
  assertOk(error);
}

/** Soft-delete, so a removal is undoable and the activity trail survives. */
export async function removePhoto(photoId: string): Promise<void> {
  const { error } = await supabase
    .from('shared_album_photos')
    .update({ deleted_at: Date.now(), updated_at: Date.now() })
    .eq('id', photoId);
  assertOk(error);
}
