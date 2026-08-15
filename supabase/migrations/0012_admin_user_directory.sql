-- ---------------------------------------------------------------------------
-- 0012 — Admin user directory.
--
-- The operator's view of who is using Daykeep: a searchable list of accounts and
-- a per-account drill-down, so a support mail or an abuse report can be
-- answered without opening a SQL console and joining six tables by hand.
--
-- What this deliberately does and does not expose
-- -----------------------------------------------
-- Everything here is *account* data: identity, when they joined, when they were
-- last active, which modules they use, how much reach they have (groups,
-- invitations, devices), and their moderation standing. That is the information
-- an abuse decision is actually made from.
--
-- No user *content* appears anywhere in this file. Not a task title, not a
-- journal line, not an expense description. This is not an oversight to be
-- corrected later — for the private modules it is not even possible, because
-- their keys never leave the user's device (features/private/services/
-- vault-keys.ts), and for everything else the reason is that reading somebody's
-- journal has never been how you catch a spammer. Rate signals do that, and
-- they are all here.
--
-- Every profile opened is logged
-- ------------------------------
-- `admin_user_detail` writes an audit row on each call. An operator with a
-- legitimate reason to look is unaffected; one browsing out of curiosity leaves
-- a trail. This is the check that makes broad read access safe to hold, and it
-- is why the function is the only way in rather than a view.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. DIRECTORY
-- ===========================================================================

-- One row per account, with the activity and reach signals joined on.
--
-- `security definer` and `is_admin()`-gated, because every table it reads is
-- protected by RLS scoped to the owning user — under the caller's own rights
-- the answer would always be "just you".
create or replace function public.admin_list_users(
  p_search text,
  p_limit integer,
  p_offset integer
)
returns table (
  user_id uuid,
  email text,
  username text,
  display_name text,
  created_at timestamptz,
  last_active date,
  status public.moderation_status,
  modules_used bigint,
  groups_joined bigint,
  devices bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
-- OUT parameter names collide with the columns they are selected from; resolve
-- such references to the column, which is what every one of them means.
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      p.id,
      p.email,
      p.username,
      p.display_name,
      -- profiles.created_at is epoch-ms (it mirrors the device schema); the
      -- rest of the operator surface speaks timestamptz.
      to_timestamp(coalesce(p.created_at, 0) / 1000.0),
      (select max(u.day) from public.usage_daily u where u.user_id = p.id),
      coalesce(
        (select s.status from public.account_status s where s.user_id = p.id),
        'active'::public.moderation_status
      ),
      (select count(distinct u.module) from public.usage_daily u where u.user_id = p.id),
      (select count(*) from public.expense_group_members m
        where m.user_id = p.id and m.deleted_at is null),
      (select count(*) from public.push_tokens t where t.user_id = p.id)
    from public.profiles p
    where
      p_search is null
      or length(trim(p_search)) = 0
      or p.email ilike '%' || trim(p_search) || '%'
      or p.username ilike '%' || trim(p_search) || '%'
      or p.display_name ilike '%' || trim(p_search) || '%'
      or p.id::text = trim(p_search)
    order by (select max(u.day) from public.usage_daily u where u.user_id = p.id) desc nulls last
    limit least(coalesce(p_limit, 50), 200)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ===========================================================================
-- 2. PROFILE DRILL-DOWN
-- ===========================================================================

-- Everything known about one account, and an audit row recording that it was
-- looked at.
--
-- Not `stable`: it writes the audit entry, which is the point.
create or replace function public.admin_user_detail(p_user_id uuid)
returns table (
  user_id uuid,
  email text,
  username text,
  display_name text,
  created_at timestamptz,
  last_active date,
  status public.moderation_status,
  status_reason text,
  status_expires_at timestamptz,
  status_auto boolean,
  groups_joined bigint,
  groups_owned bigint,
  invitations_sent bigint,
  devices bigint,
  -- Rate-limit counters over the last 24h: the numbers an abuse decision is
  -- actually made from.
  recent_actions jsonb,
  total_opens bigint,
  total_writes bigint
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'view_user_detail', p_user_id, '{}'::jsonb);

  return query
    select
      p.id,
      p.email,
      p.username,
      p.display_name,
      to_timestamp(coalesce(p.created_at, 0) / 1000.0),
      (select max(u.day) from public.usage_daily u where u.user_id = p.id),
      coalesce(
        (select s.status from public.account_status s where s.user_id = p.id),
        'active'::public.moderation_status
      ),
      (select s.reason from public.account_status s where s.user_id = p.id),
      (select s.expires_at from public.account_status s where s.user_id = p.id),
      coalesce((select s.auto from public.account_status s where s.user_id = p.id), false),
      (select count(*) from public.expense_group_members m
        where m.user_id = p.id and m.deleted_at is null),
      (select count(*) from public.expense_group_members m
        where m.user_id = p.id and m.role = 'owner' and m.deleted_at is null),
      (select count(*) from public.expense_group_invitations i where i.invited_by = p.id),
      (select count(*) from public.push_tokens t where t.user_id = p.id),
      coalesce(
        (select jsonb_object_agg(c.action, c.total)
           from (
             select a.action, sum(a.count) as total
               from public.abuse_counters a
              where a.user_id = p.id
                and a.window_start > (extract(epoch from now()) * 1000)::bigint - 86400000
              group by a.action
           ) c),
        '{}'::jsonb
      ),
      coalesce((select sum(u.opens) from public.usage_daily u where u.user_id = p.id), 0)::bigint,
      coalesce((select sum(u.writes) from public.usage_daily u where u.user_id = p.id), 0)::bigint
    from public.profiles p
    where p.id = p_user_id;
end;
$$;

-- Per-module activity for one account, for the drill-down's chart. Counts only
-- — the module id and how often, never what was written in it.
create or replace function public.admin_user_module_usage(
  p_user_id uuid,
  p_from date,
  p_to date
)
returns table (module text, opens bigint, writes bigint, days_active bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
    select u.module,
           coalesce(sum(u.opens), 0)::bigint,
           coalesce(sum(u.writes), 0)::bigint,
           count(distinct u.day)::bigint
      from public.usage_daily u
     where u.user_id = p_user_id
       and u.day between p_from and p_to
     group by u.module
     order by 2 desc, 1 asc;
end;
$$;

-- ===========================================================================
-- 3. GRANTS
-- ===========================================================================

revoke all on function public.admin_list_users(text, integer, integer) from public, anon;
revoke all on function public.admin_user_detail(uuid) from public, anon;
revoke all on function public.admin_user_module_usage(uuid, date, date) from public, anon;
grant execute on function public.admin_list_users(text, integer, integer) to authenticated;
grant execute on function public.admin_user_detail(uuid) to authenticated;
grant execute on function public.admin_user_module_usage(uuid, date, date) to authenticated;
