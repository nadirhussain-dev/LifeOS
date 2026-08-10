import { storeAlbumKey } from '@/features/private/services/album-keys';
import {
  createTransfer,
  redeemTransfer,
  type RedeemResult,
} from '@/features/private/services/key-transfer';
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

/** Long enough to read a QR code over a phone call without the link going
 *  stale mid-conversation; short enough that an unredeemed invite is not a
 *  standing liability. Not a security boundary — the token's entropy is. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
