export type SharedAlbum = {
  id: string;
  /** Opaque — decrypted client-side only. See album-crypto.ts. */
  nameCiphertext: string;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  /** Owner-controlled, off by default — see migration 0029. Comments on
   *  photos and the album's own chat only accept writes while the matching
   *  flag is true; both stay readable regardless, so turning one off never
   *  hides an existing thread. */
  allowComments: boolean;
  allowChat: boolean;
  /** Same shape as allowComments/allowChat, added by migration 0040 for
   *  Shared Notes — a separate flag rather than reusing allow_comments,
   *  since photo commentary and relationship notes are different enough in
   *  intent that a couple may want them toggled independently. */
  allowNotes: boolean;
  /** When this relationship actually started — distinct from `createdAt`,
   *  which is only when this album row was made. Null until a member sets
   *  it, in which case the Together screen falls back to `createdAt`.
   *  Migration 0041. */
  relationshipStartDate: number | null;
  /** Marks this as the one shared album a member has designated as "us" —
   *  see features/private/config/private-modules.ts's `together` module.
   *  Migration 0041. */
  isTogetherHub: boolean;
  /** Opaque — see album-crypto.ts. A small opt-in cycle-status summary
   *  (day-of-cycle, predicted next start — never raw entries), refreshed
   *  whenever the sharer's cycle data changes. Null until shared. */
  cycleShareCiphertext: string | null;
  cycleShareUpdatedAt: number | null;
  /** Whose summary `cycleShareCiphertext` currently holds — lets a viewer
   *  tell "my own share" apart from a partner's. One slot only: if more than
   *  one member in the album ever turns sharing on, whoever wrote most
   *  recently is what's visible, same as any other single-value album field
   *  (the name, the relationship start date). Fine for the common case this
   *  is built for — cycle tracking is hard-gated to one gender by default —
   *  not a general multi-person sharing primitive. */
  cycleShareAuthorId: string | null;
};

export type AlbumRole = 'owner' | 'member';

export type AlbumMember = {
  id: string;
  albumId: string;
  userId: string | null;
  email: string | null;
  displayName: string | null;
  role: AlbumRole;
  joinedAt: number | null;
  /** Set once THIS member's own device has redeemed the out-of-band key
   *  transfer. A UX hint, never an access gate — see migration 0027. */
  keyConfirmedAt: number | null;
  removedAt: number | null;
};

export type AlbumPhoto = {
  id: string;
  albumId: string;
  /** Null until the ciphertext object exists in the shared-albums bucket. */
  remotePath: string | null;
  /** Opaque — decrypted client-side only. See album-crypto.ts. */
  captionCiphertext: string | null;
  /** The original type, in the clear — the uploaded bytes are always
   *  ciphertext, so this is what tells the client how to render them once
   *  decrypted. Not sensitive on its own: "this is a photo" is already
   *  implied by the feature. */
  mimeType: string | null;
  width: number | null;
  height: number | null;
  byteLength: number | null;
  addedBy: string | null;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type AlbumActivityAction =
  | 'album_created'
  | 'album_deleted'
  | 'member_added'
  | 'member_joined'
  | 'member_left'
  | 'member_removed'
  | 'photo_added'
  | 'photo_removed';

export type AlbumActivity = {
  id: string;
  albumId: string;
  actorId: string | null;
  actorName: string | null;
  action: AlbumActivityAction;
  photoId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: number;
};

/** A comment on one photo. `bodyCiphertext` is opaque — see album-crypto.ts. */
export type AlbumComment = {
  id: string;
  albumId: string;
  photoId: string | null;
  authorId: string | null;
  authorName: string | null;
  bodyCiphertext: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

/** One message in the album's chat. Same ciphertext discipline as
 *  AlbumComment. */
export type AlbumMessage = {
  id: string;
  albumId: string;
  authorId: string | null;
  authorName: string | null;
  bodyCiphertext: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

/** A shared plan: something the two of you mean to do, on a date. Migration
 *  0038. `eventDate` is plaintext (yyyy-MM-dd) — see that migration's header
 *  for why the date half of this content isn't sealed like the title. */
export type AlbumEvent = {
  id: string;
  albumId: string;
  titleCiphertext: string;
  notesCiphertext: string | null;
  eventDate: string;
  authorId: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

/** A custom, dated anniversary — alongside the day-count milestones
 *  TOGETHER_MILESTONES already computes from the album's own age. Migration
 *  0039. */
export type AlbumMilestone = {
  id: string;
  albumId: string;
  titleCiphertext: string;
  milestoneDate: string;
  recurring: boolean;
  authorId: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

/** A freeform shared note — same ciphertext shape as AlbumComment, minus a
 *  photo to hang off of. Migration 0040. */
export type AlbumNote = {
  id: string;
  albumId: string;
  bodyCiphertext: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};
