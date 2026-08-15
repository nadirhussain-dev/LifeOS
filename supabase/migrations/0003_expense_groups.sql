-- ---------------------------------------------------------------------------
-- Shared expense groups (split expenses with friends / colleagues / family)
--
-- This is the first *shared* data in Daykeep. Every table in 0001 is governed by
-- a `*_own` policy (user_id = auth.uid()), so a row belongs to exactly one
-- person. A split group is the opposite: many people read and write the same
-- rows, and access is decided by membership rather than ownership.
--
-- Conventions follow 0001 so the sync engine sees a familiar shape: text ids
-- generated client-side (local-first), bigint epoch-ms timestamps, money in
-- integer cents, and soft deletes via deleted_at.
--
-- Two columns from 0001 are deliberately absent: sync_status and
-- server_updated_at. Those are per-device bookkeeping about *your* copy of a
-- row you own; on a row shared by five people they are meaningless and would be
-- clobbered by whoever synced last. Shared tables need their own sync path.
--
-- File order matters: LANGUAGE SQL bodies are parsed and validated at CREATE
-- time, so every table must exist before the helper functions that read them,
-- and the helpers must exist before the policies that call them. Tables →
-- indexes → helpers → RLS → triggers.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. TABLES
-- ===========================================================================

create table if not exists public.expense_groups (
  id text primary key,
  name text not null,
  -- Free-form grouping the UI offers as chips: trip / home / family / work.
  kind text not null default 'other',
  -- Groups settle in one currency; mixing them needs FX rates, out of scope.
  currency text not null default 'USD',
  created_by uuid references auth.users(id) on delete set null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

-- A member may exist before they have an account: you add somebody by email,
-- they can be split with immediately, and user_id is filled in when they accept
-- the invitation. Hence nullable user_id, with email carrying identity until then.
create table if not exists public.expense_group_members (
  id text primary key,
  group_id text not null references public.expense_groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  display_name text,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  constraint expense_group_members_identified check (user_id is not null or email is not null)
);

create table if not exists public.expense_group_expenses (
  id text primary key,
  group_id text not null references public.expense_groups(id) on delete cascade,
  -- Who actually paid. A member, not a user, so an invitee who hasn't joined
  -- yet can still have footed the bill.
  paid_by_member_id text not null references public.expense_group_members(id) on delete restrict,
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'USD',
  spent_at bigint not null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

-- The ledger balances are derived from. One row per member per expense holding
-- that member's slice in whole cents. Nothing stores a running balance: totals
-- are summed from here, so the log and the numbers can never disagree and an
-- edit cannot leave a stale balance behind. Splitting 10.00 three ways is
-- 333/333/334, which is why the split is materialised in cents rather than
-- recomputed from a percentage on read.
create table if not exists public.expense_group_shares (
  id text primary key,
  expense_id text not null references public.expense_group_expenses(id) on delete cascade,
  member_id text not null references public.expense_group_members(id) on delete restrict,
  share_cents bigint not null check (share_cents >= 0),
  created_at bigint not null,
  updated_at bigint not null,
  unique (expense_id, member_id)
);

-- "I paid you back" — moves the balance without being an expense.
create table if not exists public.expense_group_settlements (
  id text primary key,
  group_id text not null references public.expense_groups(id) on delete cascade,
  from_member_id text not null references public.expense_group_members(id) on delete restrict,
  to_member_id text not null references public.expense_group_members(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'USD',
  settled_at bigint not null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  constraint expense_group_settlements_distinct check (from_member_id <> to_member_id)
);

-- Who did what: the group feed, and accountability now that any member may edit
-- any expense.
create table if not exists public.expense_group_activity (
  id text primary key,
  group_id text not null references public.expense_groups(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,          -- denormalised so history survives account deletion
  action text not null check (action in (
    'group_created', 'member_added', 'member_joined', 'member_left',
    'expense_added', 'expense_edited', 'expense_deleted',
    'settlement_added', 'settlement_deleted'
  )),
  expense_id text references public.expense_group_expenses(id) on delete set null,
  settlement_id text references public.expense_group_settlements(id) on delete set null,
  -- Amounts/descriptions as they were at the time, so an entry still reads
  -- correctly after the underlying row is edited or removed.
  meta jsonb,
  created_at bigint not null
);

-- How somebody without an account gets in. Lookup by token happens in a
-- SECURITY DEFINER function (phase 4): the invitee is by definition not yet a
-- member and so cannot read this table under its own policy.
create table if not exists public.expense_group_invitations (
  id text primary key,
  group_id text not null references public.expense_groups(id) on delete cascade,
  member_id text references public.expense_group_members(id) on delete cascade,
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

-- One live membership per person per group. Partial so soft-deleted rows and
-- pending email-only rows don't collide.
create unique index if not exists expense_group_members_user_idx
  on public.expense_group_members (group_id, user_id)
  where user_id is not null and deleted_at is null;

create unique index if not exists expense_group_members_email_idx
  on public.expense_group_members (group_id, lower(email))
  where email is not null and deleted_at is null;

create index if not exists expense_group_members_group_idx
  on public.expense_group_members (group_id);
create index if not exists expense_group_members_user_lookup_idx
  on public.expense_group_members (user_id) where user_id is not null;

create index if not exists expense_group_expenses_group_idx
  on public.expense_group_expenses (group_id, spent_at desc);
create index if not exists expense_group_shares_expense_idx
  on public.expense_group_shares (expense_id);
create index if not exists expense_group_shares_member_idx
  on public.expense_group_shares (member_id);
create index if not exists expense_group_settlements_group_idx
  on public.expense_group_settlements (group_id, settled_at desc);
create index if not exists expense_group_activity_group_idx
  on public.expense_group_activity (group_id, created_at desc);
create index if not exists expense_group_invitations_email_idx
  on public.expense_group_invitations (lower(email));
create index if not exists expense_group_invitations_group_idx
  on public.expense_group_invitations (group_id);

-- ===========================================================================
-- 3. MEMBERSHIP HELPERS
--
-- These MUST be SECURITY DEFINER. A policy on expense_group_members that
-- itself selects from expense_group_members re-enters the same policy and
-- Postgres aborts with "infinite recursion detected in policy". Running the
-- lookup as the definer bypasses RLS for that one question and breaks the
-- cycle. Each returns only a boolean, so nothing leaks.
-- ===========================================================================

create or replace function public.is_expense_group_member(gid text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.expense_group_members m
     where m.group_id = gid
       and m.user_id = auth.uid()
       and m.deleted_at is null
  );
$$;

create or replace function public.is_expense_group_owner(gid text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.expense_group_members m
     where m.group_id = gid
       and m.user_id = auth.uid()
       and m.role = 'owner'
       and m.deleted_at is null
  );
$$;

-- Creating a group and adding yourself to it happen in the same transaction, so
-- at the moment of that first member INSERT you are not yet a member. This
-- narrow exception lets the creator — and nobody else — bootstrap that row.
-- Without it the group would be unjoinable; with a naive `user_id = auth.uid()`
-- check instead, ANY user could insert themselves into ANY group.
create or replace function public.is_expense_group_creator(gid text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.expense_groups g
     where g.id = gid
       and g.created_by = auth.uid()
  );
$$;

-- Membership test for a row that only knows its expense.
create or replace function public.is_expense_member(eid text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.expense_group_expenses e
      join public.expense_group_members m on m.group_id = e.group_id
     where e.id = eid
       and m.user_id = auth.uid()
       and m.deleted_at is null
  );
$$;

revoke all on function public.is_expense_group_member(text) from public, anon;
revoke all on function public.is_expense_group_owner(text) from public, anon;
revoke all on function public.is_expense_group_creator(text) from public, anon;
revoke all on function public.is_expense_member(text) from public, anon;
grant execute on function public.is_expense_group_member(text) to authenticated;
grant execute on function public.is_expense_group_owner(text) to authenticated;
grant execute on function public.is_expense_group_creator(text) to authenticated;
grant execute on function public.is_expense_member(text) to authenticated;

-- ===========================================================================
-- 4. ROW LEVEL SECURITY
-- ===========================================================================

alter table public.expense_groups enable row level security;
alter table public.expense_group_members enable row level security;
alter table public.expense_group_expenses enable row level security;
alter table public.expense_group_shares enable row level security;
alter table public.expense_group_settlements enable row level security;
alter table public.expense_group_activity enable row level security;
alter table public.expense_group_invitations enable row level security;

-- --- groups ---
create policy "expense_groups_read" on public.expense_groups
  for select using (public.is_expense_group_member(id));

create policy "expense_groups_insert" on public.expense_groups
  for insert with check (created_by = auth.uid());

create policy "expense_groups_update" on public.expense_groups
  for update using (public.is_expense_group_member(id))
  with check (public.is_expense_group_member(id));

-- Deleting the whole group stays with owners; members leave by soft-deleting
-- their own membership row instead.
create policy "expense_groups_delete" on public.expense_groups
  for delete using (public.is_expense_group_owner(id));

-- --- members ---
create policy "expense_group_members_read" on public.expense_group_members
  for select using (public.is_expense_group_member(group_id));

create policy "expense_group_members_insert" on public.expense_group_members
  for insert with check (
    public.is_expense_group_member(group_id)
    or public.is_expense_group_creator(group_id)
  );

create policy "expense_group_members_update" on public.expense_group_members
  for update using (public.is_expense_group_member(group_id))
  with check (public.is_expense_group_member(group_id));

create policy "expense_group_members_delete" on public.expense_group_members
  for delete using (
    public.is_expense_group_owner(group_id)
    or user_id = auth.uid()   -- anyone may leave
  );

-- --- expenses ---
-- Any member may add and edit any expense: people routinely enter costs on each
-- other's behalf. The activity log is what makes that safe.
create policy "expense_group_expenses_all" on public.expense_group_expenses
  for all using (public.is_expense_group_member(group_id))
  with check (public.is_expense_group_member(group_id));

-- --- shares ---
create policy "expense_group_shares_all" on public.expense_group_shares
  for all using (public.is_expense_member(expense_id))
  with check (public.is_expense_member(expense_id));

-- --- settlements ---
create policy "expense_group_settlements_all" on public.expense_group_settlements
  for all using (public.is_expense_group_member(group_id))
  with check (public.is_expense_group_member(group_id));

-- --- activity (append-only: history is not editable, including by its author) ---
create policy "expense_group_activity_read" on public.expense_group_activity
  for select using (public.is_expense_group_member(group_id));

create policy "expense_group_activity_insert" on public.expense_group_activity
  for insert with check (public.is_expense_group_member(group_id));

-- --- invitations ---
create policy "expense_group_invitations_read" on public.expense_group_invitations
  for select using (public.is_expense_group_member(group_id));

create policy "expense_group_invitations_write" on public.expense_group_invitations
  for all using (public.is_expense_group_member(group_id))
  with check (public.is_expense_group_member(group_id));

-- ===========================================================================
-- 5. INTEGRITY: shares must add up to their expense
--
-- DEFERRABLE so a multi-row split is judged at COMMIT. A non-deferred trigger
-- would fire after the first share row and fail every insert.
-- ===========================================================================

create or replace function public.check_expense_shares_total()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_expense_id text;
  v_amount bigint;
  v_total bigint;
  v_shares int;
begin
  -- Fired from either side of the relationship, so the expense is identified
  -- differently depending on which table changed. NEW is unassigned on DELETE,
  -- hence the explicit TG_OP branch rather than coalesce(new.., old..).
  -- Deliberately IF/ELSIF and not a CASE expression: PL/pgSQL resolves every
  -- field reference in an expression, so `case ... then new.id else
  -- new.expense_id end` fails with `record "new" has no field "expense_id"`
  -- when firing from expense_group_expenses. Only one branch may be compiled.
  if tg_op = 'DELETE' then
    if tg_table_name = 'expense_group_expenses' then
      v_expense_id := old.id;
    else
      v_expense_id := old.expense_id;
    end if;
  else
    if tg_table_name = 'expense_group_expenses' then
      v_expense_id := new.id;
    else
      v_expense_id := new.expense_id;
    end if;
  end if;

  select amount_cents into v_amount
    from public.expense_group_expenses
   where id = v_expense_id and deleted_at is null;

  -- Expense removed or soft-deleted in the same transaction: nothing to check.
  if v_amount is null then
    return null;
  end if;

  select count(*), coalesce(sum(share_cents), 0)
    into v_shares, v_total
    from public.expense_group_shares
   where expense_id = v_expense_id;

  -- Not split yet, or deliberately unsplit: an expense with no shares is an
  -- intermediate state, not a corrupt one. (This is also what lets a freshly
  -- inserted expense commit before its shares are written.)
  if v_shares = 0 then
    return null;
  end if;

  if v_total <> v_amount then
    raise exception
      'expense % shares total % cents but the expense is % cents',
      v_expense_id, v_total, v_amount
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

drop trigger if exists expense_group_shares_total_matches on public.expense_group_shares;
create constraint trigger expense_group_shares_total_matches
  after insert or update or delete on public.expense_group_shares
  deferrable initially deferred
  for each row execute function public.check_expense_shares_total();

-- The other direction: editing an expense's amount without restating its shares
-- would otherwise leave a split that no longer adds up, silently.
drop trigger if exists expense_group_expenses_total_matches on public.expense_group_expenses;
create constraint trigger expense_group_expenses_total_matches
  after insert or update of amount_cents on public.expense_group_expenses
  deferrable initially deferred
  for each row execute function public.check_expense_shares_total();
