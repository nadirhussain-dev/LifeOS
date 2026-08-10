-- 0022 — Self-service data access, so a blocked account can still get its data.
--
-- ## The obligation this meets
--
-- 0019 made a block deny reads as well as writes, and send the device a
-- `wipe_local` command. Both are correct: an account blocked for abuse should
-- not keep operating, and should not keep the material it was blocked over on a
-- phone. Together they also mean a blocked person has no copy of their data and
-- no way to fetch one — while GDPR Art. 15 and Art. 20 still entitle them to it,
-- being blocked by us is not a lawful basis for withholding it.
--
-- Until now that was met by an admin running `admin_user_rows` by hand, per
-- table, on request. A legal obligation discharged by somebody remembering to is
-- not discharged.
--
-- ## The one design decision that matters
--
-- `export_own_data` takes **no user id**. It reads `auth.uid()` and nothing
-- else. That is deliberate and is the whole of its safety argument: a function
-- with a target parameter is one missing predicate away from returning somebody
-- else's rows, and this one is SECURITY DEFINER precisely so it can see past the
-- block. There is no parameter to get wrong, no branch that widens the scope,
-- and no admin path through it.
--
-- It is therefore *not* an operator tool. `admin_user_rows` remains the only way
-- to read another account, with its report gate, its reason requirement and its
-- audit row.

-- ---------------------------------------------------------------------------
-- What a person may export about themselves.
-- ---------------------------------------------------------------------------

/**
 * The exportable set: everything an operator can read, minus the vault.
 *
 * `private_entries` is excluded and the reason is not squeamishness. What the
 * server holds is ciphertext sealed to a key that was never derived here, so
 * returning it would satisfy the letter of a data request with bytes the person
 * cannot open. Anyone who genuinely needs the private space unsealed is asking
 * for the escrow key (0015), which is a separate, separately-audited act by a
 * human — and it should stay one.
 */
-- `array_remove` rather than `select ... from unnest(...)`: the latter reads, to
-- anything parsing this file, as a query against a table called `unnest` — which
-- is exactly what scripts/check-migrations.mjs flagged, and it is right to,
-- because a LANGUAGE SQL body is validated at CREATE time and a genuine
-- forward reference there would fail the migration on a fresh database.
create or replace function public.self_exportable_tables()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array_remove(public.operator_readable_tables(), 'private_entries');
$$;

-- ---------------------------------------------------------------------------
-- The log. Not optional: "we provided the data" is the claim that has to be
-- evidenced, and the request itself is the evidence.
-- ---------------------------------------------------------------------------

create table if not exists public.data_access_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  table_name text not null,
  row_count integer not null default 0,
  requested_at timestamptz not null default now()
);

create index if not exists idx_data_access_log_user
  on public.data_access_log (user_id, requested_at desc);

alter table public.data_access_log enable row level security;

-- A person may read the record of their own requests. `(select auth.uid())` for
-- the same reason as everything in 0017: an InitPlan computed once per statement
-- rather than a function call per row.
drop policy if exists data_access_log_own on public.data_access_log;
create policy data_access_log_own on public.data_access_log
  for select using (user_id = (select auth.uid()));

-- Deliberately no insert/update/delete policy for anybody. Rows are written by
-- the definer function below; a log the subject can edit is not a log.

-- ---------------------------------------------------------------------------
-- The export itself.
-- ---------------------------------------------------------------------------

/**
 * One table's worth of the caller's own rows, block or no block.
 *
 * Soft-deleted rows are included. A blocked account's data is soft-deleted by
 * `admin_purge_user_data` precisely so it survives for an appeal, and excluding
 * it here would return an empty export to exactly the people this exists for.
 *
 * Rate limited, but *without* `note_abuse_action` — that helper auto-restricts
 * an account on breach, and restricting somebody for asking for their own data
 * inverts the entire point. Over the limit is simply refused, and the limit is
 * high enough that a full export of every table twice over stays inside it.
 */
create or replace function public.export_own_data(
  p_table text,
  p_limit integer default 1000
)
returns table (row_data jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sql text;
  v_window_ms bigint := 3600000;      -- one hour
  v_bucket bigint;
  v_count integer;
  v_rows integer;
begin
  if v_uid is null then
    raise exception 'sign in to export your data' using errcode = 'insufficient_privilege';
  end if;

  if not (p_table = any (public.self_exportable_tables())) then
    raise exception 'table % is not exportable', p_table
      using errcode = 'invalid_parameter_value';
  end if;

  v_bucket := ((extract(epoch from now()) * 1000)::bigint / v_window_ms) * v_window_ms;

  insert into public.abuse_counters (user_id, action, window_start, count)
  values (v_uid, 'self_export', v_bucket, 1)
  on conflict (user_id, action, window_start) do update
    set count = abuse_counters.count + 1
  returning count into v_count;

  -- ~80 tables are exportable; 200 leaves room for a full export plus retries
  -- and paging, and still bounds a script pointed at this.
  if v_count > 200 then
    raise exception 'too many export requests — try again later'
      using errcode = 'too_many_connections';
  end if;

  create temporary table if not exists _export_rows (row_data jsonb) on commit drop;
  delete from _export_rows;

  -- `user_id = v_uid` is the only predicate, and v_uid is auth.uid(). There is
  -- no code path here that reads any other account's rows.
  v_sql := format(
    'insert into _export_rows select to_jsonb(t) from public.%I t where t.user_id = $1 limit $2',
    p_table
  );
  execute v_sql using v_uid, least(coalesce(p_limit, 1000), 10000);

  select count(*) into v_rows from _export_rows;

  insert into public.data_access_log (user_id, table_name, row_count)
  values (v_uid, p_table, v_rows);

  return query select r.row_data from _export_rows r;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. `authenticated` only — there is nothing here for an anonymous caller,
-- and `anon` reaching a SECURITY DEFINER function that trusts auth.uid() would
-- be a function that trusts NULL.
-- ---------------------------------------------------------------------------

revoke all on function public.self_exportable_tables() from public, anon;
revoke all on function public.export_own_data(text, integer) from public, anon;

grant execute on function public.self_exportable_tables() to authenticated;
grant execute on function public.export_own_data(text, integer) to authenticated;

grant select on public.data_access_log to authenticated;
