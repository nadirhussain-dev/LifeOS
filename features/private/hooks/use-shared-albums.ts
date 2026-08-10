import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useAuthStore } from '@/features/auth/services/auth-store';
import { tryDecryptAlbumName, encryptAlbumName } from '@/features/private/services/album-crypto';
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
import { generateMasterKey } from '@/features/private/services/vault-crypto';

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

// --- mutations ---------------------------------------------------------------

export function useSharedAlbumMutations(albumId?: string) {
  const queryClient = useQueryClient();
  const profile = useAuthStore((s) => s.profile);
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
  };
}
