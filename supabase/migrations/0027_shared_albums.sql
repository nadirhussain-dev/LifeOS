-- 0027 — Shared, end-to-end-encrypted photo albums.
--
-- TODO.md's "Sharing & E2E sync" section named the open question: a shared
-- space between two or more people (a couple, typically) is decided to be a
-- **photo album**. This migration is the Postgres/RLS half of it — membership,
-- invitations, activity — modelled directly on the expense-group tables
-- (0003, hoisted the way 0023 later rewrote them to be, from the start here)
-- because "many people read and write the same rows, access decided by
-- membership rather than ownership" is exactly the same shape of problem.
--
-- Three things are NOT like expense groups, and matter for how this reads:
--
-- 1. **This is end-to-end encrypted, with no operator-escrow exception.**
--    `name_ciphertext` and `caption_ciphertext` are opaque blobs, sealed under
--    an album key that never reaches this database in any form — not wrapped,
--    not escrowed, not even as a hash. Everything else in this file (who is a
--    member, when a photo was added, its dimensions) is ordinary metadata this
--    server legitimately needs to route access; the content is not. See
--    `features/private/services/album-keys.ts` for where that key actually
--    lives (wrapped under the device's vault master key, in SecureStore only).
-- 2. **Invitations here grant membership, never key material.** Redeeming a
--    token via `accept_album_invitation` gets you into the tables below and
--    nothing else — you cannot decrypt a single row until the album key
--    separately reaches you over `features/private/services/key-transfer.ts`'s
--    out-of-band QR/code channel, which this database never sees. The two are
--    deliberately decoupled; `key_confirmed_at` is a UX hint the *receiving*
--    device sets after it unwraps the key locally, not a gate — access control
--    stays purely membership-based, exactly like the expense groups.
-- 3. **Removing a member is a tombstone, and that is the whole of what it
--    does.** It stops the removed member fetching anything NEW the moment
--    RLS re-evaluates (immediately) — no rotation of the album key happens
--    here or anywhere. That is a deliberate, documented gap (see TODO.md):
--    rotation's only marginal value is bounding a future storage/DB breach,
--    since RLS already blocks ordinary re-fetching regardless of the key.
--
-- File order matters, as in 0003: tables → indexes → helpers → RLS → RPCs.

-- ===========================================================================
-- 1. TABLES
-- ===========================================================================

create table if not exists public.shared_albums (
  id text primary key,
  -- No plaintext name column, ever — see the header. Decrypted client-side
  -- only, which is also why peek_album_invitation (below) cannot show it.
  name_ciphertext text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

-- Same shape as expense_group_members (0003): a member may exist as an
-- email-only placeholder before they have an account or have redeemed an
-- invitation.
create table if not exists public.shared_album_members (
  id text primary key,
  album_id text not null references public.shared_albums(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  display_name text,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at bigint,
  -- Set by the RECEIVING device via confirm_album_key(), once it has
  -- successfully unwrapped the album key locally. Purely informational — the
  -- UI's "waiting on the key" vs. "joined" distinction. Never checked by any
  -- policy here: gating access on this would make it a second, server-visible
  -- proxy for key possession, which is exactly the thing the out-of-band
  -- channel exists to avoid.
  key_confirmed_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  constraint shared_album_members_identified check (user_id is not null or email is not null)
);

create table if not exists public.shared_album_photos (
  id text primary key,
  album_id text not null references public.shared_albums(id) on delete cascade,
  -- Null until the ciphertext object actually exists in the shared-albums
  -- bucket (0028) — same resumability idiom as gallery_photos.remote_path.
  remote_path text,
  caption_ciphertext text,
  -- The ORIGINAL mime type, in the clear. Once encrypted the object's own
  -- content-type is meaningless (0028 uploads everything as
  -- application/octet-stream), so this is the one place that survives to
  -- tell the client what to wrap the decrypted bytes as. Not a
  -- confidentiality concern on the level of a caption or a name — "this is a
  -- photo" is already obvious from the feature being a photo album.
  mime_type text,
  width integer,
  height integer,
  byte_length bigint,
  added_by uuid references auth.users(id) on delete set null,
  position bigint not null default 0,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

-- Who did what: mirrors expense_group_activity, minus anything ledger-shaped —
-- there is no money here, so no amounts.
create table if not exists public.shared_album_activity (
  id text primary key,
  album_id text not null references public.shared_albums(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,
  action text not null check (action in (
    'album_created', 'album_deleted',
    'member_added', 'member_joined', 'member_left', 'member_removed',
    'photo_added', 'photo_removed'
  )),
  photo_id text references public.shared_album_photos(id) on delete set null,
  meta jsonb,
  created_at bigint not null
);

-- Identical shape to expense_group_invitations (0003). The token is the
-- entire authority for the Postgres/membership half; the album key travels
-- by a completely separate, out-of-band channel this table has no knowledge
-- of.
create table if not exists public.shared_album_invitations (
  id text primary key,
  album_id text not null references public.shared_albums(id) on delete cascade,
  member_id text references public.shared_album_members(id) on delete cascade,
  email text not null,
  token text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  expires_at bigint not null,
  accepted_at bigint,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at bigint not null
);

-- ===========================================================================
-- 2. INDEXES
-- ===========================================================================

create unique index if not exists shared_album_members_user_idx
  on public.shared_album_members (album_id, user_id)
  where user_id is not null and deleted_at is null;

create unique index if not exists shared_album_members_email_idx
  on public.shared_album_members (album_id, lower(email))
  where email is not null and deleted_at is null;

create index if not exists shared_album_members_album_idx
  on public.shared_album_members (album_id);

-- The hoisted predicates below (section 3) evaluate this once per statement,
-- so they need it indexed from the start — no separate "at scale" migration
-- this time, unlike expense groups' 0003 → 0023 history.
create index if not exists shared_album_members_user_live_idx
  on public.shared_album_members (user_id, album_id)
  where deleted_at is null;

create index if not exists shared_album_photos_album_idx
  on public.shared_album_photos (album_id, position);
create index if not exists shared_album_activity_album_idx
  on public.shared_album_activity (album_id, created_at desc);
create index if not exists shared_album_invitations_email_idx
  on public.shared_album_invitations (lower(email));
create index if not exists shared_album_invitations_album_idx
  on public.shared_album_invitations (album_id);

-- ===========================================================================
-- 3. MEMBERSHIP HELPERS — hoisted from the start (0023's lesson applied up
-- front): argument-free, STABLE, SECURITY DEFINER so a policy that reads
-- shared_album_members does not recurse into its own policy.
-- ===========================================================================

create or replace function public.my_album_ids()
returns setof text
language sql
security definer
set search_path = public
stable
as $$
  select m.album_id
    from public.shared_album_members m
   where m.user_id = (select auth.uid())
     and m.deleted_at is null;
$$;

create or replace function public.my_owned_album_ids()
returns setof text
language sql
security definer
set search_path = public
stable
as $$
  select m.album_id
    from public.shared_album_members m
   where m.user_id = (select auth.uid())
     and m.role = 'owner'
     and m.deleted_at is null;
$$;

-- Same bootstrap reasoning as my_created_expense_group_ids() (0023): creating
-- an album and inserting its first (owner) member row happen in one
-- transaction, so at the moment of that insert the creator is not yet a
-- member. Without this the album would be unjoinable by its own creator.
create or replace function public.my_created_album_ids()
returns setof text
language sql
security definer
set search_path = public
stable
as $$
  select a.id
    from public.shared_albums a
   where a.created_by = (select auth.uid());
$$;

-- Single-album boolean, for the RPC bodies and the deletion-guard trigger
-- below, where a per-row correlated check is exactly what is wanted and there
-- is no per-row RLS cost to avoid (mirrors is_expense_group_owner, 0003).
create or replace function public.is_shared_album_owner(aid text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.shared_album_members m
     where m.album_id = aid
       and m.user_id = auth.uid()
       and m.role = 'owner'
       and m.deleted_at is null
  );
$$;

revoke all on function public.my_album_ids() from public, anon;
revoke all on function public.my_owned_album_ids() from public, anon;
revoke all on function public.my_created_album_ids() from public, anon;
revoke all on function public.is_shared_album_owner(text) from public, anon;

grant execute on function public.my_album_ids() to authenticated;
grant execute on function public.my_owned_album_ids() to authenticated;
grant execute on function public.my_created_album_ids() to authenticated;
grant execute on function public.is_shared_album_owner(text) to authenticated;

-- ===========================================================================
-- 4. ROW LEVEL SECURITY
-- ===========================================================================

alter table public.shared_albums enable row level security;
alter table public.shared_album_members enable row level security;
alter table public.shared_album_photos enable row level security;
alter table public.shared_album_activity enable row level security;
alter table public.shared_album_invitations enable row level security;

-- --- albums ---
create policy "shared_albums_read" on public.shared_albums
  for select using (id in (select public.my_album_ids()));

create policy "shared_albums_insert" on public.shared_albums
  for insert with check (created_by = (select auth.uid()));

create policy "shared_albums_update" on public.shared_albums
  for update using (id in (select public.my_album_ids()))
  with check (id in (select public.my_album_ids()));

-- Column-level narrowing (deleted_at is owner-only) is a trigger, below —
-- same reasoning as guard_expense_group_deletion (0008): the update policy
-- has to stay permissive so any member can rename the album.
create policy "shared_albums_delete" on public.shared_albums
  for delete using (id in (select public.my_owned_album_ids()));

-- --- members ---
create policy "shared_album_members_read" on public.shared_album_members
  for select using (album_id in (select public.my_album_ids()));

-- Carries 0010's can_share() gate and the creator bootstrap, same shape as
-- expense_group_members_insert (0023).
create policy "shared_album_members_insert" on public.shared_album_members
  for insert with check (
    public.can_share((select auth.uid()))
    and (
      album_id in (select public.my_album_ids())
      or album_id in (select public.my_created_album_ids())
    )
  );

create policy "shared_album_members_update" on public.shared_album_members
  for update using (album_id in (select public.my_album_ids()))
  with check (album_id in (select public.my_album_ids()));

create policy "shared_album_members_delete" on public.shared_album_members
  for delete using (
    album_id in (select public.my_owned_album_ids())
    or user_id = (select auth.uid())  -- anyone may leave
  );

-- --- photos --- any member may add/edit/remove any photo: the activity log
-- (and, unlike expenses, there being no shared money at stake) is what makes
-- that an acceptable default, same as expense_group_expenses_all.
create policy "shared_album_photos_all" on public.shared_album_photos
  for all using (album_id in (select public.my_album_ids()))
  with check (album_id in (select public.my_album_ids()));

-- --- activity (append-only) ---
create policy "shared_album_activity_read" on public.shared_album_activity
  for select using (album_id in (select public.my_album_ids()));

create policy "shared_album_activity_insert" on public.shared_album_activity
  for insert with check (album_id in (select public.my_album_ids()));

-- --- invitations --- (0010's can_share() gate preserved on the write side)
create policy "shared_album_invitations_read" on public.shared_album_invitations
  for select using (album_id in (select public.my_album_ids()));

create policy "shared_album_invitations_write" on public.shared_album_invitations
  for all using (album_id in (select public.my_album_ids()))
  with check (
    album_id in (select public.my_album_ids())
    and public.can_share((select auth.uid()))
  );

-- ===========================================================================
-- 5. BLOCK ENFORCEMENT — copies of 0021's trigger bodies, bound to these
-- tables. `contact_blocked` and `user_id_for_email` (0021) are reused
-- verbatim and unmodified; they are entity-agnostic by construction.
-- ===========================================================================

create or replace function public.guard_album_member_not_blocked()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
begin
  -- No session means accept_album_invitation() running as its own definer,
  -- which does its own check below. This trigger guards the client's insert.
  if v_uid is null then
    return new;
  end if;

  v_target := coalesce(new.user_id, public.user_id_for_email(new.email));

  if v_target is null or v_target = v_uid then
    return new;
  end if;

  if public.contact_blocked(v_uid, v_target) then
    raise exception 'this person cannot be added to an album'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace function public.guard_album_invitation_not_blocked()
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

drop trigger if exists guard_album_member_not_blocked on public.shared_album_members;
create trigger guard_album_member_not_blocked
  before insert on public.shared_album_members
  for each row execute function public.guard_album_member_not_blocked();

drop trigger if exists guard_album_invitation_not_blocked on public.shared_album_invitations;
create trigger guard_album_invitation_not_blocked
  before insert on public.shared_album_invitations
  for each row execute function public.guard_album_invitation_not_blocked();

-- ===========================================================================
-- 6. DELETION GUARD — only an owner may retire (or restore) an album.
-- Same reasoning as guard_expense_group_deletion (0008): the update policy
-- must stay permissive for renames, so this narrows the one column that
-- is not every member's to touch.
-- ===========================================================================

create or replace function public.guard_shared_album_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is distinct from old.deleted_at
     and not public.is_shared_album_owner(new.id) then
    raise exception 'only the album owner can delete or restore this album'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists shared_albums_deletion_guard on public.shared_albums;
create trigger shared_albums_deletion_guard
  before update on public.shared_albums
  for each row execute function public.guard_shared_album_deletion();

-- ===========================================================================
-- 7. RPCs
-- ===========================================================================

-- Create an album and its first (owner) member row together — same
-- all-or-nothing reasoning as create_expense_group (0004): a creator who
-- never became a member could neither see nor delete their own album.
create or replace function public.create_shared_album(
  p_album_id text,
  p_name_ciphertext text,
  p_member_id text,
  p_display_name text,
  p_activity_id text,
  p_now bigint
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.shared_albums (id, name_ciphertext, created_by, created_at, updated_at)
  values (p_album_id, p_name_ciphertext, auth.uid(), p_now, p_now);

  insert into public.shared_album_members (
    id, album_id, user_id, email, display_name, role, joined_at, created_at, updated_at
  )
  select
    p_member_id, p_album_id, auth.uid(), p.email,
    coalesce(p_display_name, p.display_name, p.username), 'owner', p_now, p_now, p_now
  from public.profiles p
  where p.id = auth.uid();

  insert into public.shared_album_activity (
    id, album_id, actor_id, actor_name, action, meta, created_at
  ) values (
    p_activity_id, p_album_id, auth.uid(), public.current_actor_name(), 'album_created',
    '{}'::jsonb, p_now
  );

  return p_album_id;
end;
$$;

-- The token is minted client-side and kept out of the invitee's hands until
-- redeemed; RLS on shared_album_invitations_write already requires the caller
-- to be a member, so this only pairs the invite with its placeholder member.
create or replace function public.create_album_invitation(
  p_invitation_id text,
  p_album_id text,
  p_member_id text,
  p_email text,
  p_token text,
  p_expires_at bigint,
  p_now bigint
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.shared_album_invitations (
    id, album_id, member_id, email, token, invited_by, expires_at, created_at
  ) values (
    p_invitation_id, p_album_id, p_member_id, lower(p_email), p_token, auth.uid(), p_expires_at, p_now
  );
  return p_token;
end;
$$;

-- What an invitee may see BEFORE accepting AND before redeeming the
-- out-of-band key: a status, and nothing else. Unlike
-- peek_group_invitation, there is no album name to return — it is
-- ciphertext, and the invitee has no key yet at this point. The two humans
-- exchanging the invite already know which album it is; this just confirms
-- the link still works.
create or replace function public.peek_album_invitation(p_token text, p_now bigint)
returns table (status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.shared_album_invitations%rowtype;
begin
  select * into v_invite
    from public.shared_album_invitations
   where token = p_token;

  if v_invite.id is null then
    return query select 'invalid'::text;
  elsif v_invite.accepted_at is not null then
    return query select 'already_accepted'::text;
  elsif v_invite.expires_at < p_now then
    return query select 'expired'::text;
  else
    return query select 'ok'::text;
  end if;
end;
$$;

-- Redeeming one. MUST be SECURITY DEFINER — the invitee is by definition not
-- yet a member, so every policy above hides the album, the member row and the
-- invitation itself from them. Mirrors accept_group_invitation exactly,
-- including the 0021 block check, adapted to albums. Grants Postgres/RLS
-- membership only — the album key is a separate, out-of-band exchange this
-- function has no part in.
--
-- Returns album_id and member_id alongside the status — NOT a plaintext leak
-- (both are opaque ids, never the ciphertext name), and load-bearing: the
-- accept screen needs them to call `redeemAlbumInvite`/`confirm_album_key`
-- for the album it just joined, and a bare status string leaves it with
-- nothing to call those with.
create or replace function public.accept_album_invitation(p_token text, p_now bigint)
returns table (status text, album_id text, member_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.shared_album_invitations%rowtype;
  v_existing text;
begin
  if auth.uid() is null then
    return query select 'unauthenticated'::text, null::text, null::text;
    return;
  end if;

  select * into v_invite
    from public.shared_album_invitations
   where token = p_token;

  if v_invite.id is null then
    return query select 'invalid'::text, null::text, null::text;
    return;
  end if;
  if v_invite.accepted_at is not null then
    return query select 'already_accepted'::text, null::text, null::text;
    return;
  end if;
  if v_invite.expires_at < p_now then
    return query select 'expired'::text, null::text, null::text;
    return;
  end if;

  if v_invite.invited_by is not null
     and public.contact_blocked(auth.uid(), v_invite.invited_by) then
    return query select 'blocked'::text, null::text, null::text;
    return;
  end if;

  -- Table-qualified: `returns table (status, album_id, member_id)` makes
  -- `album_id`/`member_id` implicit PL/pgSQL variables in this function's
  -- scope, so a bare `album_id` below would be ambiguous against the column
  -- of the same name on shared_album_members.
  select m.id into v_existing
    from public.shared_album_members m
   where m.album_id = v_invite.album_id
     and m.user_id = auth.uid()
     and m.deleted_at is null;

  if v_existing is not null then
    update public.shared_album_invitations
       set accepted_at = p_now, accepted_by = auth.uid()
     where id = v_invite.id;
    return query select 'already_member'::text, v_invite.album_id, v_existing;
    return;
  end if;

  update public.shared_album_members
     set user_id = auth.uid(),
         joined_at = p_now,
         updated_at = p_now
   where id = v_invite.member_id
     and user_id is null
     and deleted_at is null;

  if not found then
    return query select 'member_unavailable'::text, null::text, null::text;
    return;
  end if;

  update public.shared_album_invitations
     set accepted_at = p_now, accepted_by = auth.uid()
   where id = v_invite.id;

  insert into public.shared_album_activity (
    id, album_id, actor_id, actor_name, action, meta, created_at
  ) values (
    v_invite.id || ':joined', v_invite.album_id, auth.uid(),
    public.current_actor_name(), 'member_joined',
    jsonb_build_object('email', v_invite.email), p_now
  );

  return query select 'ok'::text, v_invite.album_id, v_invite.member_id;
end;
$$;

-- The receiving device calls this after — and only after — it has redeemed
-- the out-of-band key transfer and wrapped the result locally. Never touches
-- or transmits key material; see the header for why this is a UX hint, not a
-- gate, and is therefore fine to scope to the caller's own row without
-- further ceremony.
create or replace function public.confirm_album_key(p_member_id text, p_now bigint)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.shared_album_members
     set key_confirmed_at = p_now
   where id = p_member_id
     and user_id = (select auth.uid());
$$;

-- Remove a member (owner), or leave (yourself). Tombstone, never a delete —
-- same reasoning as remove_group_member (0008), minus the ledger-integrity
-- half of that reasoning (there is no money here): a removed member's added
-- photos and activity entries stay attributable rather than orphaned.
create or replace function public.remove_album_member(
  p_member_id text,
  p_activity_id text,
  p_now bigint
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_album_id text;
  v_user_id uuid;
  v_role text;
  v_name text;
  v_self boolean;
begin
  select album_id, user_id, role, coalesce(display_name, email)
    into v_album_id, v_user_id, v_role, v_name
    from public.shared_album_members
   where id = p_member_id
     and deleted_at is null;

  if v_album_id is null then
    raise exception 'no such member' using errcode = 'P0002';
  end if;

  v_self := v_user_id is not distinct from auth.uid();

  if v_role = 'owner' then
    raise exception 'the album owner cannot be removed' using errcode = 'P0001';
  end if;

  if not v_self and not public.is_shared_album_owner(v_album_id) then
    raise exception 'only the album owner can remove other members'
      using errcode = '42501';
  end if;

  -- Written before the tombstone: leaving removes your own membership, and
  -- the activity insert policy needs you to still have it.
  insert into public.shared_album_activity (
    id, album_id, actor_id, actor_name, action, meta, created_at
  ) values (
    p_activity_id, v_album_id, auth.uid(), public.current_actor_name(),
    case when v_self then 'member_left' else 'member_removed' end,
    jsonb_build_object('name', v_name), p_now
  );

  update public.shared_album_members
     set deleted_at = p_now, updated_at = p_now
   where id = p_member_id;
end;
$$;

-- Retire an album. Soft, so the activity trail and remaining members'
-- history survive — an album is not the deleter's alone to destroy, even
-- though (unlike an expense group) there is no balance depending on it.
create or replace function public.delete_shared_album(
  p_album_id text,
  p_activity_id text,
  p_now bigint
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_shared_album_owner(p_album_id) then
    raise exception 'only the album owner can delete this album'
      using errcode = '42501';
  end if;

  insert into public.shared_album_activity (
    id, album_id, actor_id, actor_name, action, meta, created_at
  ) values (
    p_activity_id, p_album_id, auth.uid(), public.current_actor_name(),
    'album_deleted', '{}'::jsonb, p_now
  );

  update public.shared_albums
     set deleted_at = p_now, updated_at = p_now
   where id = p_album_id
     and deleted_at is null;
end;
$$;

revoke all on function public.create_shared_album(text, text, text, text, text, bigint) from public, anon;
revoke all on function public.create_album_invitation(text, text, text, text, text, bigint, bigint) from public, anon;
revoke all on function public.accept_album_invitation(text, bigint) from public, anon;
revoke all on function public.peek_album_invitation(text, bigint) from public, anon;
revoke all on function public.confirm_album_key(text, bigint) from public, anon;
revoke all on function public.remove_album_member(text, text, bigint) from public, anon;
revoke all on function public.delete_shared_album(text, text, bigint) from public, anon;

grant execute on function public.create_shared_album(text, text, text, text, text, bigint) to authenticated;
grant execute on function public.create_album_invitation(text, text, text, text, text, bigint, bigint) to authenticated;
grant execute on function public.accept_album_invitation(text, bigint) to authenticated;
-- Peeking is allowed before sign-in, same as peek_group_invitation, so the
-- accept screen can confirm the link still works before asking for a session.
grant execute on function public.peek_album_invitation(text, bigint) to authenticated, anon;
grant execute on function public.confirm_album_key(text, bigint) to authenticated;
grant execute on function public.remove_album_member(text, text, bigint) to authenticated;
grant execute on function public.delete_shared_album(text, text, bigint) to authenticated;
