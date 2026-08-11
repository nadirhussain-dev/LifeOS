-- 0033 — A real "owner", and managing the operator roster from the app.
--
-- Two things `admins` (0010) never had, formalised here.
--
-- First, a single owner. 0018's own header already assumed one: "existing
-- rows default to 'admin'. There is exactly one of them (the owner)" — but
-- nothing enforced that or gave the row any standing beyond the ordinary
-- 'admin' tier. `is_owner` plus a partial unique index makes "at most one"
-- a constraint the database holds, not a convention a migration author
-- remembered.
--
-- Second, in-app roster management. `admins` and `admin_allowed_origins`
-- (0014) have deliberately carried zero API policies since 0010 — "invisible
-- to every client, including its members... managed from the SQL editor" —
-- specifically so a stolen operator session could never grow the roster.
-- This migration trades that away, on purpose, for the convenience of
-- managing operators without database access: every mutation below is
-- owner-only (`is_owner()`, never merely `is_admin()`), so the worst a
-- compromised non-owner admin session can do is nothing to the roster at
-- all, and the worst a compromised OWNER session can do is what a compromised
-- owner session could always do. `admin_allowed_origins` keeps its "SQL
-- editor only" posture unchanged — this migration does not touch it.
--
-- The owner is bootstrapped by `claim_owner()`, callable by anyone
-- authenticated, but it only ever succeeds once: the moment one row exists
-- in `admins`, every future call — from anyone — fails. That single
-- condition (`not exists (select 1 from admins)`) is the entire safety
-- property; there is no separate flag to keep in sync with it.

-- ===========================================================================
-- 1. THE OWNER
-- ===========================================================================

alter table public.admins
  add column if not exists is_owner boolean not null default false;

-- All rows with is_owner = true collide on that value, so "unique" over just
-- this column, filtered to true rows, is exactly "at most one true" — the
-- same trick used nowhere else in this schema because nothing else has
-- needed a hard singleton before.
create unique index if not exists admins_single_owner_idx
  on public.admins (is_owner)
  where is_owner;

create or replace function public.is_owner()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;
  if not exists (
    select 1 from public.admins a where a.user_id = v_uid and a.is_owner
  ) then
    return false;
  end if;
  return public.admin_origin_allowed(v_uid);
end;
$$;

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- Whether the app has been set up yet. Deliberately public (even to `anon`):
-- it answers nothing more sensitive than "has anyone claimed this app", which
-- is exactly what a first-run screen needs to decide whether to render a
-- claim button, before that account necessarily has a session capable of
-- passing `admin_origin_allowed`.
create or replace function public.admin_has_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins);
$$;

grant execute on function public.admin_has_owner() to authenticated, anon;

-- The bootstrap. Self-disabling: the guard is "does any row exist", not a
-- flag this function sets and could disagree with, so there is no window
-- where the table is non-empty and this still succeeds.
create or replace function public.claim_owner()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;

  if exists (select 1 from public.admins) then
    raise exception 'this app already has an owner' using errcode = 'unique_violation';
  end if;

  insert into public.admins (user_id, note, role, is_owner)
  values (auth.uid(), 'owner (self-claimed via claim_owner())', 'admin', true);

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'claim_owner', auth.uid(), '{}'::jsonb);
end;
$$;

revoke all on function public.claim_owner() from public, anon;
grant execute on function public.claim_owner() to authenticated;

-- ===========================================================================
-- 2. ROSTER MANAGEMENT — owner-only, audited, never able to mint a second
-- owner or touch the first one.
-- ===========================================================================

create or replace function public.admin_add_operator(p_email text, p_role public.operator_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
begin
  if not public.is_owner() then
    raise exception 'only the owner can manage operators' using errcode = 'insufficient_privilege';
  end if;

  v_target := public.user_id_for_email(p_email);
  if v_target is null then
    raise exception 'no account with that email' using errcode = 'no_data_found';
  end if;

  if exists (select 1 from public.admins where user_id = v_target and is_owner) then
    raise exception 'the owner’s role cannot be changed this way' using errcode = 'insufficient_privilege';
  end if;

  -- is_owner is never set here — the only path to a true value is
  -- claim_owner(), and that path is already closed the moment this table has
  -- its first row.
  insert into public.admins (user_id, note, role, is_owner)
  values (v_target, 'added via admin_add_operator()', p_role, false)
  on conflict (user_id) do update set role = excluded.role;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'add_operator', v_target, jsonb_build_object('role', p_role));
end;
$$;

create or replace function public.admin_set_operator_role(p_user_id uuid, p_role public.operator_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'only the owner can manage operators' using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.admins where user_id = p_user_id and is_owner) then
    raise exception 'the owner’s role cannot be changed this way' using errcode = 'insufficient_privilege';
  end if;

  update public.admins set role = p_role where user_id = p_user_id;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'set_operator_role', p_user_id, jsonb_build_object('role', p_role));
end;
$$;

create or replace function public.admin_remove_operator(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'only the owner can manage operators' using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.admins where user_id = p_user_id and is_owner) then
    raise exception 'the owner cannot be removed' using errcode = 'insufficient_privilege';
  end if;

  delete from public.admins where user_id = p_user_id;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'remove_operator', p_user_id, '{}'::jsonb);
end;
$$;

-- Any operator may see the roster — knowing who else is on the team is not
-- the sensitive part, changing it is. `#variable_conflict use_column`
-- disambiguates the OUT parameters from the columns they select (0012's
-- admin_list_users already needs this for the same reason).
create or replace function public.admin_list_operators()
returns table (
  user_id uuid,
  email text,
  display_name text,
  role public.operator_role,
  is_owner boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_staff() then
    raise exception 'not an operator' using errcode = 'insufficient_privilege';
  end if;

  return query
    select a.user_id, p.email, p.display_name, a.role, a.is_owner, a.created_at
      from public.admins a
      left join public.profiles p on p.id = a.user_id
     order by a.is_owner desc, a.created_at;
end;
$$;

revoke all on function public.admin_add_operator(text, public.operator_role) from public, anon;
revoke all on function public.admin_set_operator_role(uuid, public.operator_role) from public, anon;
revoke all on function public.admin_remove_operator(uuid) from public, anon;
revoke all on function public.admin_list_operators() from public, anon;
grant execute on function public.admin_add_operator(text, public.operator_role) to authenticated;
grant execute on function public.admin_set_operator_role(uuid, public.operator_role) to authenticated;
grant execute on function public.admin_remove_operator(uuid) to authenticated;
grant execute on function public.admin_list_operators() to authenticated;
