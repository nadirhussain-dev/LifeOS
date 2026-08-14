-- ---------------------------------------------------------------------------
-- 0047 — One account, one device.
--
-- An account may have exactly one device signed in at a time. Signing in
-- somewhere new does not silently create a second live session: the new device
-- has to prove control of the account's email with a fresh one-time code, and
-- the moment it does, the previous device is revoked, told to wipe, and refused
-- by row-level security from then on.
--
-- Where the enforcement actually lives
-- ------------------------------------
-- In `may_access_own_data()`, which 0019 already put in the USING and WITH
-- CHECK of every synced table's owner policy. Extending that one function is
-- what makes this a server-side rule rather than a client-side courtesy: a
-- revoked device gets nothing from PostgREST whatever its app does. The local
-- wipe is issued through 0019's `device_commands` queue, which is the part only
-- a cooperating client can carry out — the server cannot reach into a phone's
-- storage, and no amount of SQL changes that.
--
-- How a device identifies itself
-- ------------------------------
-- An `x-lifeos-device` header, generated once per install and held in the OS
-- keystore (lib/device-id.ts). It is a bearer value and the account owner can
-- obviously forge their own, which is worth stating plainly: this is session
-- hygiene for honest clients — "your account is open on your old phone, here is
-- one code to move it" — not a DRM scheme, and it is not defending the account
-- against its own owner. It IS defending against the case that matters in
-- practice: a device that was handed on, sold, or left behind, still holding a
-- live refresh token and a full local copy of someone's journal.
--
-- Why an absent header is refused
-- ---------------------------------
-- Once an account has an active device row, a request that names no device is
-- treated as a request from an unknown device and denied. Otherwise dropping
-- one header would be a bypass, which would make the whole file decorative.
-- The bootstrap case is the exception, and it works exactly like 0014's empty
-- allowlist: an account with NO active device row is unrestricted, so an older
-- build that has never registered anything keeps working, and so does the very
-- first launch after this migration lands.
--
-- Why the old device gets a grace window
-- --------------------------------------
-- `evacuation_until`, borrowed wholesale from 0019's blocking design and for
-- the same reason. The revoked device is about to delete the user's data, and
-- some of it may never have been synced. Refusing its writes the instant it is
-- revoked would destroy exactly the rows the wipe is meant to preserve. So a
-- revoked device keeps write access for a short window, which is what its
-- final push runs inside — then the window closes and the refusal is total.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. THE DEVICE ROSTER
-- ===========================================================================

/**
 * Every device that has ever claimed this account, and which one holds it now.
 *
 * Revoked rows are kept rather than deleted. "This account was moved to a new
 * phone on Tuesday and the old one acknowledged the wipe" is the answer to the
 * only support question this feature generates, and a deleted row cannot give
 * it.
 */
create table if not exists public.user_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  /** Client-generated, stable per install — see lib/device-id.ts. */
  device_id text not null,
  /** Human-readable, for the "you're signed in on …" line. Never trusted. */
  label text,
  platform text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  claimed_at timestamptz not null default now(),
  /** Null while this device holds the account. */
  revoked_at timestamptz,
  revoked_reason text,
  /**
   * A revoked device may still WRITE until this passes, so its final push can
   * save whatever it never synced before it wipes. Reads stay open too — an
   * evacuation that could not read the rows it is pushing would push nothing.
   */
  evacuation_until timestamptz,
  primary key (user_id, device_id)
);

/**
 * The invariant, in the schema rather than only in the function that maintains
 * it: at most one unrevoked device per account. A bug in `claim_device` that
 * forgot to revoke the previous holder would otherwise produce two live devices
 * and no error, which is the failure this whole file exists to prevent.
 */
create unique index if not exists user_devices_one_active_idx
  on public.user_devices (user_id) where revoked_at is null;

alter table public.user_devices enable row level security;

/**
 * Readable by its subject, and deliberately NOT gated on
 * `may_access_own_data()` — for the same reason 0019 leaves `device_commands`
 * ungated. A revoked device has to be able to read the row that says it was
 * revoked, and that is precisely the moment the gate is closed against it. A
 * gated policy here would produce a device that is locked out with no way to
 * discover why.
 */
create policy "user_devices_read_own" on public.user_devices
  for select using (user_id = (select auth.uid()));

-- No insert or update policy. Every write goes through the functions below, so
-- a client cannot un-revoke itself or forge a claim by writing the row directly.

-- ===========================================================================
-- 2. IDENTIFYING THE CALLER'S DEVICE
-- ===========================================================================

/**
 * The device id this request carries, or null.
 *
 * Separate from 0014's `request_device_id()`, which reads `x-admin-device` and
 * belongs to the admin origin allowlist. Sharing one header between "this is my
 * phone" and "this laptop may use admin powers" would mean any user's phone id
 * could be presented as an admin origin, so the two stay distinct.
 */
create or replace function public.request_lifeos_device()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return nullif(trim(current_setting('request.headers', true)::json ->> 'x-lifeos-device'), '');
exception
  when others then
    -- No request context at all (a psql session, a cron job). Not an error;
    -- there simply is no device.
    return null;
end;
$$;

/**
 * Whether the caller's session was established — or re-established — with a
 * one-time email code recently enough to authorise taking the account over.
 *
 * Read from the JWT's `amr` claim, which GoTrue writes at authentication time
 * and which survives token refresh with its ORIGINAL timestamp. That is the
 * property that makes this a proof rather than a checkbox: the client cannot
 * mint it, cannot refresh it into freshness, and cannot replay it past the
 * window. Password and OAuth methods are excluded on purpose — the point of
 * the code is to prove control of the mailbox, which a stored password on the
 * new phone does not.
 *
 * Returns 'fresh', 'stale', or 'unverifiable'.
 *
 * 'unverifiable' means the JWT carries no `amr` claim at all, which no current
 * hosted GoTrue does. Callers treat it as permission rather than refusal, and
 * record that they did. Refusing instead would brick every takeover on a
 * deployment whose auth server does not populate the claim — locking a user out
 * of their own account on their own phone, to defend against an attacker who by
 * construction is the account owner.
 */
create or replace function public.otp_proof_age(p_within interval default interval '15 minutes')
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_amr jsonb;
  v_entry jsonb;
begin
  v_amr := auth.jwt() -> 'amr';
  if v_amr is null or jsonb_typeof(v_amr) <> 'array' then
    return 'unverifiable';
  end if;

  for v_entry in select * from jsonb_array_elements(v_amr) loop
    if (v_entry ->> 'method') in ('otp', 'magiclink', 'email/otp', 'recovery')
       and to_timestamp((v_entry ->> 'timestamp')::numeric) > now() - p_within then
      return 'fresh';
    end if;
  end loop;

  return 'stale';
exception
  when others then
    -- A malformed claim is not a licence. 'stale' sends the caller through the
    -- code flow, which is the safe direction to fail in.
    return 'stale';
end;
$$;

/**
 * Whether the device making this request is the one holding the account.
 *
 * STABLE, and every branch is an index lookup on `user_devices_one_active_idx`
 * or the primary key, because this ends up inside the qualifier of every synced
 * table's policy — the same constraint 0017 and 0019 were written under.
 */
create or replace function public.device_may_sync()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- Bootstrap: an account with no active device is unrestricted. See the
    -- header — this is 0014's empty-allowlist rule, for the same reason.
    not exists (
      select 1 from public.user_devices d
       where d.user_id = auth.uid()
         and d.revoked_at is null
    )
    or exists (
      select 1 from public.user_devices d
       where d.user_id = auth.uid()
         and d.device_id = public.request_lifeos_device()
         and (
           d.revoked_at is null
           or (d.evacuation_until is not null and d.evacuation_until > now())
         )
    );
$$;

-- ===========================================================================
-- 3. THE GATE ITSELF
-- ===========================================================================

/**
 * 0019's function, with the device check folded in.
 *
 * Replaced rather than re-policied: every synced table's owner policy already
 * calls this by name, so changing the body changes the rule everywhere at once
 * and there is no list of tables here to fall out of date — which is the same
 * mistake 0020 and the delete-account function were written to stop repeating.
 */
create or replace function public.may_access_own_data()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and (
       public.is_active(auth.uid())
       or exists (
         select 1 from public.account_status s
          where s.user_id = auth.uid()
            and s.evacuation_until is not null
            and s.evacuation_until > now()
       )
     )
     and public.device_may_sync();
$$;

-- ===========================================================================
-- 4. COMMANDS AIMED AT ONE DEVICE
-- ===========================================================================

/**
 * 0019's queue was per-account, which was right when the only issuer was a
 * moderator blocking the whole account. A takeover has to wipe the OLD phone
 * and not the new one, so a command now optionally names its target.
 *
 * Null still means "every device belonging to this account", so
 * `admin_block_user` and `admin_wipe_user_device` keep their existing meaning
 * without being touched.
 */
alter table public.device_commands
  add column if not exists device_id text;

create index if not exists device_commands_device_idx
  on public.device_commands (user_id, device_id) where acked_at is null;

-- Replaced, not overloaded: a zero-argument version alongside one with a
-- defaulted argument is ambiguous, and Postgres refuses the call rather than
-- picking. Dropping first is what makes the new signature reachable.
drop function if exists public.pending_device_commands();

/**
 * Outstanding commands for the caller's own account, narrowed to those this
 * device should act on.
 *
 * A device that sends no id sees only account-wide commands. That is the
 * conservative reading: acting on another device's wipe order because the
 * header was missing would delete the wrong phone's data.
 */
create or replace function public.pending_device_commands(p_device_id text default null)
returns table (id uuid, command text, detail jsonb, issued_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.command, c.detail, c.issued_at
    from public.device_commands c
   where c.user_id = auth.uid()
     and c.acked_at is null
     and (c.expires_at is null or c.expires_at > now())
     and (c.device_id is null or c.device_id = p_device_id)
   order by c.issued_at asc;
$$;

-- ===========================================================================
-- 5. CLAIMING, TAKING OVER, RELEASING
-- ===========================================================================

/**
 * Registers this device as the one holding the account.
 *
 * Three outcomes, and the middle one is the feature:
 *
 *   'claimed'      — nothing else held the account (or this device already did).
 *                    No code needed: moving to a new phone after signing out of
 *                    the old one must not cost the user an email round trip.
 *   'otp_required' — another device holds it, and this session has not proved
 *                    control of the mailbox. The caller sends a code, verifies
 *                    it, and calls back with `p_take_over => true`.
 *   'claimed'      — with `takeOver: true` in the payload: the previous device
 *                    is revoked, its evacuation window opened, and its wipe
 *                    queued.
 *
 * Idempotent in the case that matters most: a device re-claiming what it
 * already holds only touches `last_seen_at`, so this is safe to call on every
 * launch and every foreground.
 */
create or replace function public.claim_device(
  p_device_id text,
  p_label text default null,
  p_platform text default null,
  p_take_over boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_other public.user_devices%rowtype;
  v_has_other boolean;
  v_proof text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;
  -- Long enough that a truncated or empty header cannot be presented as a
  -- device id and quietly claim the account.
  if p_device_id is null or length(trim(p_device_id)) < 16 then
    raise exception 'a device id is required' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_other
    from public.user_devices
   where user_id = v_uid
     and revoked_at is null
     and device_id <> p_device_id
   limit 1;
  v_has_other := found;

  if v_has_other then
    if not coalesce(p_take_over, false) then
      return jsonb_build_object(
        'status', 'otp_required',
        'otherDevice', jsonb_build_object(
          'label', v_other.label,
          'platform', v_other.platform,
          'lastSeenAt', v_other.last_seen_at
        )
      );
    end if;

    v_proof := public.otp_proof_age();
    if v_proof = 'stale' then
      return jsonb_build_object(
        'status', 'otp_required',
        'otherDevice', jsonb_build_object(
          'label', v_other.label,
          'platform', v_other.platform,
          'lastSeenAt', v_other.last_seen_at
        )
      );
    end if;

    -- Revoke every other holder. Written as a set operation rather than
    -- against `v_other` alone so a roster that somehow holds two active rows
    -- is repaired here instead of leaving one behind forever.
    update public.user_devices
       set revoked_at = v_now,
           revoked_reason = 'signed_in_elsewhere',
           evacuation_until = v_now + interval '15 minutes'
     where user_id = v_uid
       and revoked_at is null
       and device_id <> p_device_id;

    -- One outstanding wipe per device. Without this, three takeovers in a row
    -- leave three commands and the old phone wipes, acks, and wipes again.
    delete from public.device_commands
     where user_id = v_uid
       and command = 'wipe_local'
       and acked_at is null
       and device_id is not null
       and device_id <> p_device_id;

    insert into public.device_commands (user_id, device_id, command, detail, issued_by, expires_at)
    select v_uid, d.device_id, 'wipe_local',
           jsonb_build_object(
             'reason', 'signed_in_elsewhere',
             'claimedBy', coalesce(nullif(trim(p_label), ''), 'another device'),
             'claimedAt', v_now,
             'evacuationUntil', v_now + interval '15 minutes',
             'otpProof', v_proof
           ),
           v_uid,
           -- Outlives any plausible "the old phone was in a drawer" gap. A
           -- command that expired before the device ever came back would leave
           -- the data sitting there permanently.
           v_now + interval '365 days'
      from public.user_devices d
     where d.user_id = v_uid
       and d.device_id <> p_device_id
       and d.revoked_reason = 'signed_in_elsewhere'
       and d.revoked_at = v_now;
  end if;

  -- Claim. `on conflict` covers both the returning device (reactivating a row
  -- it was revoked from) and the ordinary heartbeat.
  insert into public.user_devices (user_id, device_id, label, platform)
  values (v_uid, p_device_id, nullif(trim(p_label), ''), nullif(trim(p_platform), ''))
  on conflict (user_id, device_id) do update
     set label = coalesce(nullif(trim(p_label), ''), public.user_devices.label),
         platform = coalesce(nullif(trim(p_platform), ''), public.user_devices.platform),
         last_seen_at = v_now,
         claimed_at = case when public.user_devices.revoked_at is not null
                           then v_now else public.user_devices.claimed_at end,
         revoked_at = null,
         revoked_reason = null,
         evacuation_until = null;

  return jsonb_build_object(
    'status', 'claimed',
    'takeOver', v_has_other,
    'otpProof', v_proof
  );
end;
$$;

/**
 * What this device's standing is, without claiming anything.
 *
 * Doubles as the heartbeat — an active device's `last_seen_at` is refreshed
 * here — so the "you're signed in on X, last used 2 hours ago" line the
 * takeover screen shows is true rather than frozen at first sign-in.
 */
create or replace function public.device_status(p_device_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_self public.user_devices%rowtype;
  v_active public.user_devices%rowtype;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select * into v_active
    from public.user_devices
   where user_id = v_uid and revoked_at is null
   limit 1;

  if p_device_id is null then
    return jsonb_build_object('status', 'unknown');
  end if;

  select * into v_self
    from public.user_devices
   where user_id = v_uid and device_id = p_device_id;

  if not found then
    return jsonb_build_object(
      'status', 'unknown',
      'activeDevice', case when v_active.device_id is null then null else jsonb_build_object(
        'label', v_active.label, 'platform', v_active.platform,
        'lastSeenAt', v_active.last_seen_at) end
    );
  end if;

  if v_self.revoked_at is null then
    update public.user_devices
       set last_seen_at = v_now
     where user_id = v_uid and device_id = p_device_id;
    return jsonb_build_object('status', 'active');
  end if;

  return jsonb_build_object(
    'status', 'revoked',
    'revokedAt', v_self.revoked_at,
    'revokedReason', v_self.revoked_reason,
    'evacuationUntil', v_self.evacuation_until,
    'activeDevice', case when v_active.device_id is null then null else jsonb_build_object(
      'label', v_active.label, 'platform', v_active.platform,
      'lastSeenAt', v_active.last_seen_at) end
  );
end;
$$;

/**
 * Gives the account up voluntarily — what an ordinary sign-out calls.
 *
 * This is what keeps the feature from being an obstacle course. Without it,
 * every user who signs out on one phone and in on another is met by a code
 * prompt for a "device" that is not signed in anywhere, and the honest majority
 * pays a round trip for a case that only exists when they forgot to sign out.
 *
 * No wipe command is queued: the device doing this wipes itself locally on the
 * way out, and queueing an order for a device that is about to stop asking for
 * orders would just leave an unacked row behind forever.
 */
create or replace function public.release_device(p_device_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;
  if p_device_id is null then
    return;
  end if;

  update public.user_devices
     set revoked_at = now(),
         revoked_reason = 'signed_out',
         evacuation_until = null
   where user_id = v_uid
     and device_id = p_device_id
     and revoked_at is null;

  delete from public.device_commands
   where user_id = v_uid
     and device_id = p_device_id
     and acked_at is null;
end;
$$;

/**
 * Revokes every device and queues a wipe for each — what account deletion
 * calls before the auth user goes away.
 *
 * Best-effort by nature: a device that never comes back online before the
 * cascade removes these rows never sees the order. It still loses all cloud
 * access the moment the account is deleted, and this covers the window in
 * between, which is the part that is actually reachable.
 */
create or replace function public.revoke_all_devices(p_reason text default 'account_deleted')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  delete from public.device_commands
   where user_id = v_uid and command = 'wipe_local' and acked_at is null;

  insert into public.device_commands (user_id, device_id, command, detail, issued_by, expires_at)
  select v_uid, d.device_id, 'wipe_local',
         jsonb_build_object('reason', coalesce(nullif(trim(p_reason), ''), 'account_deleted')),
         v_uid, now() + interval '365 days'
    from public.user_devices d
   where d.user_id = v_uid;

  update public.user_devices
     set revoked_at = coalesce(revoked_at, now()),
         revoked_reason = coalesce(nullif(trim(p_reason), ''), 'account_deleted'),
         evacuation_until = null
   where user_id = v_uid;
end;
$$;

-- ===========================================================================
-- 6. PRIVILEGES
-- ===========================================================================

revoke all on function public.request_lifeos_device() from public, anon;
revoke all on function public.otp_proof_age(interval) from public, anon;
revoke all on function public.claim_device(text, text, text, boolean) from public, anon;
revoke all on function public.device_status(text) from public, anon;
revoke all on function public.release_device(text) from public, anon;
revoke all on function public.revoke_all_devices(text) from public, anon;

grant execute on function public.claim_device(text, text, text, boolean) to authenticated;
grant execute on function public.device_status(text) to authenticated;
grant execute on function public.release_device(text) to authenticated;
grant execute on function public.revoke_all_devices(text) to authenticated;
grant execute on function public.pending_device_commands(text) to authenticated;

-- `device_may_sync` and `may_access_own_data` are evaluated inside policies,
-- which run with the querying user's rights — so they MUST be executable by
-- `authenticated`, exactly as 0019 notes for the latter. Neither takes an
-- argument, so neither can be used to ask about an account other than the
-- caller's own.
revoke all on function public.device_may_sync() from public;
grant execute on function public.device_may_sync() to authenticated, anon;
grant execute on function public.may_access_own_data() to authenticated, anon;

grant select on public.user_devices to authenticated;
