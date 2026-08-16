-- 0021_user_blocks.sql
--
-- Blocking somebody, as a user rather than as an operator.
--
-- ## Why this exists
--
-- 0010 through 0019 built the operator side of moderation: reports, staff
-- tiers, account blocks, audit. All of it runs through somebody at Daykeep
-- deciding something. There was nothing a user could do about another user in
-- the moment, which is both the thing that actually helps and the thing Google
-- Play's user-generated-content policy and App Store 1.2 require: an app whose
-- users can reach each other must let them report content AND block the person.
--
-- ## What blocking has to stop, here
--
-- The one surface where a stranger reaches you is a shared expense group. The
-- sequence is: they add your email as a placeholder member, then send an
-- invitation, which emails you and deep-links into the app. That invitation is
-- the contact. Everything downstream of accepting it — the group name, the
-- expense descriptions, the activity feed — is content they can write and you
-- can read.
--
-- So a block has to bite at three points, not one:
--
--   1. Adding your email to a group, which is where the placeholder is created.
--   2. Creating the invitation, which is the message that actually reaches you.
--   3. Accepting one, because an invitation created before the block still has
--      a live token, and a token is bearer authority — nothing else would stop
--      it being redeemed later.
--
-- Points 1 and 2 are triggers rather than checks inside the RPCs, because a
-- member row is inserted directly under RLS (see addMemberByEmail) and an RPC
-- check would only cover the path that happens to go through an RPC today.
--
-- ## Symmetric, deliberately
--
-- A block stops contact in both directions, not just theirs toward you. The
-- asymmetric version reads as more precise and produces an obvious hole: you
-- block somebody, then add them to a group yourself, and now you are in a
-- shared space with them again — with content they can write. If you want to
-- reach them, unblock them.
--
-- ## What it does NOT do
--
-- It does not remove either of you from a group you are already both in. That
-- would either delete a membership row the ledger depends on (0008 exists
-- because filtering members out of the balances made £75 vanish from a £100
-- dinner) or silently change what everybody else in the group is owed. Leaving
-- the group is the existing action for that, and it is the honest one. The UI
-- says this rather than implying a block retroactively separates you.

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------
--
-- Both columns cascade, so a deleted account takes its blocks with it in either
-- direction — this table has no `user_id` column, so 0020's catalog checks do
-- not cover it and the constraints below are the whole guarantee. The SQL
-- suite asserts both directions.

create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

-- The lookup is "is there a block in either direction between these two", which
-- is two index probes; the primary key serves one and this serves the other.
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

-- You may see, create and remove the blocks YOU made. There is deliberately no
-- policy granting `blocked_id = auth.uid()`: being able to read who blocked you
-- turns the feature against the person using it. Somebody who can enumerate
-- their blockers knows exactly who to reach on another account, and the reason
-- most people block somebody is that they do not want that person to know.
create policy "user_blocks_own" on public.user_blocks
  for all using (blocker_id = (select auth.uid()))
  with check (blocker_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- The predicate
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER because it has to see blocks in the direction the policy
-- above hides: the whole point is to answer "has this person blocked me"
-- without letting the caller read that fact. It returns a boolean and nothing
-- else, so the answer cannot be mined for who — only for whether, about a pair
-- the caller is already party to.

create or replace function public.contact_blocked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select exists (
    select 1 from public.user_blocks
     where (blocker_id = p_a and blocked_id = p_b)
        or (blocker_id = p_b and blocked_id = p_a)
  );
$fn$;

-- Resolves an email to an account, for the two triggers below. Definer because
-- `profiles_own` hides everybody else's row, and this is the one thing a
-- non-owner legitimately needs from it — reduced to a uuid that the caller
-- never sees, only the trigger does.
create or replace function public.user_id_for_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select id from public.profiles
   where lower(email) = lower(trim(p_email))
   limit 1;
$fn$;

-- ---------------------------------------------------------------------------
-- Enforcement
-- ---------------------------------------------------------------------------
--
-- ## On the wording of the refusal
--
-- The message names neither the block nor the person. "Blocked you" would
-- confirm the block to the one person it is meant to be opaque to, and someone
-- who learns they are blocked is exactly the someone who opens a second
-- account. A silent success is the other tempting option and is worse: the
-- inviter watches for a member who never appears and tries again, and the app
-- has lied about what it did.
--
-- So: a true statement that does not say why. This person cannot be added.
-- It is also true of several other states, which is the property that makes it
-- safe.

create or replace function public.guard_member_not_blocked()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
begin
  -- No session means accept_group_invitation() running as its own definer,
  -- which does its own check below. This trigger guards the client's insert.
  if v_uid is null then
    return new;
  end if;

  v_target := coalesce(new.user_id, public.user_id_for_email(new.email));

  -- An email with no account behind it cannot have blocked anybody yet. If they
  -- sign up later and block the inviter, accepting is where it is caught.
  if v_target is null or v_target = v_uid then
    return new;
  end if;

  if public.contact_blocked(v_uid, v_target) then
    raise exception 'this person cannot be added to a group'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace function public.guard_invitation_not_blocked()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
begin
  if v_uid is null then
    return new;
  end if;

  v_target := public.user_id_for_email(new.email);
  if v_target is null or v_target = v_uid then
    return new;
  end if;

  if public.contact_blocked(v_uid, v_target) then
    raise exception 'this person cannot be invited'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_member_not_blocked on public.expense_group_members;
create trigger guard_member_not_blocked
  before insert on public.expense_group_members
  for each row execute function public.guard_member_not_blocked();

drop trigger if exists guard_invitation_not_blocked on public.expense_group_invitations;
create trigger guard_invitation_not_blocked
  before insert on public.expense_group_invitations
  for each row execute function public.guard_invitation_not_blocked();

-- ---------------------------------------------------------------------------
-- Redemption
-- ---------------------------------------------------------------------------
--
-- Re-declares 0005's accept_group_invitation with one added check. An
-- invitation minted before the block still carries a live token, and the token
-- is the entire authority — without this, blocking somebody who had already
-- invited you leaves the way in open until the token expires.
--
-- The status string is `blocked`, distinct from `invalid`: this is the one side
-- of the exchange where naming it is safe, because the person reading it is the
-- one who made the block. peek_group_invitation is untouched and still reports
-- such a token as ordinary, so nothing the inviter can see changes.

create or replace function public.accept_group_invitation(p_token text, p_now bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.expense_group_invitations%rowtype;
  v_existing text;
begin
  if auth.uid() is null then
    return 'unauthenticated';
  end if;

  select * into v_invite
    from public.expense_group_invitations
   where token = p_token;

  if v_invite.id is null then
    return 'invalid';
  end if;
  if v_invite.accepted_at is not null then
    return 'already_accepted';
  end if;
  if v_invite.expires_at < p_now then
    return 'expired';
  end if;

  -- 0021. Checked before the invitation is consumed, so declining to join
  -- somebody you have blocked does not also burn the token — you may unblock
  -- and accept later, and the ledger is unchanged in the meantime.
  if v_invite.invited_by is not null
     and public.contact_blocked(auth.uid(), v_invite.invited_by) then
    return 'blocked';
  end if;

  -- Already in the group through some other route: consume the invitation so
  -- it cannot be reused, but do not create a second membership.
  select id into v_existing
    from public.expense_group_members
   where group_id = v_invite.group_id
     and user_id = auth.uid()
     and deleted_at is null;

  if v_existing is not null then
    update public.expense_group_invitations
       set accepted_at = p_now, accepted_by = auth.uid()
     where id = v_invite.id;
    return 'already_member';
  end if;

  -- Claim the placeholder member row the inviter created, so any expenses
  -- already split with this person carry over rather than being orphaned.
  update public.expense_group_members
     set user_id = auth.uid(),
         joined_at = p_now,
         updated_at = p_now
   where id = v_invite.member_id
     and user_id is null
     and deleted_at is null;

  if not found then
    return 'member_unavailable';
  end if;

  update public.expense_group_invitations
     set accepted_at = p_now, accepted_by = auth.uid()
   where id = v_invite.id;

  insert into public.expense_group_activity (
    id, group_id, actor_id, actor_name, action, meta, created_at
  ) values (
    v_invite.id || ':joined', v_invite.group_id, auth.uid(),
    public.current_actor_name(), 'member_joined',
    jsonb_build_object('email', v_invite.email), p_now
  );

  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- The user-facing verbs
-- ---------------------------------------------------------------------------
--
-- Plain inserts would work under the policy above. These exist because the
-- client should not have to know that blocking is a row: `block_user` is
-- idempotent (blocking twice is not an error the UI should have to model), and
-- refusing self-blocks here gives a readable message instead of a constraint
-- violation.

create or replace function public.block_user(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot block yourself' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.user_blocks (blocker_id, blocked_id)
  values (auth.uid(), p_user_id)
  on conflict (blocker_id, blocked_id) do nothing;
end;
$$;

create or replace function public.unblock_user(p_user_id uuid)
returns void
language sql
security invoker
set search_path = public
as $fn$
  delete from public.user_blocks
   where blocker_id = auth.uid() and blocked_id = p_user_id;
$fn$;

-- The unblock screen needs a name to show, and `profiles_own` hides it. Definer
-- for that reason, and scoped to rows the caller blocked themselves — it can
-- only ever return people the caller already chose, so it is not a directory.
create or replace function public.list_blocked_accounts()
returns table (user_id uuid, display_name text, username text, blocked_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select b.blocked_id,
         p.display_name,
         p.username,
         b.created_at
    from public.user_blocks b
    left join public.profiles p on p.id = b.blocked_id
   where b.blocker_id = auth.uid()
   order by b.created_at desc;
$fn$;

-- contact_blocked and user_id_for_email are internals of the triggers above.
-- Left callable, `user_id_for_email` is an email-to-account oracle and
-- `contact_blocked` leaks the blocks the RLS policy exists to hide.
revoke execute on function public.contact_blocked(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.user_id_for_email(text) from public, anon, authenticated;

revoke execute on function public.block_user(uuid) from public, anon;
revoke execute on function public.unblock_user(uuid) from public, anon;
revoke execute on function public.list_blocked_accounts() from public, anon;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.list_blocked_accounts() to authenticated;
