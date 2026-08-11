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
