-- 0044_album_member_auto_link.sql
--
-- Adding somebody by email who already has a Daykeep account used to leave
-- `user_id` null on their member row regardless — the same placeholder shape
-- as a total stranger, forcing the full invite-link-plus-code exchange even
-- between two people who already both use the app. `user_id_for_email()`
-- (0021) already resolves an email to an account, but it is deliberately
-- locked down (`revoke execute ... from public, anon, authenticated`, with a
-- comment calling it "an email-to-account oracle") — the client must never
-- be able to call it as a free-standing lookup, or "add a member" becomes a
-- way to probe arbitrary emails for a Daykeep account.
--
-- This function is the one sanctioned caller of that lookup from client code:
-- it only runs it as a side effect of an already-authorized "add a member to
-- an album I'm already in" action, replicating shared_album_members_insert's
-- own RLS check by hand (SECURITY DEFINER bypasses RLS, so this must enforce
-- it itself) rather than opening the lookup up generally.
--
-- Linking `user_id` here does not shortcut the album *key* exchange — that
-- stays out-of-band and unconditional (see album-invite.ts's header). It
-- only means the member's Postgres row starts "joined" instead of "pending",
-- which is what routes them straight to the existing resend-key flow
-- (invite.tsx's `isResend` branch) instead of the stranger invite-link path.

create or replace function public.add_shared_album_member_by_email(
  p_member_id text,
  p_album_id text,
  p_email text,
  p_display_name text,
  p_now bigint
)
returns table (member_id text, linked boolean)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_name text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if not public.can_share(v_uid) then
    raise exception 'not allowed to share' using errcode = 'insufficient_privilege';
  end if;

  -- Mirrors shared_album_members_insert (0027) exactly: the caller must
  -- already be a member of this album, or be the album's creator during the
  -- same bootstrap window create_shared_album relies on.
  if p_album_id not in (select public.my_album_ids())
     and p_album_id not in (select public.my_created_album_ids()) then
    raise exception 'not a member of this album' using errcode = 'insufficient_privilege';
  end if;

  v_target := public.user_id_for_email(p_email);

  if v_target is not null then
    select coalesce(p_display_name, p.display_name, p.username) into v_name
      from public.profiles p
     where p.id = v_target;
  else
    v_name := p_display_name;
  end if;

  -- guard_album_member_not_blocked (0021/0027) still fires on this insert —
  -- SECURITY DEFINER bypasses RLS, not triggers — so a blocked target is
  -- still rejected exactly as it would be for a direct client insert.
  insert into public.shared_album_members (
    id, album_id, user_id, email, display_name, role,
    joined_at, created_at, updated_at
  ) values (
    p_member_id, p_album_id, v_target, lower(trim(p_email)), v_name, 'member',
    case when v_target is not null then p_now else null end, p_now, p_now
  );

  return query select p_member_id, (v_target is not null);
end;
$$;

revoke execute on function public.add_shared_album_member_by_email(text, text, text, text, bigint)
  from public, anon;
grant execute on function public.add_shared_album_member_by_email(text, text, text, text, bigint)
  to authenticated;
