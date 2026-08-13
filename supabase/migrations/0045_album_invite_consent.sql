-- 0045_album_invite_consent.sql
--
-- Supersedes 0044_album_member_auto_link.sql, which set `user_id` on a
-- member row the moment the invited email matched a registered account —
-- granting that account RLS read access to the album's photos/chat/notes
-- immediately, with zero action from them. Every other membership path in
-- this app requires the invitee's own affirmative action
-- (accept_album_invitation only ever runs when they tap "Finish" on the
-- accept screen); this closes that gap rather than carrying it forward.
--
-- It also removed the `user_id_for_email` lookup from this path entirely,
-- not just the client-visible "already has an account" toast that used it —
-- that lookup is deliberately locked down (0021's revoke, "an email-to-
-- account oracle") and this path has no legitimate need for it once
-- membership requires consent anyway.
--
-- What replaces it: `addMemberByEmail` now mints the Postgres invitation
-- (token) in the same call that creates the placeholder member, instead of
-- requiring a separate manual "Send" step. That's enough, on its own, for an
-- invitee who already has the app to find it in their own Invites inbox
-- (new `shared_album_invitations_read_by_email` policy below) without the
-- owner needing to export/share a link — no lookup required to make that
-- true, since discovery happens by the invitee's own signed-in email
-- matching the row, not by the owner learning anything about the recipient.

drop function if exists public.add_shared_album_member_by_email(text, text, text, text, bigint);

-- SECURITY INVOKER, deliberately — unlike 0044's version, this needs no
-- elevated privilege at all. Both inserts are already fully covered by
-- existing RLS (shared_album_members_insert, shared_album_invitations_write)
-- for a caller who is already a member/creator of the album; this function
-- exists only to make them atomic, not to bypass anything.
create or replace function public.add_shared_album_member_by_email(
  p_member_id text,
  p_album_id text,
  p_email text,
  p_display_name text,
  p_invitation_id text,
  p_token text,
  p_expires_at bigint,
  p_now bigint
)
returns table (member_id text, token text)
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.shared_album_members (
    id, album_id, user_id, email, display_name, role, created_at, updated_at
  ) values (
    p_member_id, p_album_id, null, lower(trim(p_email)), p_display_name, 'member', p_now, p_now
  );

  insert into public.shared_album_invitations (
    id, album_id, member_id, email, token, invited_by, expires_at, created_at
  ) values (
    p_invitation_id, p_album_id, p_member_id, lower(trim(p_email)), p_token, auth.uid(), p_expires_at, p_now
  );

  return query select p_member_id, p_token;
end;
$$;

revoke execute on function public.add_shared_album_member_by_email(text, text, text, text, text, text, bigint, bigint)
  from public, anon;
grant execute on function public.add_shared_album_member_by_email(text, text, text, text, text, text, bigint, bigint)
  to authenticated;

-- Lets an invitee discover invitations addressed to them by email without
-- being a member yet — additive (RLS OR's permissive policies for the same
-- command), alongside the existing shared_album_invitations_read policy,
-- which stays scoped to existing members. Reveals nothing beyond what the
-- invitee is already entitled to see once they open the (already-existing)
-- accept screen with the token in hand: never the album name, which stays
-- ciphertext regardless of how this row was reached.
create policy "shared_album_invitations_read_by_email" on public.shared_album_invitations
  for select using (
    lower(email) = lower((select email from public.profiles where id = auth.uid()))
  );

alter table public.shared_album_invitations add column if not exists declined_at bigint;

-- The invitee's explicit "no". SECURITY DEFINER for the same reason
-- accept_album_invitation is: before this runs, RLS still hides the
-- placeholder member row from someone who is not a member yet. Tombstones
-- the placeholder alongside the invitation so the owner's member list stops
-- showing "pending" for someone who has already said no — mirrors
-- remove_album_member's own reasoning for why this needs to be one atomic
-- server-side action rather than two client calls.
create or replace function public.decline_album_invitation(p_token text, p_now bigint)
returns table (status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.shared_album_invitations%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    return query select 'unauthenticated'::text;
    return;
  end if;

  select * into v_invite from public.shared_album_invitations where token = p_token;
  if v_invite.id is null then
    return query select 'invalid'::text;
    return;
  end if;
  if v_invite.accepted_at is not null then
    return query select 'already_accepted'::text;
    return;
  end if;
  if v_invite.declined_at is not null then
    return query select 'ok'::text;
    return;
  end if;

  select email into v_email from public.profiles where id = auth.uid();
  if v_email is null or lower(v_email) <> lower(v_invite.email) then
    return query select 'not_yours'::text;
    return;
  end if;

  update public.shared_album_invitations set declined_at = p_now where id = v_invite.id;
  update public.shared_album_members set deleted_at = p_now, updated_at = p_now
   where id = v_invite.member_id and user_id is null and deleted_at is null;

  return query select 'ok'::text;
end;
$$;

revoke execute on function public.decline_album_invitation(text, bigint) from public, anon;
grant execute on function public.decline_album_invitation(text, bigint) to authenticated;
