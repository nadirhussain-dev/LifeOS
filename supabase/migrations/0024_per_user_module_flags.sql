-- 0024 — Per-account module overrides on top of 0011's global switches.
--
-- 0011 gave the operator one switch per module, for everybody at once. That is
-- the right shape for the thing it was built for — a module that corrupts data
-- gets pulled from every device before the next app-store round trip — and the
-- wrong shape for the two cases that come up far more often:
--
--   * a staged rollout, where a new module is on for fifty accounts before it is
--     on for fifty thousand;
--   * a support fix, where one account is hitting a bug in one module and the
--     answer is to turn that module off for them, not for everyone.
--
-- Both were previously "flip the global switch and take the feature away from
-- every user", which is why neither happened.
--
-- ## The merge rule
--
-- A user override wins. Absence falls through to the global flag. Absence of
-- both means enabled — the same fail-open rule 0011 established and
-- `features/module-flags/store/module-flags-store.ts` mirrors on the client,
-- because "we have never heard from the server" and "the server says everything
-- is fine" have to be the same state or a network blip strips somebody's app
-- bare.
--
-- The override is a full tri-state, not a boolean: `enabled` true, `enabled`
-- false, or no row. Without the middle one there is no way to say "on for this
-- account" while the global switch is off, which is exactly what a staged
-- rollout is.

create table if not exists public.module_flags_user (
  user_id uuid not null references auth.users (id) on delete cascade,
  module text not null,
  enabled boolean not null,
  /** Why. Read by nobody in the app — this is for the operator six months on. */
  note text,
  updated_at timestamptz not null default now(),
  primary key (user_id, module)
);

alter table public.module_flags_user enable row level security;

-- A user may read their own overrides, because the client has to merge them.
-- `(select auth.uid())` for 0017's InitPlan reason.
drop policy if exists module_flags_user_read_own on public.module_flags_user;
create policy module_flags_user_read_own on public.module_flags_user
  for select using (user_id = (select auth.uid()));

-- No write policy for anybody. Overrides are operator state; a user who can
-- switch their own modules back on has an override that means nothing.

-- ---------------------------------------------------------------------------
-- The merged view the client actually reads.
-- ---------------------------------------------------------------------------

/**
 * Every module switched off for this caller, and why, merging both layers.
 *
 * Returns only the *overrides* — modules with no entry are enabled. That keeps
 * the payload proportional to the number of things that are wrong rather than
 * to the number of modules, and it is what lets the client treat an empty
 * response and a failed request identically.
 *
 * A user override wins outright, including when it re-enables a module the
 * global switch disabled. That is the staged-rollout case and it is deliberate:
 * an operator who wants a module off for everybody with no exceptions turns the
 * global switch off and deletes the overrides.
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
  where coalesce(u.user_id, (select auth.uid())) = (select auth.uid())
    and coalesce(u.enabled, g.enabled) = false;
$$;

revoke all on function public.my_module_flags() from public, anon;
grant execute on function public.my_module_flags() to authenticated;
grant select on public.module_flags_user to authenticated;

-- ---------------------------------------------------------------------------
-- Operator entry point. Admin only, audited, same shape as 0011's global setter.
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_user_module(
  p_user_id uuid,
  p_module text,
  p_enabled boolean,
  p_note text
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

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (
    auth.uid(),
    'set_user_module',
    p_user_id,
    jsonb_build_object('module', p_module, 'enabled', p_enabled, 'note', p_note)
  );

  insert into public.module_flags_user (user_id, module, enabled, note, updated_at)
  values (p_user_id, p_module, p_enabled, p_note, now())
  on conflict (user_id, module) do update
    set enabled = excluded.enabled,
        note = excluded.note,
        updated_at = now();
end;
$$;

/** Removes an override, dropping the account back to the global switch. */
create or replace function public.admin_clear_user_module(p_user_id uuid, p_module text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'clear_user_module', p_user_id, jsonb_build_object('module', p_module));

  delete from public.module_flags_user where user_id = p_user_id and module = p_module;
end;
$$;

revoke all on function public.admin_set_user_module(uuid, text, boolean, text) from public, anon;
revoke all on function public.admin_clear_user_module(uuid, text) from public, anon;
grant execute on function public.admin_set_user_module(uuid, text, boolean, text) to authenticated;
grant execute on function public.admin_clear_user_module(uuid, text) to authenticated;
