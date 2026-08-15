-- ---------------------------------------------------------------------------
-- 0015 — Key escrow, private-module sync, and operator content access.
--
-- ⚠️  THIS FILE CHANGES WHAT DAYKEEP PROMISES ITS USERS.  ⚠️
--
-- Before it, a user's private space could not be read by anyone but them, as a
-- property of the mathematics: the vault key existed only inside their phone's
-- keystore. After it, every vault key is additionally wrapped under an operator
-- public key and uploaded, so the operator can open any private space.
--
-- That is a product decision, made deliberately by the owner for abuse
-- prevention. It is implemented here as safely as the decision allows, and the
-- honest consequences are recorded so nobody has to rediscover them:
--
--  1. **A database breach now exposes content, not ciphertext.** Previously an
--     attacker with a full dump got noise. Now they get every escrow blob, and
--     if the operator private key is ever also exposed, every vault with it.
--  2. **The operator private key must never live in this database.** It is the
--     single thing standing between a dump and every user's intimate data.
--     Keep it offline, in an HSM or a password manager, never in an env var on
--     the same platform as the data it opens.
--  3. **"We cannot read your data" is no longer true** and has been removed
--     from PRIVACY.md and from the in-app copy. Cycle and intimacy data are
--     GDPR Art. 9 special-category; App Store 5.1.3 governs the health parts.
--     Disclosure is not optional.
--  4. **Every unseal is logged**, below, and admin access additionally requires
--     a registered origin (0014). Those two together are what make this
--     auditable rather than merely powerful.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. PRIVATE ENTRIES, SYNCED
-- ===========================================================================

-- Mirrors the device's `private_entries`. `payload` is still ciphertext on the
-- wire and at rest — the escrow below is what makes it openable, not this.
create table if not exists public.private_entries (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

create index if not exists private_entries_user_idx
  on public.private_entries (user_id, updated_at);

alter table public.private_entries enable row level security;

-- The owner reads and writes their own rows, exactly like every other synced
-- table. Operator access does NOT come through this policy — it goes through
-- the audited function in section 3, so that reading somebody's vault always
-- leaves a record.
create policy "private_entries_own" on public.private_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===========================================================================
-- 2. ESCROW
-- ===========================================================================

-- One row per user: their vault master key, sealed to the operator public key.
--
-- The sealing is X25519 + AES-GCM done on the device (see
-- features/private/services/vault-escrow.ts). The server stores an opaque blob
-- and the ephemeral public key needed to reopen it; the operator private key is
-- never here, which is the only reason this table is not itself a full
-- compromise.
create table if not exists public.vault_escrow (
  user_id uuid primary key references auth.users(id) on delete cascade,
  /** Which operator keypair this was sealed to, so keys can be rotated without
   * orphaning every existing escrow. */
  key_version integer not null default 1,
  /** base64(ephemeral X25519 public key). */
  ephemeral_public_key text not null,
  /** base64(nonce || AES-GCM(shared secret, vault master key)). */
  wrapped_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vault_escrow enable row level security;

-- The owner may write their own escrow (the app uploads it at vault setup) and
-- read back only whether it exists. They can never read anyone else's, and no
-- client can read the blob at all — reads go through section 3.
create policy "vault_escrow_write_own" on public.vault_escrow
  for insert with check (user_id = auth.uid());
create policy "vault_escrow_update_own" on public.vault_escrow
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===========================================================================
-- 3. OPERATOR ACCESS — AUDITED
-- ===========================================================================

-- Returns one user's escrow blob so the operator can unwrap their vault key
-- offline.
--
-- Every call writes an audit row BEFORE returning anything, and `p_reason` is
-- required. An operator who cannot articulate why they are opening somebody's
-- private space does not get to open it, and the reason is what a later review
-- reads. This is the single most sensitive function in the schema.
create or replace function public.admin_fetch_vault_escrow(
  p_user_id uuid,
  p_reason text
)
returns table (key_version integer, ephemeral_public_key text, wrapped_key text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 8 then
    raise exception 'a reason is required' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (
    auth.uid(),
    'unseal_vault_escrow',
    p_user_id,
    jsonb_build_object('reason', trim(p_reason), 'ip', public.request_ip()::text)
  );

  return query
    select e.key_version, e.ephemeral_public_key, e.wrapped_key
      from public.vault_escrow e
     where e.user_id = p_user_id;
end;
$$;

-- The ciphertext rows themselves. Separate from the escrow so the two halves
-- are fetched — and logged — independently: pulling somebody's rows without
-- their key is a legitimate diagnostic, and should not read as an unseal.
create or replace function public.admin_fetch_private_entries(
  p_user_id uuid,
  p_reason text,
  p_limit integer
)
returns table (id text, payload text, created_at bigint, updated_at bigint, deleted_at bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) < 8 then
    raise exception 'a reason is required' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (
    auth.uid(),
    'read_private_entries',
    p_user_id,
    jsonb_build_object('reason', trim(p_reason), 'ip', public.request_ip()::text)
  );

  return query
    select e.id, e.payload, e.created_at, e.updated_at, e.deleted_at
      from public.private_entries e
     where e.user_id = p_user_id
     order by e.updated_at desc
     limit least(coalesce(p_limit, 500), 2000);
end;
$$;

-- Whether a user's private space is even escrowed, for the admin directory.
-- Reveals existence, not content, and so is not itself an unseal.
create or replace function public.admin_escrow_status(p_user_id uuid)
returns table (has_escrow boolean, entry_count bigint, escrowed_at timestamptz)
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
    select exists (select 1 from public.vault_escrow e where e.user_id = p_user_id),
           (select count(*) from public.private_entries p
             where p.user_id = p_user_id and p.deleted_at is null),
           (select e.created_at from public.vault_escrow e where e.user_id = p_user_id);
end;
$$;

-- ===========================================================================
-- 4. GRANTS
-- ===========================================================================

revoke all on function public.admin_fetch_vault_escrow(uuid, text) from public, anon;
revoke all on function public.admin_fetch_private_entries(uuid, text, integer) from public, anon;
revoke all on function public.admin_escrow_status(uuid) from public, anon;
grant execute on function public.admin_fetch_vault_escrow(uuid, text) to authenticated;
grant execute on function public.admin_fetch_private_entries(uuid, text, integer) to authenticated;
grant execute on function public.admin_escrow_status(uuid) to authenticated;
