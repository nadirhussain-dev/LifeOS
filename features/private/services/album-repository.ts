import type {
  AlbumActivity,
  AlbumComment,
  AlbumEvent,
  AlbumMember,
  AlbumMessage,
  AlbumMilestone,
  AlbumNote,
  AlbumPhoto,
  SharedAlbum,
} from '@/features/private/types/shared-album.types';
import { INVITE_TTL_MS } from '@/features/private/services/album-invite';
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

const bool = (v: unknown) => v === true;

const toAlbum = (r: Row): SharedAlbum => ({
  id: String(r.id),
  nameCiphertext: String(r.name_ciphertext),
  createdBy: str(r.created_by),
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at),
  deletedAt: typeof r.deleted_at === 'number' ? r.deleted_at : null,
  allowComments: bool(r.allow_comments),
  allowChat: bool(r.allow_chat),
  allowNotes: bool(r.allow_notes),
  relationshipStartDate:
    typeof r.relationship_start_date === 'number' ? r.relationship_start_date : null,
  isTogetherHub: bool(r.is_together_hub),
  cycleShareCiphertext: str(r.cycle_share_ciphertext),
  cycleShareUpdatedAt:
    typeof r.cycle_share_updated_at === 'number' ? r.cycle_share_updated_at : null,
  cycleShareAuthorId: str(r.cycle_share_author_id),
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

const toComment = (r: Row): AlbumComment => ({
  id: String(r.id),
  albumId: String(r.album_id),
  photoId: str(r.photo_id),
  authorId: str(r.author_id),
  authorName: str(r.author_name),
  bodyCiphertext: String(r.body_ciphertext),
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at),
  deletedAt: typeof r.deleted_at === 'number' ? r.deleted_at : null,
});

const toMessage = (r: Row): AlbumMessage => ({
  id: String(r.id),
  albumId: String(r.album_id),
  authorId: str(r.author_id),
  authorName: str(r.author_name),
  bodyCiphertext: String(r.body_ciphertext),
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at),
  deletedAt: typeof r.deleted_at === 'number' ? r.deleted_at : null,
  replyToId: str(r.reply_to_id),
  editedAt: typeof r.edited_at === 'number' ? r.edited_at : null,
  expiresAt: typeof r.expires_at === 'number' ? r.expires_at : null,
  disappearedAt: typeof r.disappeared_at === 'number' ? r.disappeared_at : null,
  kind: r.kind === 'voice' ? 'voice' : 'text',
  voicePath: str(r.voice_path),
  voiceDurationMs: typeof r.voice_duration_ms === 'number' ? r.voice_duration_ms : null,
  voiceByteLength: typeof r.voice_byte_length === 'number' ? r.voice_byte_length : null,
});

const toEvent = (r: Row): AlbumEvent => ({
  id: String(r.id),
  albumId: String(r.album_id),
  titleCiphertext: String(r.title_ciphertext),
  notesCiphertext: str(r.notes_ciphertext),
  eventDate: String(r.event_date),
  authorId: str(r.author_id),
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at),
  deletedAt: typeof r.deleted_at === 'number' ? r.deleted_at : null,
});

const toMilestone = (r: Row): AlbumMilestone => ({
  id: String(r.id),
  albumId: String(r.album_id),
  titleCiphertext: String(r.title_ciphertext),
  milestoneDate: String(r.milestone_date),
  recurring: bool(r.recurring),
  authorId: str(r.author_id),
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at),
  deletedAt: typeof r.deleted_at === 'number' ? r.deleted_at : null,
});

const toNote = (r: Row): AlbumNote => ({
  id: String(r.id),
  albumId: String(r.album_id),
  bodyCiphertext: String(r.body_ciphertext),
  authorId: str(r.author_id),
  authorName: str(r.author_name),
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at),
  deletedAt: typeof r.deleted_at === 'number' ? r.deleted_at : null,
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

/** Adds somebody by email — the invite flow's Postgres half. Goes through
 *  `add_shared_album_member_by_email` (migration 0045), which creates the
 *  placeholder member row AND mints its Postgres invitation atomically, so
 *  an invitee who already has the app can find it in their own Invites
 *  inbox (album-invite.ts's `listMyAlbumInvitations`) immediately — no
 *  separate manual "Send" step, and no lookup of whether the email even
 *  has an account: membership is never granted here, only requested. See
 *  the migration's header for why an earlier version of this function did
 *  that lookup and why it was removed. */
export async function addMemberByEmail(input: {
  albumId: string;
  email: string;
  displayName: string | null;
}): Promise<void> {
  const now = Date.now();
  const { error } = await supabase.rpc('add_shared_album_member_by_email', {
    p_member_id: generateId(),
    p_album_id: input.albumId,
    p_email: input.email.trim().toLowerCase(),
    p_display_name: input.displayName,
    p_invitation_id: generateId(),
    p_token: generateId(),
    p_expires_at: now + INVITE_TTL_MS,
    p_now: now,
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

// --- comments & chat (0029) --------------------------------------------------

/** Owner-only in practice — migration 0029's trigger rejects anyone else's
 *  attempt to change either flag, so this is a plain update and the
 *  enforcement lives entirely server-side, same as the deleted_at column on
 *  this same table (0027). */
export async function setAlbumPermissions(
  albumId: string,
  permissions: { allowComments?: boolean; allowChat?: boolean; allowNotes?: boolean },
): Promise<void> {
  const patch: Row = { updated_at: Date.now() };
  if (permissions.allowComments !== undefined) patch.allow_comments = permissions.allowComments;
  if (permissions.allowChat !== undefined) patch.allow_chat = permissions.allowChat;
  if (permissions.allowNotes !== undefined) patch.allow_notes = permissions.allowNotes;
  const { error } = await supabase.from('shared_albums').update(patch).eq('id', albumId);
  assertOk(error);
}

// --- together module (0041) --------------------------------------------------

/**
 * Designates (or un-designates) `albumId` as the caller's Together hub.
 *
 * Only one album is meant to be "the" hub, but that is an application
 * convention, not a database constraint — enforced by the caller clearing
 * the previous hub first (see use-shared-albums.ts's `setTogetherHub`),
 * same trust level the client already has over its own `allow_*` toggles.
 */
export async function setTogetherHub(albumId: string, isHub: boolean): Promise<void> {
  const { error } = await supabase
    .from('shared_albums')
    .update({ is_together_hub: isHub, updated_at: Date.now() })
    .eq('id', albumId);
  assertOk(error);
}

export async function setRelationshipStartDate(
  albumId: string,
  date: number | null,
): Promise<void> {
  const { error } = await supabase
    .from('shared_albums')
    .update({ relationship_start_date: date, updated_at: Date.now() })
    .eq('id', albumId);
  assertOk(error);
}

/** The opt-in cycle-status share — see shared-album.types.ts's header on
 *  `cycleShareCiphertext`. `authorId: null` (alongside `ciphertext: null`)
 *  turns sharing off. */
export async function setCycleShare(
  albumId: string,
  ciphertext: string | null,
  authorId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('shared_albums')
    .update({
      cycle_share_ciphertext: ciphertext,
      cycle_share_updated_at: Date.now(),
      cycle_share_author_id: authorId,
      updated_at: Date.now(),
    })
    .eq('id', albumId);
  assertOk(error);
}

export async function listComments(photoId: string): Promise<AlbumComment[]> {
  const res = await supabase
    .from('shared_album_comments')
    .select('*')
    .eq('photo_id', photoId)
    .is('deleted_at', null)
    .order('created_at');
  return unwrap<Row[]>(res).map(toComment);
}

/** Insert is refused server-side unless `allow_comments` is on for this album
 *  — see `album_allows_comments()` (0029). The caller is expected to hide the
 *  compose UI when it's off; this is the enforcement, not the UX. */
export async function addComment(input: {
  albumId: string;
  photoId: string;
  authorId: string;
  authorName: string | null;
  bodyCiphertext: string;
}): Promise<string> {
  const id = generateId();
  const now = Date.now();
  const { error } = await supabase.from('shared_album_comments').insert({
    id,
    album_id: input.albumId,
    photo_id: input.photoId,
    author_id: input.authorId,
    author_name: input.authorName,
    body_ciphertext: input.bodyCiphertext,
    created_at: now,
    updated_at: now,
  });
  assertOk(error);
  return id;
}

/** Soft-delete. RLS scopes this to the comment's own author or the album
 *  owner (0029) — a mis-scoped call just matches zero rows rather than
 *  throwing, same as removeMember's tombstone pattern. */
export async function removeComment(commentId: string): Promise<void> {
  const { error } = await supabase
    .from('shared_album_comments')
    .update({ deleted_at: Date.now(), updated_at: Date.now() })
    .eq('id', commentId);
  assertOk(error);
}

/** Messages per page — small enough that opening a long-running chat doesn't
 *  decrypt and render years of history just to show the last screenful. */
export const MESSAGES_PAGE_SIZE = 50;

/**
 * One page, newest-first internally (so `.limit()` keeps the *most recent*
 * N rows when there are more than one page's worth), then reversed back to
 * the caller's oldest-first contract — same order `listMessages` always
 * returned, just one page of it. `before` is the oldest `created_at` already
 * loaded, for fetching the page immediately older than that.
 */
export async function listMessages(
  albumId: string,
  options?: { before?: number; limit?: number },
): Promise<AlbumMessage[]> {
  let query = supabase
    .from('shared_album_messages')
    .select('*')
    .eq('album_id', albumId)
    .is('deleted_at', null)
    // A disappeared message is soft-deleted (0053) — the row survives on
    // purpose, so filtering it out here is the whole of what makes the timer
    // visible to anybody. Without this the sweep runs, stamps every due row,
    // and the chat goes on showing them.
    .is('disappeared_at', null)
    .order('created_at', { ascending: false })
    .limit(options?.limit ?? MESSAGES_PAGE_SIZE);
  if (options?.before !== undefined) query = query.lt('created_at', options.before);
  const res = await query;
  return unwrap<Row[]>(res).map(toMessage).reverse();
}

/** Insert is refused server-side unless `allow_chat` is on — see
 *  `album_allows_chat()` (0029). */
export async function sendMessage(input: {
  albumId: string;
  authorId: string;
  authorName: string | null;
  bodyCiphertext: string;
  replyToId?: string | null;
}): Promise<string> {
  const id = generateId();
  const now = Date.now();
  const { error } = await supabase.from('shared_album_messages').insert({
    id,
    album_id: input.albumId,
    author_id: input.authorId,
    author_name: input.authorName,
    body_ciphertext: input.bodyCiphertext,
    reply_to_id: input.replyToId ?? null,
    created_at: now,
    updated_at: now,
  });
  assertOk(error);
  return id;
}

/**
 * Writes the row for a voice message before its recording exists.
 *
 * Same ordering as `createPhotoRow` and for the same reason: the object path
 * is built from the row's own id, so the row has to exist first. The visible
 * consequence is better than the alternative — the bubble appears immediately,
 * in a sending state, instead of after the upload finishes.
 *
 * `voice_path` stays null until `markVoiceUploaded`, which is what makes an
 * interrupted send findable rather than lost.
 */
export async function createVoiceMessageRow(input: {
  albumId: string;
  authorId: string;
  authorName: string | null;
  bodyCiphertext: string;
  durationMs: number;
  byteLength: number;
  replyToId?: string | null;
}): Promise<string> {
  const id = generateId();
  const now = Date.now();
  const { error } = await supabase.from('shared_album_messages').insert({
    id,
    album_id: input.albumId,
    author_id: input.authorId,
    author_name: input.authorName,
    // A voice message still carries a body: the caption/transcript slot, empty
    // in practice today. The column is `not null`, and sending '' unencrypted
    // would be the one plaintext body in the table.
    body_ciphertext: input.bodyCiphertext,
    reply_to_id: input.replyToId ?? null,
    kind: 'voice',
    voice_duration_ms: input.durationMs,
    voice_byte_length: input.byteLength,
    created_at: now,
    updated_at: now,
  });
  assertOk(error);
  return id;
}

/** Records that the recording landed. Until this runs the message renders as
 *  still sending — see `createVoiceMessageRow`. */
export async function markVoiceUploaded(messageId: string, path: string): Promise<void> {
  const { error } = await supabase
    .from('shared_album_messages')
    .update({ voice_path: path, updated_at: Date.now() })
    .eq('id', messageId);
  assertOk(error);
}

export async function removeMessage(messageId: string): Promise<void> {
  const { error } = await supabase
    .from('shared_album_messages')
    .update({ deleted_at: Date.now(), updated_at: Date.now() })
    .eq('id', messageId);
  assertOk(error);
}

// --- replies, edits, reactions, receipts, disappearing (0053) -----------------

/**
 * Rewrites a message, through an RPC rather than a direct update.
 *
 * 0029's update policy lets any member of the album update any row in it — it
 * has to, because that is what a soft delete uses. Editing through the same
 * door would let a member rewrite somebody else's words with that person's
 * name still on them, which is the one thing in a chat worse than deleting
 * them. `edit_album_message` checks authorship server-side.
 */
export async function editMessage(messageId: string, bodyCiphertext: string): Promise<void> {
  const { error } = await supabase.rpc('edit_album_message', {
    p_message_id: messageId,
    p_body_ciphertext: bodyCiphertext,
  });
  assertOk(error);
}

/** Adds a reaction. Idempotent by primary key — reacting twice with the same
 *  emoji is the same fact, so a repeat is not an error. */
export async function addReaction(input: {
  messageId: string;
  albumId: string;
  userId: string;
  emoji: string;
}): Promise<void> {
  const { error } = await supabase.from('shared_album_message_reactions').upsert(
    {
      message_id: input.messageId,
      album_id: input.albumId,
      user_id: input.userId,
      emoji: input.emoji,
      created_at: Date.now(),
    },
    { onConflict: 'message_id,user_id,emoji' },
  );
  assertOk(error);
}

export async function removeReaction(input: {
  messageId: string;
  userId: string;
  emoji: string;
}): Promise<void> {
  const { error } = await supabase
    .from('shared_album_message_reactions')
    .delete()
    .eq('message_id', input.messageId)
    .eq('user_id', input.userId)
    .eq('emoji', input.emoji);
  assertOk(error);
}

export type MessageReaction = {
  messageId: string;
  userId: string;
  emoji: string;
};

export async function listReactions(albumId: string): Promise<MessageReaction[]> {
  const res = await supabase
    .from('shared_album_message_reactions')
    .select('message_id, user_id, emoji')
    .eq('album_id', albumId);
  return unwrap<Row[]>(res).map((r) => ({
    messageId: String(r.message_id),
    userId: String(r.user_id),
    emoji: String(r.emoji),
  }));
}

/** How far each member has read. One row per member — see 0053 for why this is
 *  a high-water mark rather than a row per message read. */
export type AlbumReadMark = { userId: string; readThrough: number };

export async function listReadMarks(albumId: string): Promise<AlbumReadMark[]> {
  const res = await supabase
    .from('shared_album_reads')
    .select('user_id, read_through')
    .eq('album_id', albumId);
  return unwrap<Row[]>(res).map((r) => ({
    userId: String(r.user_id),
    readThrough: Number(r.read_through),
  }));
}

/** Moves this member's marker forward. Never backwards — the server takes the
 *  greater of the two, so an out-of-order report from a second device cannot
 *  un-read anything. Also stamps delivery, since reading implies it (0054). */
export async function markRead(albumId: string, readThrough: number): Promise<void> {
  const { error } = await supabase.rpc('mark_album_read', {
    p_album_id: albumId,
    p_through: readThrough,
  });
  assertOk(error);
}

/** How far each member's device has *received*, as opposed to looked at. The
 *  grey second tick. Migration 0054. */
export type AlbumDeliveryMark = { userId: string; deliveredThrough: number };

export async function listDeliveryMarks(albumId: string): Promise<AlbumDeliveryMark[]> {
  const res = await supabase
    .from('shared_album_deliveries')
    .select('user_id, delivered_through')
    .eq('album_id', albumId);
  return unwrap<Row[]>(res).map((r) => ({
    userId: String(r.user_id),
    deliveredThrough: Number(r.delivered_through),
  }));
}

/**
 * Reports that this device now holds everything up to `deliveredThrough`.
 *
 * Called after a fetch rather than after a render — "delivered" is a statement
 * about bytes arriving, and tying it to the screen being on would make it a
 * second, worse read receipt.
 */
export async function markDelivered(albumId: string, deliveredThrough: number): Promise<void> {
  const { error } = await supabase.rpc('mark_album_delivered', {
    p_album_id: albumId,
    p_through: deliveredThrough,
  });
  assertOk(error);
}

/**
 * Soft-deletes whatever is due in this album, and reports how many.
 *
 * Called on opening a chat so expiry does not depend on a scheduler existing.
 * Idempotent and cheap: a swept message no longer matches the query, and a
 * message that is not due cannot be touched by it.
 */
export async function expireMessages(albumId: string): Promise<number> {
  const { data, error } = await supabase.rpc('expire_album_messages', {
    p_album_id: albumId,
  });
  assertOk(error);
  return Number(data ?? 0);
}

/** Sets the album's disappearing timer in seconds, or clears it with null.
 *  Owner only, enforced server-side. Only affects messages sent after it. */
export async function setDisappearing(albumId: string, seconds: number | null): Promise<void> {
  const { error } = await supabase.rpc('set_album_disappearing', {
    p_album_id: albumId,
    p_seconds: seconds,
  });
  assertOk(error);
}

// --- shared plans (0038) ------------------------------------------------------

export async function listEvents(albumId: string): Promise<AlbumEvent[]> {
  const res = await supabase
    .from('shared_album_events')
    .select('*')
    .eq('album_id', albumId)
    .is('deleted_at', null)
    .order('event_date');
  return unwrap<Row[]>(res).map(toEvent);
}

export async function addEvent(input: {
  albumId: string;
  authorId: string;
  titleCiphertext: string;
  notesCiphertext: string | null;
  eventDate: string;
}): Promise<string> {
  const id = generateId();
  const now = Date.now();
  const { error } = await supabase.from('shared_album_events').insert({
    id,
    album_id: input.albumId,
    title_ciphertext: input.titleCiphertext,
    notes_ciphertext: input.notesCiphertext,
    event_date: input.eventDate,
    author_id: input.authorId,
    created_at: now,
    updated_at: now,
  });
  assertOk(error);
  return id;
}

/** RLS scopes this to the event's own author or the album owner (0038) —
 *  a mis-scoped call just matches zero rows, same as removeComment. */
export async function updateEvent(
  eventId: string,
  patch: { titleCiphertext?: string; notesCiphertext?: string | null; eventDate?: string },
): Promise<void> {
  const row: Row = { updated_at: Date.now() };
  if (patch.titleCiphertext !== undefined) row.title_ciphertext = patch.titleCiphertext;
  if (patch.notesCiphertext !== undefined) row.notes_ciphertext = patch.notesCiphertext;
  if (patch.eventDate !== undefined) row.event_date = patch.eventDate;
  const { error } = await supabase.from('shared_album_events').update(row).eq('id', eventId);
  assertOk(error);
}

export async function removeEvent(eventId: string): Promise<void> {
  const { error } = await supabase
    .from('shared_album_events')
    .update({ deleted_at: Date.now(), updated_at: Date.now() })
    .eq('id', eventId);
  assertOk(error);
}

// --- custom milestones (0039) -------------------------------------------------

export async function listMilestones(albumId: string): Promise<AlbumMilestone[]> {
  const res = await supabase
    .from('shared_album_milestones')
    .select('*')
    .eq('album_id', albumId)
    .is('deleted_at', null)
    .order('milestone_date');
  return unwrap<Row[]>(res).map(toMilestone);
}

export async function addMilestone(input: {
  albumId: string;
  authorId: string;
  titleCiphertext: string;
  milestoneDate: string;
  recurring: boolean;
}): Promise<string> {
  const id = generateId();
  const now = Date.now();
  const { error } = await supabase.from('shared_album_milestones').insert({
    id,
    album_id: input.albumId,
    title_ciphertext: input.titleCiphertext,
    milestone_date: input.milestoneDate,
    recurring: input.recurring,
    author_id: input.authorId,
    created_at: now,
    updated_at: now,
  });
  assertOk(error);
  return id;
}

export async function updateMilestone(
  milestoneId: string,
  patch: { titleCiphertext?: string; milestoneDate?: string; recurring?: boolean },
): Promise<void> {
  const row: Row = { updated_at: Date.now() };
  if (patch.titleCiphertext !== undefined) row.title_ciphertext = patch.titleCiphertext;
  if (patch.milestoneDate !== undefined) row.milestone_date = patch.milestoneDate;
  if (patch.recurring !== undefined) row.recurring = patch.recurring;
  const { error } = await supabase
    .from('shared_album_milestones')
    .update(row)
    .eq('id', milestoneId);
  assertOk(error);
}

export async function removeMilestone(milestoneId: string): Promise<void> {
  const { error } = await supabase
    .from('shared_album_milestones')
    .update({ deleted_at: Date.now(), updated_at: Date.now() })
    .eq('id', milestoneId);
  assertOk(error);
}

// --- shared notes (0040) ------------------------------------------------------

export async function listNotes(albumId: string): Promise<AlbumNote[]> {
  const res = await supabase
    .from('shared_album_notes')
    .select('*')
    .eq('album_id', albumId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  return unwrap<Row[]>(res).map(toNote);
}

/** Insert is refused server-side unless `allow_notes` is on for this album —
 *  see `album_allows_notes()` (0040). Same "caller hides the compose UI,
 *  this is the enforcement" split as addComment/sendMessage. */
export async function addNote(input: {
  albumId: string;
  authorId: string;
  authorName: string | null;
  bodyCiphertext: string;
}): Promise<string> {
  const id = generateId();
  const now = Date.now();
  const { error } = await supabase.from('shared_album_notes').insert({
    id,
    album_id: input.albumId,
    author_id: input.authorId,
    author_name: input.authorName,
    body_ciphertext: input.bodyCiphertext,
    created_at: now,
    updated_at: now,
  });
  assertOk(error);
  return id;
}

export async function removeNote(noteId: string): Promise<void> {
  const { error } = await supabase
    .from('shared_album_notes')
    .update({ deleted_at: Date.now(), updated_at: Date.now() })
    .eq('id', noteId);
  assertOk(error);
}
