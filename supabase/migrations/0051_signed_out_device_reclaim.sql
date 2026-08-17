-- ---------------------------------------------------------------------------
-- 0051 — Signing out must not lock a device out of signing back in.
--
-- The bug
-- -------
-- 0047 gives a device two ways to lose the account, and `device_status` could
-- not tell them apart:
--
--   'signed_in_elsewhere' — another device took it. This device is locked out,
--                           owes the user an explanation, and wipes itself.
--   'signed_out'          — this device let go of it, voluntarily, on an
--                           ordinary sign-out.
--
-- Both leave `revoked_at` set, and `device_status` reported both as 'revoked'.
-- So the sequence every user performs — sign in, sign out, sign in again on the
-- same phone — came back as "your account was opened on another device", wiped
-- the phone, and signed them straight back out. No second device involved.
--
-- The fix
-- -------
-- A row this device released itself is not a revocation of this device; it is
-- the absence of a claim. Reported as 'unknown', which is exactly what the
-- client already handles by claiming — and `claim_device` reactivates the row
-- (`on conflict … set revoked_at = null`), so the ordinary case costs nothing.
--
-- If somebody else HAS claimed the account since, nothing is weakened: the
-- claim that follows still meets the active device, still answers
-- 'otp_required', and still demands the one-time code. The only thing removed
-- is a lockout screen shown for an event that did not happen.
-- ---------------------------------------------------------------------------

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
  v_active_json jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select * into v_active
    from public.user_devices
   where user_id = v_uid and revoked_at is null
   limit 1;

  v_active_json := case when v_active.device_id is null then null else jsonb_build_object(
    'label', v_active.label,
    'platform', v_active.platform,
    'lastSeenAt', v_active.last_seen_at) end;

  if p_device_id is null then
    return jsonb_build_object('status', 'unknown');
  end if;

  select * into v_self
    from public.user_devices
   where user_id = v_uid and device_id = p_device_id;

  if not found then
    return jsonb_build_object('status', 'unknown', 'activeDevice', v_active_json);
  end if;

  if v_self.revoked_at is null then
    update public.user_devices
       set last_seen_at = v_now
     where user_id = v_uid and device_id = p_device_id;
    return jsonb_build_object('status', 'active');
  end if;

  -- Released by this device, on its own sign-out. Answered as though the
  -- device were simply not on the roster — because as far as the rule is
  -- concerned it is not. The client claims, and either gets the account back
  -- (nothing else holds it) or is sent through the code flow (something does).
  -- `revokedReason` still rides along so a client can tell the two apart
  -- without a second round trip.
  if v_self.revoked_reason = 'signed_out' then
    return jsonb_build_object(
      'status', 'unknown',
      'revokedReason', v_self.revoked_reason,
      'activeDevice', v_active_json
    );
  end if;

  return jsonb_build_object(
    'status', 'revoked',
    'revokedAt', v_self.revoked_at,
    'revokedReason', v_self.revoked_reason,
    'evacuationUntil', v_self.evacuation_until,
    'activeDevice', v_active_json
  );
end;
$$;

-- `create or replace` keeps existing privileges; restated so a database built
-- from this file in isolation is not left with an unexecutable function.
revoke all on function public.device_status(text) from public, anon;
grant execute on function public.device_status(text) to authenticated;
