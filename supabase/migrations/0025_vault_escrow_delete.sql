-- 0025 — Make vault escrow actually writable, and deletable.
--
-- ## The bug this fixes: escrow has never once been written
--
-- `vault_escrow` (0015) deliberately has **no SELECT policy**. The sealed blob
-- is meant to leave only through `admin_fetch_vault_escrow`, behind the admin
-- gate and an audit row. That part is right and stays.
--
-- What nobody noticed is what a missing SELECT policy costs on the *write*
-- side. Postgres will not run `INSERT … ON CONFLICT DO UPDATE` against a table
-- the caller cannot select from — the conflict path has to read the existing
-- row — and it rejects the statement with "new row violates row-level security
-- policy" **whether or not a conflicting row exists**. The client's only writer,
-- `uploadEscrow()`, used exactly that statement (PostgREST's `.upsert()`), and
-- its one caller `await`s it without checking the boolean it returns.
--
-- So every escrow upload since 0015 has failed, silently, and
-- `public.vault_escrow` is empty. The operator-access capability that
-- PRIVACY.md, the setup copy and the TODO.md warning all describe does not
-- exist in practice.
--
-- The same missing SELECT policy also breaks `UPDATE … WHERE user_id = $1` and
-- `DELETE … WHERE user_id = $1`: the WHERE clause cannot see the row it is
-- filtering on, so both match zero rows and report success. Which means a
-- policy-based fix is not available here — PostgREST requires a filter on
-- update and delete, and any filter needs the SELECT the design withholds.
--
-- ## The fix
--
-- Two SECURITY DEFINER functions, scoped to `auth.uid()` and taking no user id,
-- for the same reason `export_own_data` takes none (0022): there is no parameter
-- to get wrong. They run outside RLS, so they can read the caller's own row to
-- update or delete it, while the table stays unreadable to every client.
--
-- The bare `for delete` policy below is kept because it is honest about intent
-- and costs nothing, but note that it cannot be exercised through PostgREST —
-- the RPC is the route that works.

drop policy if exists "vault_escrow_delete_own" on public.vault_escrow;
create policy "vault_escrow_delete_own" on public.vault_escrow
  for delete using (user_id = (select auth.uid()));

/**
 * Writes (or replaces) the caller's own escrow blob.
 *
 * Takes no user id. The blob is opaque to this function and to every client —
 * it is sealed to the operator's X25519 public key on the device, and the server
 * never sees the vault key in the clear.
 */
create or replace function public.set_own_vault_escrow(
  p_key_version integer,
  p_ephemeral_public_key text,
  p_wrapped_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_ephemeral_public_key), '') = ''
     or coalesce(trim(p_wrapped_key), '') = '' then
    raise exception 'an escrow blob is required' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.vault_escrow (user_id, key_version, ephemeral_public_key, wrapped_key, updated_at)
  values (v_uid, coalesce(p_key_version, 1), p_ephemeral_public_key, p_wrapped_key, now())
  on conflict (user_id) do update
    set key_version = excluded.key_version,
        ephemeral_public_key = excluded.ephemeral_public_key,
        wrapped_key = excluded.wrapped_key,
        updated_at = now();
end;
$$;

/**
 * Removes the caller's own escrow row.
 *
 * Called when the private space is destroyed. Without it, the most explicit
 * "I want this gone" the app offers cleared the local keystore and left the
 * sealed key on the server — the space became unreadable to its owner while
 * remaining readable to an operator, which is exactly backwards.
 */
create or replace function public.delete_own_vault_escrow()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;
  delete from public.vault_escrow where user_id = v_uid;
end;
$$;

revoke all on function public.set_own_vault_escrow(integer, text, text) from public, anon;
revoke all on function public.delete_own_vault_escrow() from public, anon;

grant execute on function public.set_own_vault_escrow(integer, text, text) to authenticated;
grant execute on function public.delete_own_vault_escrow() to authenticated;
