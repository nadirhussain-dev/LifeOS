import { storeAlbumKey } from '@/features/private/services/album-keys';
import {
  createTransfer,
  redeemTransfer,
  type RedeemResult,
} from '@/features/private/services/key-transfer';
import { env } from '@/lib/env';
import { generateId } from '@/lib/id';
import { supabase } from '@/lib/supabase';
import { toSupabaseError } from '@/lib/supabase-error';

/**
 * The album invite flow: two channels, kept apart end to end.
 *
 * `createAlbumInvite`/`peekAlbumInvite`/`acceptAlbumInvite` are the
 * Supabase-mediated half — a token that grants Postgres/RLS membership only
 * (migration 0027). `redeemAlbumInvite` is the out-of-band half — it calls
 * `key-transfer.ts`'s `redeemTransfer` **unmodified**, the exact protocol
 * already built for moving a vault between one person's own devices, applied
 * here to a different key. Nothing in this file lets the two channels touch:
 * the album key never appears in a Supabase call, and the token never appears
 * in the QR/code exchange.
 *
 * `confirm_album_key` (called at the end of `redeemAlbumInvite`) is a UX
 * signal only — see migration 0027's header — never a gate. Accepting the
 * Postgres invitation and redeeming the key can happen in either order, or
 * with a delay between them; the member list distinguishes "joined" from
 * "waiting on the key" using it, and access control does not.
 */

function assertOk(error: unknown): void {
  if (error) throw toSupabaseError(error);
}

/**
 * The shareable half of an invite, as an https link.
 *
 * NOT `Linking.createURL()`, which is what this was and why album invites did
 * not work. That produces `daykeep://private/albums/accept/<token>`, and a
 * custom scheme dies twice over on its way to the person being invited: Gmail
 * sanitises `href` down to http/https/mailto/ftp so the link renders as
 * unclickable text, WhatsApp and most messengers do not linkify it at all, and
 * on a phone without Daykeep it resolves to nothing whatever the sender does.
 * The sender's own device opens it perfectly, which is exactly why it survived
 * testing — the one device it works on is the one holding it.
 *
 * `supabase/functions/join` already exists to answer this for group invites
 * (see its header, and commit 70f105a). It serves an https page that hands the
 * token to the app and falls back to visible instructions, so the same URL
 * works for somebody who has the app, somebody who does not, and every mail
 * client in between. Album invites take the same road with `/album/` in front
 * of the token.
 *
 * The link still grants Postgres/RLS membership ONLY — see this file's header.
 * The album key travels the other channel, and the landing page says so.
 */
export function albumInviteUrl(token: string): string {
  const base = env.EXPO_PUBLIC_SUPABASE_URL.replace(/\/+$/, '');
  return `${base}/functions/v1/join/album/${token}`;
}

/** Long enough to read a QR code over a phone call without the link going
 *  stale mid-conversation; short enough that an unredeemed invite is not a
 *  standing liability. Not a security boundary — the token's entropy is.
 *  Exported: album-repository.ts's addMemberByEmail mints the Postgres
 *  invitation up front now (see migration 0045) and needs the same TTL. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AlbumInvite = {
  /** Shown on the inviting device, read aloud or scanned on the joining one. */
  code: string;
  /** The wrapped album key. Safe over any channel; useless without the code. */
  payload: string;
  /** The Postgres/RLS half — a shareable link, or scanned as a second QR. */
  token: string;
  expiresAt: number;
};

/**
 * Starts an invite: mints the out-of-band key transfer AND the Postgres
 * invitation together, so the caller has both artifacts to hand over. The
 * placeholder member row (`p_member_id`) must already exist — same
 * precondition as `create_group_invitation` — created by a plain insert into
 * `shared_album_members`, mirroring `addMemberByEmail`.
 */
export async function createAlbumInvite(input: {
  albumId: string;
  memberId: string;
  email: string;
  albumKey: Uint8Array;
}): Promise<AlbumInvite> {
  const { code, payload } = await createTransfer(input.albumKey);
  const token = generateId();
  const expiresAt = Date.now() + INVITE_TTL_MS;

  const { error } = await supabase.rpc('create_album_invitation', {
    p_invitation_id: generateId(),
    p_album_id: input.albumId,
    p_member_id: input.memberId,
    p_email: input.email,
    p_token: token,
    p_expires_at: expiresAt,
    p_now: Date.now(),
  });
  assertOk(error);

  return { code, payload, token, expiresAt };
}

/** What an invitee may see before accepting: a status, and nothing else — the
 *  album name is ciphertext this device has no key for yet. */
export async function peekAlbumInvite(token: string): Promise<{ status: string }> {
  const { data, error } = await supabase.rpc('peek_album_invitation', {
    p_token: token,
    p_now: Date.now(),
  });
  assertOk(error);
  const row = Array.isArray(data) ? data[0] : data;
  return { status: String(row?.status ?? 'invalid') };
}

export type AcceptAlbumInviteResult = {
  status: string;
  /** Null unless `status` is `'ok'` or `'already_member'` — every other
   *  status means nothing was joined, so there's nothing to redeem a key
   *  into. */
  albumId: string | null;
  memberId: string | null;
};

/**
 * Grants Postgres/RLS membership only. Redeeming the album key is a separate
 * call — see `redeemAlbumInvite` — and neither requires the other to have
 * already happened.
 *
 * Returns the album and member ids alongside the status (migration 0027):
 * both are opaque ids, never the ciphertext name, and the accept screen needs
 * them to call `redeemAlbumInvite`/`confirm_album_key` for the album it just
 * joined — a bare status string leaves it with nothing to call those with.
 */
export async function acceptAlbumInvite(token: string): Promise<AcceptAlbumInviteResult> {
  const { data, error } = await supabase.rpc('accept_album_invitation', {
    p_token: token,
    p_now: Date.now(),
  });
  assertOk(error);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    status: String(row?.status ?? 'invalid'),
    albumId: row?.album_id ?? null,
    memberId: row?.member_id ?? null,
  };
}

type TransferFailure = Extract<RedeemResult, { ok: false }>;
export type RedeemAlbumKeyResult = { ok: true } | TransferFailure;

/**
 * Redeems the out-of-band half: unwraps the album key with the code, wraps
 * this device's own copy under the (already-unlocked) vault key, and tells
 * the server only that this device now has it — never what it is.
 */
export async function redeemAlbumInvite(input: {
  payload: string;
  code: string;
  albumId: string;
  memberId: string;
  vaultKey: Uint8Array;
}): Promise<RedeemAlbumKeyResult> {
  const result = await redeemTransfer(input.payload, input.code);
  if (!result.ok) return result;

  await storeAlbumKey(input.albumId, input.vaultKey, result.masterKey);

  const { error } = await supabase.rpc('confirm_album_key', {
    p_member_id: input.memberId,
    p_now: Date.now(),
  });
  assertOk(error);

  return { ok: true };
}

/** Re-shares the key with a fresh code/QR for a member still shown as
 *  "waiting on the key" — no server change, since the Postgres membership
 *  already exists; this only re-runs the out-of-band half. */
export async function resendAlbumKey(
  albumKey: Uint8Array,
): Promise<{ code: string; payload: string }> {
  return createTransfer(albumKey);
}

export type MyAlbumInvite = {
  id: string;
  albumId: string;
  token: string;
  invitedBy: string | null;
  createdAt: number;
  expiresAt: number;
};

/**
 * Invitations addressed to the signed-in account, discoverable without
 * needing the link/token handed to them out of band — migration 0045's
 * `shared_album_invitations_read_by_email` policy scopes this to rows whose
 * email matches the caller's own profile, nothing else. Feeds the Invites
 * inbox (app/private/albums/invites.tsx); the album name stays ciphertext
 * either way, same as the token-based accept screen.
 *
 * `email` has to be passed in and filtered on here, not left to RLS alone:
 * `shared_album_invitations_read` (migration 0027) is a second, OR'd policy
 * that lets any *member* of the album see all its invitation rows — it
 * exists for the members screen's "waiting on key" view, where the owner
 * needs to see the invite they just sent. Without this `.eq`, that policy
 * makes this query return the owner's own outgoing invites too, so inviting
 * someone else showed up as "you have a pending album invite" on the
 * inviter's own account.
 */
export async function listMyAlbumInvitations(email: string): Promise<MyAlbumInvite[]> {
  const { data, error } = await supabase
    .from('shared_album_invitations')
    .select('id, album_id, token, invited_by, created_at, expires_at')
    .eq('email', email.trim().toLowerCase())
    .is('accepted_at', null)
    .is('declined_at', null)
    .gt('expires_at', Date.now())
    .order('created_at', { ascending: false });
  assertOk(error);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    albumId: String(r.album_id),
    token: String(r.token),
    invitedBy: r.invited_by ? String(r.invited_by) : null,
    createdAt: Number(r.created_at),
    expiresAt: Number(r.expires_at),
  }));
}

/** The invitee's explicit "no" — see migration 0045's `decline_album_invitation`.
 *  Removes the placeholder member row server-side in the same call, so the
 *  owner's member list stops showing "pending" for someone who has declined. */
export async function declineAlbumInvite(token: string): Promise<{ status: string }> {
  const { data, error } = await supabase.rpc('decline_album_invitation', {
    p_token: token,
    p_now: Date.now(),
  });
  assertOk(error);
  const row = Array.isArray(data) ? data[0] : data;
  return { status: String(row?.status ?? 'invalid') };
}
