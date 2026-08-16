-- ---------------------------------------------------------------------------
-- 0013 — Profile pictures, and reporting shared content.
--
-- Two halves of the same decision: Daykeep keeps end-to-end encryption, and gets
-- its abuse handling from reports rather than from operator access.
--
-- Why reporting instead of reading everything
-- -------------------------------------------
-- The operator cannot read a user's vault — the keys never leave the device
-- (features/private/services/vault-keys.ts). That is a deliberate property, and
-- it costs nothing in abuse prevention, because *the private modules are
-- single-user*. Nobody has ever been harmed by another person's period tracker.
-- Harm needs a shared surface, and on a shared surface there is always somebody
-- who can already see the content: the recipient.
--
-- So the report carries the evidence. When somebody reports an item, the client
-- attaches the decrypted item it is looking at, and that single item — not the
-- key, not the sender's other content — becomes readable by the operator. The
-- escrow is scoped to exactly what was complained about, created at the moment
-- of the complaint, by somebody who already had access.
--
-- This is strictly more useful than blanket access, too: a report says *which*
-- item is a problem and why, where a vault dump says nothing at all.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. PROFILE PICTURES
-- ===========================================================================

-- Path within the `avatars` storage bucket, not a URL: the bucket may be made
-- private later without every stored row becoming a dead link.
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists avatar_updated_at bigint;

-- ===========================================================================
-- 2. REPORTS
-- ===========================================================================

create table if not exists public.content_reports (
  id text primary key,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  -- Nullable: the reported party may have deleted their account, and the report
  -- has to survive that or the record of what happened disappears with them.
  reported_user_id uuid references auth.users(id) on delete set null,
  -- Where it came from: 'expense_group' today, 'shared_space' once sharing
  -- ships. Untyped so a new surface does not need DDL to become reportable.
  surface text not null,
  surface_id text,
  reason text not null check (
    reason in ('spam', 'harassment', 'sexual_content', 'impersonation', 'other')
  ),
  note text,
  /**
   * The evidence, in the clear.
   *
   * This is the ONLY place user content becomes readable by the operator, and
   * it gets here by one route: somebody who could already see it chose to
   * attach it to a complaint. Written once at report time and never updated —
   * a mutable evidence field is not evidence.
   */
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolution text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists content_reports_status_idx
  on public.content_reports (status, created_at desc);
create index if not exists content_reports_reported_idx
  on public.content_reports (reported_user_id);

alter table public.content_reports enable row level security;

-- You may read what you reported, so the app can say "you already reported
-- this" rather than inviting a second identical complaint. You may never read
-- reports about yourself: telling somebody who reported them is how a reporter
-- gets retaliated against.
create policy "content_reports_read_own" on public.content_reports
  for select using (reporter_id = auth.uid());

-- ===========================================================================
-- 3. FUNCTIONS
-- ===========================================================================

-- Files a report. SECURITY DEFINER because the reporter must not be able to
-- write `status`, `resolution` or somebody else's `reporter_id`.
create or replace function public.submit_content_report(
  p_report_id text,
  p_reported_user_id uuid,
  p_surface text,
  p_surface_id text,
  p_reason text,
  p_note text,
  p_evidence jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_recent integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if p_reported_user_id = v_uid then
    raise exception 'cannot report yourself' using errcode = 'invalid_parameter_value';
  end if;

  -- Reporting is itself abusable: a brigade filing hundreds of reports is a
  -- denial-of-service on the operator's attention, and on the accused.
  select count(*) into v_recent
    from public.content_reports r
   where r.reporter_id = v_uid
     and r.created_at > now() - interval '1 hour';
  if v_recent >= 20 then
    raise exception 'too many reports' using errcode = 'check_violation';
  end if;

  insert into public.content_reports (
    id, reporter_id, reported_user_id, surface, surface_id, reason, note, evidence
  ) values (
    p_report_id,
    v_uid,
    p_reported_user_id,
    p_surface,
    p_surface_id,
    p_reason,
    nullif(trim(coalesce(p_note, '')), ''),
    coalesce(p_evidence, '{}'::jsonb)
  )
  on conflict (id) do nothing;

  return p_report_id;
end;
$$;

create or replace function public.admin_list_reports(p_status text, p_limit integer)
returns table (
  id text,
  reporter_id uuid,
  reported_user_id uuid,
  surface text,
  surface_id text,
  reason text,
  note text,
  evidence jsonb,
  status text,
  created_at timestamptz,
  reports_against bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  return query
    select r.id, r.reporter_id, r.reported_user_id, r.surface, r.surface_id,
           r.reason, r.note, r.evidence, r.status, r.created_at,
           -- How many times this account has been reported at all. One report
           -- is a disagreement; twenty from different people is a pattern, and
           -- that difference is the whole judgement.
           (select count(*) from public.content_reports o
             where o.reported_user_id = r.reported_user_id)
      from public.content_reports r
     where p_status is null or r.status = p_status
     order by r.created_at desc
     limit least(coalesce(p_limit, 100), 500);
end;
$$;

create or replace function public.admin_resolve_report(
  p_report_id text,
  p_status text,
  p_resolution text
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
  if p_status not in ('actioned', 'dismissed') then
    raise exception 'invalid status' using errcode = 'invalid_parameter_value';
  end if;

  update public.content_reports
     set status = p_status,
         resolution = nullif(trim(coalesce(p_resolution, '')), ''),
         resolved_by = auth.uid(),
         resolved_at = now()
   where id = p_report_id;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  select auth.uid(), 'resolve_report', r.reported_user_id,
         jsonb_build_object('report_id', p_report_id, 'status', p_status)
    from public.content_reports r
   where r.id = p_report_id;
end;
$$;

-- ===========================================================================
-- 4. GRANTS
-- ===========================================================================

revoke all on function public.submit_content_report(text, uuid, text, text, text, text, jsonb)
  from public, anon;
grant execute on function public.submit_content_report(text, uuid, text, text, text, text, jsonb)
  to authenticated;

revoke all on function public.admin_list_reports(text, integer) from public, anon;
revoke all on function public.admin_resolve_report(text, text, text) from public, anon;
grant execute on function public.admin_list_reports(text, integer) to authenticated;
grant execute on function public.admin_resolve_report(text, text, text) to authenticated;
