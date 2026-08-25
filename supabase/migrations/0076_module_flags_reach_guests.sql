-- ---------------------------------------------------------------------------
-- 0076 — The operator's switches reach signed-out users too.
--
-- ## The hole
--
-- `my_module_flags()` (0024) is the only thing that ever fills the client's
-- flag cache — `refreshModuleFlags` is its sole caller and `setFlags` its sole
-- writer. 0024 closed it to guests in two independent ways, and either alone
-- was enough:
--
--   1. `revoke all ... from public, anon` with `grant execute ... to
--      authenticated`. A signed-out client carries the anon role, so the RPC
--      came back `42501` and `refreshModuleFlags` swallowed it.
--   2. `where coalesce(u.user_id, auth.uid()) = auth.uid()`. For a guest both
--      sides are null, `null = null` is null rather than true, and the filter
--      dropped every row — so even with the grant, the answer was empty.
--
-- The client reads an empty answer as "nothing is switched off", and it is
-- right to: 0011 rule 1 says an absent row means enabled, and collapsing "the
-- server is unreachable" into "everything is fine" is what stops a network
-- blip from stripping the app down to nothing. It just means a guest got that
-- verdict for every module, permanently, having never heard from the server at
-- all.
--
-- So every kill switch in `module_flags` was inert for anyone without an
-- account. The private space is the case that made it visible — 0074 ships it
-- closed and the guard reads the `private` row, so a guest walked past a gate
-- that had already been shut and found the Settings entry point still there —
-- but the same was true of every other row in the table, including a module
-- pulled because it was corrupting data.
--
-- ## Why this is not a disclosure
--
-- `module_flags` has carried `for select using (true)` since 0011 — the table
-- is world-readable by design, because the client has to be able to ask "is
-- this switched off" before it knows who is asking. This function returns a
-- strict subset of it for a guest, so granting `anon` execute tells nobody
-- anything the table did not already answer. What it does not do is widen the
-- *per-user* half: `module_flags_user` stays `authenticated`-only, and the
-- predicate below still refuses to hand a guest any row that belongs to an
-- account.
-- ---------------------------------------------------------------------------

/*
 * Body unchanged from 0024 apart from the null-safe predicate.
 *
 * `is not distinct from` rather than `=`, which is the whole fix: it is true
 * for two nulls, so a guest passes the filter that null-propagation used to
 * fail them at. For a signed-in caller both sides are non-null and it behaves
 * exactly as `=` did, which is what keeps this a fix rather than a change.
 *
 * The full outer join needs saying, because it is what the predicate is
 * guarding. For a guest, `u.user_id = null` matches nothing, so the join
 * null-extends every global row (wanted) *and* every per-user override row in
 * the table, for every account (very much not). Those arrive with
 * `u.user_id` non-null and `coalesce` therefore returns it, which is distinct
 * from a guest's null uid — so they are dropped, one row at a time, by the
 * same comparison that lets the global rows through.
 */
create or replace function public.my_module_flags()
returns table (module text, enabled boolean, message text)
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce(u.module, g.module) as module,
    coalesce(u.enabled, g.enabled) as enabled,
    -- The operator's user-facing explanation only ever lives on the global row;
    -- a per-user note is internal and must not be rendered to the account it
    -- is about.
    case when u.module is null then g.message else null end as message
  from public.module_flags g
  full outer join public.module_flags_user u
    on u.module = g.module and u.user_id = (select auth.uid())
  where coalesce(u.user_id, (select auth.uid())) is not distinct from (select auth.uid())
    and coalesce(u.enabled, g.enabled) = false;
$$;

/*
 * `anon` alongside `authenticated`.
 *
 * Still revoked from `public` first: that is every role including future ones,
 * and the two that should hold this are worth naming rather than inheriting.
 */
revoke all on function public.my_module_flags() from public, anon;
grant execute on function public.my_module_flags() to anon, authenticated;
