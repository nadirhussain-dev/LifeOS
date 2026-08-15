-- ---------------------------------------------------------------------------
-- 0010 — Operator surface: usage rollups, account standing, moderation.
--
-- Two jobs that share one shape: both are things the *operator* needs to see or
-- do, and neither may become a way to read a user's content.
--
--  1. Usage. Not an event firehose — a daily rollup of (user, day, module) with
--     two counters. That answers "how many active users" and "which modules do
--     they actually use" while being physically incapable of answering "what did
--     they write". Guests never sign in, so they would be invisible to a
--     user-keyed table; `anon_activity_daily` counts installs instead, keyed by
--     a client-generated id that is joinable to nothing.
--
--  2. Standing. `account_status` is the single verdict on an account, written
--     either by a human (`auto = false`) or by a rate rule (`auto = true`, and
--     then always with an expiry). Enforcement is in RLS rather than the client,
--     because the client is not the only thing holding an anon key.
--
--     The ladder is deliberate:
--       active     — everything
--       throttled  — advisory; the rate limiter already slowed them down
--       restricted — cannot create groups, add members, or invite. Personal
--                    data still syncs: restricting somebody is not a reason to
--                    take their own journal away from them.
--       blocked    — same, plus the app refuses to open the signed-in surface.
--                    A hard block should ALSO ban the account in GoTrue
--                    (auth.admin.updateUserById with ban_duration), which
--                    invalidates the JWT itself; this table is the record and
--                    the defence in depth, not the whole mechanism.
--
-- Nothing here reads or references any user content table.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. TABLES
--
-- All of them first, before any function: a LANGUAGE SQL body is parsed at
-- CREATE time, so a helper defined above the table it reads aborts the
-- migration (see scripts/check-migrations.mjs).
-- ===========================================================================

-- --- usage: one row per account per day per module -------------------------
create table if not exists public.usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  -- Module id from features/hub/config/modules.ts. Deliberately untyped: a new
  -- module must not need a migration to start reporting.
  module text not null,
  opens integer not null default 0,
  writes integer not null default 0,
  updated_at bigint not null,
  primary key (user_id, day, module)
);

create index if not exists usage_daily_day_idx on public.usage_daily (day);

alter table public.usage_daily enable row level security;

-- Readable by its owner — there is nothing here they don't already know, and
-- being able to see it is the honest counterpart to collecting it. Writes go
-- only through record_usage(), which is what makes the counters monotonic.
create policy "usage_daily_read_own" on public.usage_daily
  for select using (user_id = auth.uid());

-- --- usage: signed-out installs --------------------------------------------
-- Guest mode is a first-class way to use Daykeep, so a user-keyed table alone
-- would under-report actives by however many people never make an account.
-- `install_id` is a random UUID in SecureStore: stable per install, meaningless
-- off-device, and never joined to a uid.
create table if not exists public.anon_activity_daily (
  install_id text not null,
  day date not null,
  platform text not null check (platform in ('ios', 'android', 'web')),
  app_version text,
  primary key (install_id, day)
);

create index if not exists anon_activity_daily_day_idx on public.anon_activity_daily (day);

alter table public.anon_activity_daily enable row level security;
-- No policy, on purpose: RLS with zero policies denies everything. The only
-- door is record_anon_activity() below.

-- --- standing --------------------------------------------------------------
do $do$ begin
  if not exists (select 1 from pg_type where typname = 'moderation_status') then
    -- Not named `account_status`: a table of that name already occupies the
    -- name in pg_type (every table has a composite type), and the two collide.
    create type public.moderation_status as enum ('active', 'throttled', 'restricted', 'blocked');
  end if;
end $do$;

create table if not exists public.account_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status public.moderation_status not null default 'active',
  reason text,
  -- True when a rate rule wrote this row rather than a person. Automatic
  -- actions always carry an expiry; a human decision is never overwritten by a
  -- rule, in either direction — see note_abuse_action().
  auto boolean not null default false,
  expires_at timestamptz,
  actor uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_status enable row level security;

-- You may read your own standing — the app shows the reason and the expiry on
-- the blocked screen, and "you have been restricted, we won't say why" is not a
-- product. Nobody may write it from a client.
create policy "account_status_read_own" on public.account_status
  for select using (user_id = auth.uid());

-- --- who may moderate ------------------------------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
-- No policy: the roster is invisible to every client, including its members.
-- Seed it from the SQL editor, where the service role bypasses RLS:
--   insert into public.admins (user_id, note) values ('<your-uuid>', 'owner');

-- --- what was done, by whom ------------------------------------------------
create table if not exists public.admin_audit_log (
  id bigserial primary key,
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  target_user uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;
-- No policy. Append-only from admin_set_account_status(); read it with the
-- service role. A moderation log a moderator can edit is not a log.

-- --- rate counters ---------------------------------------------------------
create table if not exists public.abuse_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  -- Epoch-ms floored to the window size, so counting is one upsert against a
  -- fixed bucket — no scan, and stale buckets simply stop being written to.
  window_start bigint not null,
  count integer not null default 0,
  primary key (user_id, action, window_start)
);

alter table public.abuse_counters enable row level security;
-- No policy: bookkeeping, invisible to clients.

-- ===========================================================================
-- 2. FUNCTIONS
-- ===========================================================================

-- --- predicates ------------------------------------------------------------

-- SECURITY DEFINER because `admins` has no policy: under the caller's own
-- rights this question is unanswerable. Returns only a boolean.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

-- `blocked` only. Used where the question is "may this account touch the server
-- at all", as opposed to can_share() below.
create or replace function public.is_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.account_status s
     where s.user_id = p_user_id
       and s.status = 'blocked'
       and (s.expires_at is null or s.expires_at > now())
  );
$$;

-- The predicate that actually guards the shared surfaces. Note it answers true
-- for `throttled`: throttling is the rate limiter's own doing and does not need
-- a second, blunter enforcement in RLS.
create or replace function public.can_share(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null and not exists (
    select 1 from public.account_status s
     where s.user_id = p_user_id
       and s.status in ('restricted', 'blocked')
       and (s.expires_at is null or s.expires_at > now())
  );
$$;

-- --- recording usage -------------------------------------------------------

-- Takes a batch — the client accumulates counters in memory and flushes on
-- background, so a session is one round trip rather than one per tap.
--
-- DEFINER because the increment has to happen server-side: `opens = opens + n`
-- is not expressible through PostgREST's upsert, and a client that could write
-- the column outright could also write it downwards.
create or replace function public.record_usage(p_entries jsonb, p_now bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  insert into public.usage_daily (user_id, day, module, opens, writes, updated_at)
  select v_uid,
         (e ->> 'day')::date,
         left(e ->> 'module', 64),
         -- Clamped: a counter is a hint about behaviour, and one bad client
         -- should not be able to move a chart by six orders of magnitude.
         least(greatest(coalesce((e ->> 'opens')::integer, 0), 0), 10000),
         least(greatest(coalesce((e ->> 'writes')::integer, 0), 0), 10000),
         p_now
    from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e
   where e ->> 'module' is not null
     and e ->> 'day' is not null
     -- Only the last week, so a device with a wrong clock cannot write history.
     and (e ->> 'day')::date between current_date - 7 and current_date + 1
  on conflict (user_id, day, module) do update
    set opens = usage_daily.opens + excluded.opens,
        writes = usage_daily.writes + excluded.writes,
        updated_at = excluded.updated_at;
end;
$$;

-- The signed-out counterpart. `day` is the SERVER's date, not the client's:
-- one less parameter to lie about, and it makes the daily counts consistent
-- across time zones.
--
-- Honest limitation: this is callable with nothing but the anon key, so the
-- table can be padded by anyone willing to mint UUIDs. The id shape check is
-- the only brake available at this layer. If the numbers ever start mattering
-- commercially, move this behind an edge function with per-IP limiting.
create or replace function public.record_anon_activity(
  p_install_id text,
  p_platform text,
  p_app_version text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_install_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid install id' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.anon_activity_daily (install_id, day, platform, app_version)
  values (
    p_install_id,
    current_date,
    p_platform,
    nullif(left(coalesce(p_app_version, ''), 32), '')
  )
  on conflict (install_id, day) do update
    set platform = excluded.platform,
        app_version = excluded.app_version;
end;
$$;

-- --- rate limiting ---------------------------------------------------------

-- Counts one action into its bucket and returns whether the account is still
-- within the limit. Crossing it writes a 24h automatic restriction.
--
-- Never callable from a client: it is invoked by the triggers below, which run
-- as the definer and so have the rights this needs.
create or replace function public.note_abuse_action(
  p_user_id uuid,
  p_action text,
  p_limit integer,
  p_window_ms bigint,
  p_now bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket bigint := (p_now / p_window_ms) * p_window_ms;
  v_count integer;
begin
  insert into public.abuse_counters (user_id, action, window_start, count)
  values (p_user_id, p_action, v_bucket, 1)
  on conflict (user_id, action, window_start) do update
    set count = abuse_counters.count + 1
  returning count into v_count;

  if v_count <= p_limit then
    return true;
  end if;

  -- Over the limit. Restrict — temporarily, and only if no human has ruled on
  -- this account. The `where account_status.auto` on the DO UPDATE is what
  -- makes a manual verdict (including a deliberate "this account is fine")
  -- immune to being re-decided by a rule three minutes later.
  insert into public.account_status (user_id, status, reason, auto, expires_at, updated_at)
  values (
    p_user_id,
    'restricted',
    format('automatic: %s %s in %s ms (limit %s)', v_count, p_action, p_window_ms, p_limit),
    true,
    now() + interval '24 hours',
    now()
  )
  on conflict (user_id) do update
    set status = 'restricted',
        reason = excluded.reason,
        expires_at = excluded.expires_at,
        updated_at = now()
    where account_status.auto;

  return false;
end;
$$;

-- Limits live in the trigger functions rather than a config table: they are
-- read on every insert, they change about once a year, and a table would make
-- them one more thing that can be wrong at 3am.
--
-- Neither trigger raises, and that is the important part. Aborting the
-- offending insert would roll back note_abuse_action()'s own writes along with
-- it — the counter and the restriction are in the same transaction as the
-- exception — so the rule would fire forever and never once persist a verdict.
-- Recording and returning lets the restriction commit; can_share() then refuses
-- the NEXT attempt. The cost is one action over the threshold, which for a
-- 20-per-hour limit is not a cost.
create or replace function public.guard_invitation_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- No session: accept_group_invitation() and the like run as the definer with
  -- their own authority, and are not what this guards.
  if v_uid is null then
    return new;
  end if;

  perform public.note_abuse_action(
    v_uid, 'invitation_created', 20, 3600000, (extract(epoch from now()) * 1000)::bigint
  );
  return new;
end;
$$;

create or replace function public.guard_group_creation_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return new;
  end if;

  perform public.note_abuse_action(
    v_uid, 'group_created', 10, 86400000, (extract(epoch from now()) * 1000)::bigint
  );
  return new;
end;
$$;

-- --- operator surface ------------------------------------------------------

create or replace function public.admin_set_account_status(
  p_user_id uuid,
  p_status public.moderation_status,
  p_reason text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  insert into public.account_status (user_id, status, reason, auto, expires_at, actor, updated_at)
  values (p_user_id, p_status, p_reason, false, p_expires_at, auth.uid(), now())
  on conflict (user_id) do update
    set status = excluded.status,
        reason = excluded.reason,
        -- A human has now ruled on this account; rules stop overriding it.
        auto = false,
        expires_at = excluded.expires_at,
        actor = excluded.actor,
        updated_at = now();

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (
    auth.uid(),
    'set_account_status',
    p_user_id,
    jsonb_build_object('status', p_status, 'reason', p_reason, 'expires_at', p_expires_at)
  );
end;
$$;

-- Active accounts per day, both halves of the population. Signed-in and
-- signed-out are returned separately rather than summed: they are not the same
-- unit (one is an account, one is an install) and adding them would invent a
-- number that means nothing.
create or replace function public.admin_active_users(p_from date, p_to date)
returns table (day date, accounts bigint, installs bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
    select d::date,
           (select count(distinct u.user_id) from public.usage_daily u where u.day = d::date),
           (select count(*) from public.anon_activity_daily a where a.day = d::date)
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d;
end;
$$;

-- Which modules people actually use. `accounts` is the reach question ("how
-- many people touched Habits at all"); the counters are the intensity one.
create or replace function public.admin_module_reach(p_from date, p_to date)
returns table (module text, accounts bigint, opens bigint, writes bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
-- The OUT parameter `module` shadows usage_daily.module; resolve such names to
-- the column, which is what every reference below means.
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
    select u.module,
           count(distinct u.user_id),
           coalesce(sum(u.opens), 0)::bigint,
           coalesce(sum(u.writes), 0)::bigint
      from public.usage_daily u
     where u.day between p_from and p_to
     group by u.module
     order by 2 desc, 1 asc;
end;
$$;

-- ===========================================================================
-- 3. GRANTS
-- ===========================================================================

revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_active(uuid) from public, anon;
revoke all on function public.can_share(uuid) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active(uuid) to authenticated;
grant execute on function public.can_share(uuid) to authenticated;

revoke all on function public.record_usage(jsonb, bigint) from public, anon;
grant execute on function public.record_usage(jsonb, bigint) to authenticated;

-- The one function anon may call: a guest has no session by definition.
revoke all on function public.record_anon_activity(text, text, text) from public;
grant execute on function public.record_anon_activity(text, text, text) to anon, authenticated;

-- Bookkeeping and enforcement — reachable only from the triggers, which run as
-- the definer and do not need a grant to do so.
revoke all on function public.note_abuse_action(uuid, text, integer, bigint, bigint)
  from public, anon, authenticated;

revoke all on function public.admin_set_account_status(uuid, public.moderation_status, text, timestamptz)
  from public, anon;
revoke all on function public.admin_active_users(date, date) from public, anon;
revoke all on function public.admin_module_reach(date, date) from public, anon;
grant execute on function public.admin_set_account_status(uuid, public.moderation_status, text, timestamptz)
  to authenticated;
grant execute on function public.admin_active_users(date, date) to authenticated;
grant execute on function public.admin_module_reach(date, date) to authenticated;

-- ===========================================================================
-- 4. ENFORCEMENT
--
-- Replaces three policies from 0003 to add can_share(). Reads are untouched: a
-- restricted account keeps full access to groups it is already in, and to every
-- expense in them. What it loses is the ability to create new outbound reach —
-- which is the only thing being abused.
-- ===========================================================================

drop policy if exists "expense_groups_insert" on public.expense_groups;
create policy "expense_groups_insert" on public.expense_groups
  for insert with check (created_by = auth.uid() and public.can_share(auth.uid()));

drop policy if exists "expense_group_members_insert" on public.expense_group_members;
create policy "expense_group_members_insert" on public.expense_group_members
  for insert with check (
    public.can_share(auth.uid())
    and (
      public.is_expense_group_member(group_id)
      or public.is_expense_group_creator(group_id)
    )
  );

drop policy if exists "expense_group_invitations_write" on public.expense_group_invitations;
create policy "expense_group_invitations_write" on public.expense_group_invitations
  for all using (public.is_expense_group_member(group_id))
  with check (
    public.is_expense_group_member(group_id)
    and public.can_share(auth.uid())
  );

-- Rate rules hang off the tables rather than the RPCs that write them, so they
-- cannot be sidestepped by reaching the table another way — and so the RPC
-- bodies in 0004/0005/0007 stay where they are, undisturbed.
drop trigger if exists guard_invitation_rate on public.expense_group_invitations;
create trigger guard_invitation_rate
  before insert on public.expense_group_invitations
  for each row execute function public.guard_invitation_rate();

drop trigger if exists guard_group_creation_rate on public.expense_groups;
create trigger guard_group_creation_rate
  before insert on public.expense_groups
  for each row execute function public.guard_group_creation_rate();
