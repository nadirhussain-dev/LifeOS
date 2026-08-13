import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/features/auth/services/auth-store';
import {
  declineAlbumInvite,
  listMyAlbumInvitations,
} from '@/features/private/services/album-invite';

/**
 * The signed-in account's own pending invitations — separate from
 * albumKeys.* (use-shared-albums.ts), which is scoped to albums this device
 * is already a member of. This is the other side: albums somebody else has
 * asked to add this account to, not yet consented to either way.
 */
const myInvitationsKey = ['private', 'my-invitations'] as const;

/** `listMyAlbumInvitations` needs a session the same way `useAlbums` does
 *  (use-shared-albums.ts) — `peek_album_invitation` is `anon`-callable but
 *  the "my invitations" list is scoped to `auth.uid()` and grant-restricted
 *  to `authenticated`, so a guest calling this throws rather than seeing an
 *  empty inbox. `enabled` here, not left to callers.
 *
 *  Also needs the session's own email — `listMyAlbumInvitations` filters on
 *  it client-side (see that function's header for why RLS alone isn't
 *  enough), so this waits on `session.user.email` rather than the
 *  separately-loaded `profile`, which can still be null right after sign-in. */
export function useMyAlbumInvitations() {
  const session = useAuthStore((s) => s.session);
  const email = session?.user?.email ?? null;
  return useQuery({
    queryKey: [...myInvitationsKey, email],
    queryFn: () => listMyAlbumInvitations(email!),
    enabled: !!session && !!email,
  });
}

export function useDeclineAlbumInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: declineAlbumInvite,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: myInvitationsKey }),
  });
}
