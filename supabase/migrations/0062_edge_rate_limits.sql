-- 0062 — A rate limiter the edge functions can actually reach.
--
-- ## The gap this closes
--
-- 0010 built a real limiter (`abuse_counters` + `note_abuse_action`) and wired
-- it to triggers. Everything it protects is therefore a *table write*. The nine
-- edge functions are not table writes, and not one of them had any limit at
-- all: `safepay-checkout` creates a Safepay Plan object at the payment provider
-- and a `checkout_intents` row per call, `send-invite` sends real email through
-- Resend, and `notify-group`/`notify-album` fan out push through Expo. Each of
-- those costs money or reputation per request, authenticates the caller, and
-- then did unbounded work on their behalf.
--
-- ## Why not `note_abuse_action`
--
-- Two reasons, both of which 0022's `export_own_data` already reasoned about
-- for itself rather than reuse that helper:
--
--  1. **It auto-restricts.** Crossing a trigger's limit writes a 24h
--     `account_status = 'restricted'` row, which is the correct response to
--     someone inserting 500 reports and a wildly disproportionate one to
--     someone whose flaky connection retried a checkout eleven times. An edge
--     function overage must cost the caller a 429, not their account.
--  2. **It is not callable from a client session.** 0010 revokes it from
--     everyone precisely because the triggers invoke it as the definer. An edge
--     function calls in over PostgREST with the caller's JWT, which is the
--     session shape 0010 deliberately locked out.
--
-- ## Why it takes no user id
--
-- The obvious signature is `consume_rate_limit(p_user_id, p_action, ...)` with
-- a `service_role` grant, and it is the wrong one: it makes every calling
-- function build a service-role client just to count, and it makes the identity
-- being limited a *parameter* — so the one field that must not be forgeable
-- arrives in the request. This reads `auth.uid()` instead and is granted to
-- `authenticated`, so the caller's own JWT names them and there is no argument
-- to get wrong. `send-invite` and `notify-*` keep their anon-key clients.
--
-- A client *can* call this directly and burn its own budget. That is the whole
-- of the abuse surface, it is self-inflicted, and it is cheaper than the work
-- the budget is protecting.
--
-- ## Why `p_action` is an allowlist
--
-- `abuse_counters`' primary key is `(user_id, action, window_start)` and
-- nothing constrains `action`. Reachable from a client session with a free-text
-- action, that is an invitation to insert a million distinct actions and bloat
-- the table — turning the limiter into the thing that needs limiting. The
-- allowlist is checked before the insert, so an unknown action is refused
-- rather than counted.
--
-- `p_limit` and `p_window_ms` are deliberately NOT protected: a client passing
-- its own limit still gets counted, and the comparison that matters is made by
-- the edge function against the limit *it* chose. They are only clamped, so a
-- absurd window cannot compute a bucket outside bigint.

-- ===========================================================================
-- The actions the edge functions are allowed to count against.
-- ===========================================================================
--
-- STABLE, not IMMUTABLE: it is a constant today, but the moment it reads a
-- settings table (a per-plan limit, say) IMMUTABLE would be a lie the planner
-- caches. Nothing here is hot enough for the difference to matter.
create or replace function public.rate_limited_actions()
returns text[]
language sql
stable
as $$
  select array[
    'edge_safepay_checkout',
    'edge_safepay_cancel',
    'edge_send_invite',
    'edge_notify_group',
    'edge_notify_album',
    'edge_ban_account',
    'edge_delete_account'
  ]::text[];
$$;

-- ===========================================================================
-- Consume one unit of the caller's budget for an action.
-- ===========================================================================
--
-- Returns the decision rather than raising: a 429 with a `Retry-After` is a
-- normal, expected answer for this and every caller wants to shape its own
-- response around it. `raise exception` would make the ordinary case arrive as
-- a 500-shaped error with a message to parse.
create or replace function public.consume_rate_limit(
  p_action text,
  p_limit integer,
  p_window_ms bigint
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 60), 100000));
  -- One second to one day. A window of 0 would divide by zero computing the
  -- bucket; one of a century would keep a single bucket hot forever.
  v_window bigint := greatest(1000, least(coalesce(p_window_ms, 3600000), 86400000));
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_bucket bigint;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;

  if not (p_action = any (public.rate_limited_actions())) then
    raise exception 'unknown rate limit action %', p_action
      using errcode = 'invalid_parameter_value';
  end if;

  v_bucket := (v_now / v_window) * v_window;

  -- Same single-upsert-against-a-fixed-bucket shape as note_abuse_action: no
  -- scan, no read-then-write, and two concurrent calls cannot both see the same
  -- pre-increment count.
  insert into public.abuse_counters (user_id, action, window_start, count)
  values (v_uid, p_action, v_bucket, 1)
  on conflict (user_id, action, window_start) do update
    set count = abuse_counters.count + 1
  returning count into v_count;

  -- Rounded up, and floored at 1: a caller told to retry after 0 seconds
  -- retries immediately, which is the behaviour the header exists to prevent.
  return query select
    v_count <= v_limit,
    greatest(0, v_limit - v_count),
    greatest(1, ceil((v_bucket + v_window - v_now)::numeric / 1000)::integer);
end;
$$;

-- ===========================================================================
-- Grants. `authenticated` only — see the header for why this reads auth.uid()
-- instead of accepting an id, and `anon` reaching a SECURITY DEFINER function
-- that trusts auth.uid() would be a function that trusts NULL (0022's words).
-- ===========================================================================

revoke all on function public.rate_limited_actions() from public, anon;
revoke all on function public.consume_rate_limit(text, integer, bigint) from public, anon;

grant execute on function public.rate_limited_actions() to authenticated;
grant execute on function public.consume_rate_limit(text, integer, bigint) to authenticated;

-- `abuse_counters` keeps its "no policy, invisible to clients" posture from
-- 0010. The function is SECURITY DEFINER precisely so that stays true: a caller
-- can spend its budget and cannot read anybody's, including its own.

-- ===========================================================================
-- Housekeeping. Stale buckets stop being written to but never leave, and this
-- table now takes a row per user per action per window rather than only on
-- moderated writes. Service-role only: it is an operator's cron, not a
-- client's, and a client that could delete buckets could clear its own limit.
-- ===========================================================================

create index if not exists abuse_counters_window_idx
  on public.abuse_counters (window_start);

create or replace function public.prune_abuse_counters(p_older_than_ms bigint default 604800000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint
                     - greatest(3600000, coalesce(p_older_than_ms, 604800000));
  v_deleted integer;
begin
  delete from public.abuse_counters where window_start < v_cutoff;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_abuse_counters(bigint) from public, anon, authenticated;
grant execute on function public.prune_abuse_counters(bigint) to service_role;
