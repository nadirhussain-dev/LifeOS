import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { useAuthStore } from '@/features/auth/services/auth-store';
import {
  encryptAlbumName,
  encryptComment,
  encryptMessage,
  tryDecryptAlbumName,
  tryDecryptComment,
  tryDecryptMessage,
} from '@/features/private/services/album-crypto';
import {
  createAlbumInvite,
  redeemAlbumInvite,
  type AlbumInvite,
  type RedeemAlbumKeyResult,
} from '@/features/private/services/album-invite';
import { storeAlbumKey, unwrapAlbumKey } from '@/features/private/services/album-keys';
import * as repo from '@/features/private/services/album-repository';
import {
  addPhotoToAlbum,
  type AddPhotoInput,
  type AddPhotoResult,
} from '@/features/private/services/album-uploader';
import { usePrivateStore } from '@/features/private/store/private-store';
import type { AlbumComment, AlbumMessage } from '@/features/private/types/shared-album.types';
import { generateMasterKey } from '@/features/private/services/vault-crypto';
import { supabase } from '@/lib/supabase';

/**
 * React Query wiring for shared albums — same shape as use-split.ts, plus
 * the one thing Split never had to do: every read of an album's name is
 * ciphertext until the album key is unwrapped, so "locked" is a real state
 * every hook here has to be able to return instead of a name.
 *
 * `useAlbumKey` is the single choke point for that unwrap, and it refuses to
 * run outside the real space (`space !== 'real'`) even though the decoy space
 * also holds a non-null vault key — the same distinction
 * `private-store.ts`'s `visiblePrivateModules()` has to make for the module
 * to be hidden at all. This is defense in depth, not the fix: the screens
 * this feeds must still be gated from ever mounting in decoy mode.
 */

export const albumKeys = {
  list: ['private', 'albums'] as const,
  album: (id: string) => ['private', 'albums', id] as const,
  key: (id: string, space: string | null) => ['private', 'album-key', id, space] as const,
  comments: (photoId: string) => ['private', 'albums', 'comments', photoId] as const,
  messages: (albumId: string) => ['private', 'albums', 'messages', albumId] as const,
  events: (albumId: string) => ['private', 'albums', 'events', albumId] as const,
  milestones: (albumId: string) => ['private', 'albums', 'milestones', albumId] as const,
  notes: (albumId: string) => ['private', 'albums', 'notes', albumId] as const,
};

/** Unwraps `albumId`'s key with whichever vault key is currently unlocked.
 *  `null` while locked, while outside the real space, or while this device
 *  has not redeemed the key yet — all three read the same to a caller. */
export function useAlbumKey(albumId: string | undefined) {
  const vaultKeyValue = usePrivateStore((s) => s.key);
  const space = usePrivateStore((s) => s.space);

  return useQuery({
    queryKey: albumKeys.key(albumId ?? '', space),
    enabled: !!albumId && !!vaultKeyValue && space === 'real',
    queryFn: () => unwrapAlbumKey(vaultKeyValue!, albumId!),
  });
}

export function useAlbums() {
  return useQuery({ queryKey: albumKeys.list, queryFn: repo.listAlbums });
}

/** Everything one album needs, in a single cache entry — same reasoning as
 *  use-split.ts's useGroupDetail. */
export function useAlbumDetail(albumId: string | undefined) {
  return useQuery({
    queryKey: albumKeys.album(albumId ?? ''),
    enabled: !!albumId,
    queryFn: async () => {
      const id = albumId!;
      const [album, members, photos, activity] = await Promise.all([
        repo.getAlbum(id),
        repo.listMembers(id),
        repo.listPhotos(id),
        repo.listActivity(id),
      ]);
      return {
        album,
        members,
        activeMembers: members.filter((m) => m.removedAt === null),
        photos,
        activity,
      };
    },
  });
}

/** Decrypts an album's name once its key is available. Never throws: a
 *  ciphertext this device's key cannot open renders as locked, not an error. */
export function useAlbumName(
  albumId: string | undefined,
  nameCiphertext: string | undefined,
): { name: string | null; locked: boolean } {
  const { data: albumKey } = useAlbumKey(albumId);
  return useMemo(() => {
    if (!nameCiphertext || !albumKey) return { name: null, locked: true };
    const name = tryDecryptAlbumName(albumKey, nameCiphertext);
    return { name, locked: name === null };
  }, [albumKey, nameCiphertext]);
}

/** Where the signed-in person stands in an album: their member row, whether
 *  they own it, and whether they are still in it — mirrors use-split.ts's
 *  useMyMembership. */
export function useMyAlbumMembership(data: ReturnType<typeof useAlbumDetail>['data']) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useMemo(() => {
    const me = data?.members.find((m) => m.userId === userId) ?? null;
    return { me, isOwner: me?.role === 'owner', isMember: !!me && me.removedAt === null };
  }, [data, userId]);
}

/** A comment/message with its ciphertext decrypted (or null if this device's
 *  key can't open it — same "locked, not an error" stance as useAlbumName). */
export type DecryptedComment = AlbumComment & { body: string | null };
export type DecryptedMessage = AlbumMessage & { body: string | null };

/** One photo's comment thread, decrypted. Disabled without an album key —
 *  there is nothing to decrypt yet, and no point asking the server. */
export function useAlbumComments(photoId: string | undefined, albumKey: Uint8Array | null) {
  return useQuery({
    queryKey: albumKeys.comments(photoId ?? ''),
    enabled: !!photoId && !!albumKey,
    queryFn: async () => {
      const rows = await repo.listComments(photoId!);
      return rows.map((c) => ({
        ...c,
        body: albumKey ? tryDecryptComment(albumKey, c.bodyCiphertext) : null,
      })) satisfies DecryptedComment[];
    },
  });
}

/** The album's chat, decrypted — same shape as useAlbumComments. */
export function useAlbumMessages(albumId: string | undefined, albumKey: Uint8Array | null) {
  return useQuery({
    queryKey: albumKeys.messages(albumId ?? ''),
    enabled: !!albumId && !!albumKey,
    queryFn: async () => {
      const rows = await repo.listMessages(albumId!);
      return rows.map((m) => ({
        ...m,
        body: albumKey ? tryDecryptMessage(albumKey, m.bodyCiphertext) : null,
      })) satisfies DecryptedMessage[];
    },
  });
}

/**
 * Live updates for one album's comments and chat, over Supabase Realtime —
 * the first use of it in this codebase. Realtime is not a second access-
 * control layer: it only tells this device *that* a row changed, and the
 * refetch it triggers goes through the exact same RLS policies (0029) as
 * every other read here. Subscribed only in the real space with the album
 * key already unwrapped — the same gate `useAlbumKey` applies — so a decoy
 * session or a locked album never opens a channel for something it cannot
 * decrypt anyway.
 */
export function useAlbumRealtime(albumId: string | undefined): void {
  const queryClient = useQueryClient();
  const space = usePrivateStore((s) => s.space);
  const vaultKeyValue = usePrivateStore((s) => s.key);

  useEffect(() => {
    if (!albumId || !vaultKeyValue || space !== 'real') return;

    const channel = supabase
      .channel(`shared-album:${albumId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shared_album_comments',
          filter: `album_id=eq.${albumId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as { photo_id?: string | null };
          if (row.photo_id) {
            void queryClient.invalidateQueries({ queryKey: albumKeys.comments(row.photo_id) });
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shared_album_messages',
          filter: `album_id=eq.${albumId}`,
        },
        () => void queryClient.invalidateQueries({ queryKey: albumKeys.messages(albumId) }),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shared_album_events',
          filter: `album_id=eq.${albumId}`,
        },
        () => void queryClient.invalidateQueries({ queryKey: albumKeys.events(albumId) }),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shared_album_milestones',
          filter: `album_id=eq.${albumId}`,
        },
        () => void queryClient.invalidateQueries({ queryKey: albumKeys.milestones(albumId) }),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shared_album_notes',
          filter: `album_id=eq.${albumId}`,
        },
        () => void queryClient.invalidateQueries({ queryKey: albumKeys.notes(albumId) }),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [albumId, vaultKeyValue, space, queryClient]);
}

// --- mutations ---------------------------------------------------------------

export function useSharedAlbumMutations(albumId?: string) {
  const queryClient = useQueryClient();
  const profile = useAuthStore((s) => s.profile);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const vaultKeyValue = usePrivateStore((s) => s.key);

  /** Album data is shared, so a local write is not the whole truth — refetch
   *  rather than patching the cache by hand, same as use-split.ts. */
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: albumKeys.list });
    if (albumId) void queryClient.invalidateQueries({ queryKey: albumKeys.album(albumId) });
  };

  const createAlbum = useMutation({
    mutationFn: async (name: string) => {
      if (!vaultKeyValue) {
        throw new Error('the private space must be unlocked to create an album');
      }
      const albumKey = generateMasterKey();
      const newAlbumId = await repo.createAlbum({
        nameCiphertext: encryptAlbumName(albumKey, name),
        displayName: profile?.displayName ?? null,
      });
      // This device's own copy, wrapped under the vault key already in memory
      // — the creator does not go through the out-of-band exchange for an
      // album they made themselves.
      await storeAlbumKey(newAlbumId, vaultKeyValue, albumKey);
      return newAlbumId;
    },
    onSuccess: invalidate,
  });

  const renameAlbum = useMutation({
    mutationFn: async (name: string) => {
      if (!albumId) throw new Error('no album');
      if (!vaultKeyValue) throw new Error('the private space must be unlocked to rename an album');
      const albumKey = await unwrapAlbumKey(vaultKeyValue, albumId);
      if (!albumKey) throw new Error('this album is locked on this device');
      await repo.renameAlbum(albumId, encryptAlbumName(albumKey, name));
    },
    onSuccess: invalidate,
  });

  const addMember = useMutation({
    mutationFn: (input: { email: string; displayName: string | null }) =>
      repo.addMemberByEmail({ albumId: albumId!, ...input }),
    onSuccess: invalidate,
  });

  /** Starts an invite: the Postgres half (membership) and the out-of-band
   *  half (the key transfer bundle) minted together — see album-invite.ts. */
  const invite = useMutation<
    AlbumInvite,
    unknown,
    { memberId: string; email: string; albumKey: Uint8Array }
  >({
    mutationFn: (input) => createAlbumInvite({ albumId: albumId!, ...input }),
    onSuccess: invalidate,
  });

  /** The joining device's half: redeem the out-of-band key and confirm it
   *  server-side — see album-invite.ts. Requires the vault to already be
   *  unlocked; the accept screen (Stage 4) is responsible for detouring
   *  through setup first if it is not. */
  const redeemInvite = useMutation<
    RedeemAlbumKeyResult,
    unknown,
    { payload: string; code: string; memberId: string }
  >({
    mutationFn: (input) => {
      if (!vaultKeyValue) {
        throw new Error('the private space must be unlocked to redeem an album invite');
      }
      return redeemAlbumInvite({ ...input, albumId: albumId!, vaultKey: vaultKeyValue });
    },
    onSuccess: invalidate,
  });

  const removeMember = useMutation({
    mutationFn: (memberId: string) => repo.removeMember(memberId),
    onSuccess: invalidate,
  });

  /** Encrypts and uploads one photo — see album-uploader.ts. Requires the
   *  album to already be unlocked on this device; the picker screen (Stage 4)
   *  should not offer "add photo" at all while `useAlbumKey` has no key. */
  const addPhoto = useMutation<AddPhotoResult, unknown, Omit<AddPhotoInput, 'albumId'>>({
    mutationFn: (input) => addPhotoToAlbum({ albumId: albumId!, ...input }),
    onSuccess: invalidate,
  });

  const removePhoto = useMutation({
    mutationFn: (photoId: string) => repo.removePhoto(photoId),
    onSuccess: invalidate,
  });

  /** Owner-only, and soft: everyone else keeps the activity trail. */
  const deleteAlbum = useMutation({
    mutationFn: () => repo.deleteAlbum(albumId!),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: albumKeys.list }),
  });

  /** Owner-only — migration 0029's trigger is the real enforcement; this
   *  mutation just calls the update and lets a non-owner's attempt come back
   *  as an error, same as every other owner-gated action here. */
  const setPermissions = useMutation({
    mutationFn: (permissions: { allowComments?: boolean; allowChat?: boolean; allowNotes?: boolean }) =>
      repo.setAlbumPermissions(albumId!, permissions),
    onSuccess: invalidate,
  });

  const addComment = useMutation({
    mutationFn: (input: { photoId: string; body: string; albumKey: Uint8Array }) =>
      repo.addComment({
        albumId: albumId!,
        photoId: input.photoId,
        authorId: userId ?? '',
        authorName: profile?.displayName || profile?.username || null,
        bodyCiphertext: encryptComment(input.albumKey, input.body),
      }),
    onSuccess: (_data, variables) =>
      void queryClient.invalidateQueries({ queryKey: albumKeys.comments(variables.photoId) }),
  });

  const removeComment = useMutation({
    mutationFn: (input: { commentId: string; photoId: string }) =>
      repo.removeComment(input.commentId),
    onSuccess: (_data, variables) =>
      void queryClient.invalidateQueries({ queryKey: albumKeys.comments(variables.photoId) }),
  });

  const sendMessage = useMutation({
    mutationFn: (input: { body: string; albumKey: Uint8Array }) =>
      repo.sendMessage({
        albumId: albumId!,
        authorId: userId ?? '',
        authorName: profile?.displayName || profile?.username || null,
        bodyCiphertext: encryptMessage(input.albumKey, input.body),
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: albumKeys.messages(albumId ?? '') }),
  });

  const removeMessage = useMutation({
    mutationFn: (messageId: string) => repo.removeMessage(messageId),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: albumKeys.messages(albumId ?? '') }),
  });

  return {
    createAlbum,
    renameAlbum,
    addMember,
    addPhoto,
    invite,
    redeemInvite,
    removeMember,
    removePhoto,
    deleteAlbum,
    setPermissions,
    addComment,
    removeComment,
    sendMessage,
    removeMessage,
  };
}
