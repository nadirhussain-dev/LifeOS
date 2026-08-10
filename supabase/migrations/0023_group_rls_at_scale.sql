-- 0023 — Make the expense-group policies hoistable, without changing who can
-- see what.
--
-- ## What 0017 did, and what it could not reach
--
-- 0017 rewrote every *owner* policy from `auth.uid() = user_id` to
-- `(select auth.uid()) = user_id`. The parenthesised form is an InitPlan:
-- Postgres computes it once per statement instead of calling the function once
-- per row, and the result is a constant the index can be used against.
--
-- The shared-group policies could not be fixed that way. `is_expense_group_member(group_id)`
-- takes the row's own group as an argument, so it is correlated by construction —
-- the planner has to call it per row, and each call runs a subquery against
-- `expense_group_members`. On a group with a long ledger that is one index probe
-- per expense, per read, forever.
--
-- ## The change
--
-- Invert it. Instead of asking "is the caller a member of *this row's* group?"
-- once per row, ask "which groups is the caller in?" once per statement, and
-- test each row against that set:
--
--     using (public.is_expense_group_member(group_id))     -- correlated, per row
--     using (group_id in (select public.my_expense_group_ids()))  -- hoisted, once
--
-- The new functions take no arguments, so nothing correlates them to a row. They
-- are STABLE, so Postgres evaluates them once per statement and hashes the
-- result; the per-row work becomes a hash lookup.
--
-- ## Why this is safe
--
-- The predicate is the same predicate. `is_expense_group_member(g)` is
-- "there exists a live membership row for (g, auth.uid())"; `g in (select
-- my_expense_group_ids())` is "g is in the set of groups with a live membership
-- row for auth.uid()". Identical, and the tests in scripts/test-migrations.mjs
-- that already assert non-members cannot read, write, invite or settle run
-- unchanged against the new policies — which is the point of having them.
--
-- The old per-row functions are deliberately left in place. They are still used
-- by RPC bodies in 0004/0005/0007/0008, where a single-group check is exactly
-- what is wanted and there is no per-row cost to avoid.
--
-- ## What is NOT changed
--
-- `expense_groups_delete` and `expense_group_members_delete` gate on *owner*,
-- and the invitation/insert policies also carry `can_share()` and the creator
-- bootstrap. Each of those is preserved verbatim below; the only substitution is
-- the membership test itself.

-- ---------------------------------------------------------------------------
-- Set-returning, argument-free membership.
--
-- SECURITY DEFINER for the same reason as the 0003 helpers: a policy on
-- expense_group_members that itself reads expense_group_members re-enters the
-- policy and Postgres aborts with "infinite recursion detected in policy".
-- Running the lookup as the definer answers that one question outside RLS.
-- Each returns only group ids the caller is already entitled to know about.
-- ---------------------------------------------------------------------------

create or replace function public.my_expense_group_ids()
returns setof text
language sql
security definer
set search_path = public
stable
as $$
  select m.group_id
    from public.expense_group_members m
   where m.user_id = (select auth.uid())
     and m.deleted_at is null;
$$;

create or replace function public.my_owned_expense_group_ids()
returns setof text
language sql
security definer
set search_path = public
stable
as $$
  select m.group_id
    from public.expense_group_members m
   where m.user_id = (select auth.uid())
     and m.role = 'owner'
     and m.deleted_at is null;
$$;

/**
 * Groups this account created.
 *
 * Kept separate from membership because of the bootstrap 0003 documents:
 * creating a group and joining it happen in one transaction, so at the moment of
 * the first member INSERT the creator is not yet a member. Without this the
 * group would be unjoinable; with a naive `user_id = auth.uid()` check instead,
 * anyone could insert themselves into any group.
 */
create or replace function public.my_created_expense_group_ids()
returns setof text
language sql
security definer
set search_path = public
stable
as $$
  select g.id
    from public.expense_groups g
   where g.created_by = (select auth.uid());
$$;

/**
 * Expenses belonging to any group the caller is in.
 *
 * For `expense_group_shares`, whose rows know their expense but not their group.
 * Larger than the group-id sets — one row per expense rather than per group — but
 * still one evaluation per statement instead of a two-table join per row.
 */
create or replace function public.my_expense_ids()
returns setof text
language sql
security definer
set search_path = public
stable
as $$
  select e.id
    from public.expense_group_expenses e
   where e.group_id in (
     select m.group_id
       from public.expense_group_members m
      where m.user_id = (select auth.uid())
        and m.deleted_at is null
   );
$$;

revoke all on function public.my_expense_group_ids() from public, anon;
revoke all on function public.my_owned_expense_group_ids() from public, anon;
revoke all on function public.my_created_expense_group_ids() from public, anon;
revoke all on function public.my_expense_ids() from public, anon;

grant execute on function public.my_expense_group_ids() to authenticated;
grant execute on function public.my_owned_expense_group_ids() to authenticated;
grant execute on function public.my_created_expense_group_ids() to authenticated;
grant execute on function public.my_expense_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- The policies, rewritten. Same semantics, hoistable shape.
-- ---------------------------------------------------------------------------

-- --- groups ---
drop policy if exists "expense_groups_read" on public.expense_groups;
create policy "expense_groups_read" on public.expense_groups
  for select using (id in (select public.my_expense_group_ids()));

drop policy if exists "expense_groups_update" on public.expense_groups;
create policy "expense_groups_update" on public.expense_groups
  for update using (id in (select public.my_expense_group_ids()))
  with check (id in (select public.my_expense_group_ids()));

drop policy if exists "expense_groups_delete" on public.expense_groups;
create policy "expense_groups_delete" on public.expense_groups
  for delete using (id in (select public.my_owned_expense_group_ids()));

-- --- members ---
drop policy if exists "expense_group_members_read" on public.expense_group_members;
create policy "expense_group_members_read" on public.expense_group_members
  for select using (group_id in (select public.my_expense_group_ids()));

-- Carries 0010's `can_share` gate and 0003's creator bootstrap, both unchanged.
drop policy if exists "expense_group_members_insert" on public.expense_group_members;
create policy "expense_group_members_insert" on public.expense_group_members
  for insert with check (
    public.can_share((select auth.uid()))
    and (
      group_id in (select public.my_expense_group_ids())
      or group_id in (select public.my_created_expense_group_ids())
    )
  );

drop policy if exists "expense_group_members_update" on public.expense_group_members;
create policy "expense_group_members_update" on public.expense_group_members
  for update using (group_id in (select public.my_expense_group_ids()))
  with check (group_id in (select public.my_expense_group_ids()));

drop policy if exists "expense_group_members_delete" on public.expense_group_members;
create policy "expense_group_members_delete" on public.expense_group_members
  for delete using (
    group_id in (select public.my_owned_expense_group_ids())
    or user_id = (select auth.uid())   -- anyone may leave
  );

-- --- expenses ---
drop policy if exists "expense_group_expenses_all" on public.expense_group_expenses;
create policy "expense_group_expenses_all" on public.expense_group_expenses
  for all using (group_id in (select public.my_expense_group_ids()))
  with check (group_id in (select public.my_expense_group_ids()));

-- --- shares ---
drop policy if exists "expense_group_shares_all" on public.expense_group_shares;
create policy "expense_group_shares_all" on public.expense_group_shares
  for all using (expense_id in (select public.my_expense_ids()))
  with check (expense_id in (select public.my_expense_ids()));

-- --- settlements ---
drop policy if exists "expense_group_settlements_all" on public.expense_group_settlements;
create policy "expense_group_settlements_all" on public.expense_group_settlements
  for all using (group_id in (select public.my_expense_group_ids()))
  with check (group_id in (select public.my_expense_group_ids()));

-- --- activity (append-only: history is not editable, including by its author) ---
drop policy if exists "expense_group_activity_read" on public.expense_group_activity;
create policy "expense_group_activity_read" on public.expense_group_activity
  for select using (group_id in (select public.my_expense_group_ids()));

drop policy if exists "expense_group_activity_insert" on public.expense_group_activity;
create policy "expense_group_activity_insert" on public.expense_group_activity
  for insert with check (group_id in (select public.my_expense_group_ids()));

-- --- invitations --- (0010's can_share gate preserved on the write side)
drop policy if exists "expense_group_invitations_read" on public.expense_group_invitations;
create policy "expense_group_invitations_read" on public.expense_group_invitations
  for select using (group_id in (select public.my_expense_group_ids()));

drop policy if exists "expense_group_invitations_write" on public.expense_group_invitations;
create policy "expense_group_invitations_write" on public.expense_group_invitations
  for all using (group_id in (select public.my_expense_group_ids()))
  with check (
    group_id in (select public.my_expense_group_ids())
    and public.can_share((select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- The index the hoisted form now depends on.
--
-- Every one of these evaluates `expense_group_members` by user_id once per
-- statement. Without an index on that column it is a sequential scan of the
-- whole membership table per statement — cheaper than the per-row version it
-- replaces, and still the wrong shape.
-- ---------------------------------------------------------------------------

create index if not exists expense_group_members_user_live_idx
  on public.expense_group_members (user_id, group_id)
  where deleted_at is null;
