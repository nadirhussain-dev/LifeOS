import { supabase } from '@/lib/supabase';

/**
 * The operator surface, as the app sees it.
 *
 * Every function here is a thin call onto an RPC that already existed and was
 * only ever reachable from the SQL editor. Nothing new is granted: the report
 * gate (0018), the admin/staff split, the origin allowlist (0014) and the audit
 * rows all live in the database, which is the right place for them — a console
 * that enforced its own permissions would be a console anyone could reimplement
 * with `curl`.
 *
 * So this is a *view*, not a privilege boundary. Every failure below is the
 * server saying no, and is surfaced as such.
 */

export type ReportQueueEntry = {
  reportedUserId: string;
  displayName: string | null;
  username: string | null;
  openReports: number;
  latestReason: string | null;
  latestAt: string | null;
};

export type OperatorReport = {
  id: string;
  surface: string;
  surfaceId: string | null;
  reason: string;
  note: string | null;
  status: string;
  resolution: string | null;
  createdAt: string;
};

export type UserDetail = {
  userId: string;
  email: string | null;
  username: string | null;
  displayName: string | null;
  status: string;
  statusReason: string | null;
  statusExpiresAt: string | null;
  statusAuto: boolean;
};

export type OperatorRole = 'staff' | 'admin';

export type Operator = {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: OperatorRole;
  isOwner: boolean;
  createdAt: string;
};

export type OperatorResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Whether this account can see any of it. Anything other than a clean `true`
 *  is treated as no — an error here means the question could not be answered,
 *  and a console that opens on an unanswered permission check is a console that
 *  will eventually open for the wrong person. */
export async function isOperator(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_staff');
  return !error && data === true;
}

/** Same "anything but a clean true is no" discipline as `isOperator` — gates
 *  the Operators (roster) and Pricing sections, and every mutation in
 *  operator.tsx that would otherwise surface as a raw RPC rejection. */
export async function isOwner(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_owner');
  return !error && data === true;
}

/**
 * Whether the app has ever been claimed. Failing this open (assuming an
 * owner already exists) is the safe direction: worst case the claim row
 * stays hidden a little longer, rather than a transient error offering a
 * claim that `claim_owner()` would refuse anyway.
 */
export async function hasOwner(): Promise<boolean> {
  const { data, error } = await supabase.rpc('admin_has_owner');
  return error ? true : data === true;
}

export async function claimOwner(): Promise<OperatorResult<null>> {
  const { error } = await supabase.rpc('claim_owner');
  return error ? { ok: false, error: friendly(error.message) } : { ok: true, data: null };
}

export async function fetchReportQueue(limit = 50): Promise<OperatorResult<ReportQueueEntry[]>> {
  const { data, error } = await supabase.rpc('operator_report_queue', { p_limit: limit });
  if (error) return { ok: false, error: friendly(error.message) };

  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    ok: true,
    data: rows.map((row) => ({
      reportedUserId: String(row.reported_user_id ?? ''),
      displayName: (row.display_name as string | null) ?? null,
      username: (row.username as string | null) ?? null,
      openReports: Number(row.open_reports ?? 0),
      latestReason: (row.latest_reason as string | null) ?? null,
      latestAt: (row.latest_at as string | null) ?? null,
    })),
  };
}

/**
 * One account's reports.
 *
 * `reason` is required by the RPC and written to the audit log before anything
 * is returned — staff can only reach an account while a live report names it
 * (0018), and every look is recorded either way. The console asks for the reason
 * rather than inventing one, because an audit trail of "viewed from console" is
 * an audit trail of nothing.
 */
export async function fetchUserReports(
  userId: string,
  reason: string,
): Promise<OperatorResult<OperatorReport[]>> {
  const { data, error } = await supabase.rpc('operator_user_reports', {
    p_user_id: userId,
    p_reason: reason,
  });
  if (error) return { ok: false, error: friendly(error.message) };

  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    ok: true,
    data: rows.map((row) => ({
      id: String(row.id ?? ''),
      surface: String(row.surface ?? ''),
      surfaceId: (row.surface_id as string | null) ?? null,
      reason: String(row.reason ?? ''),
      note: (row.note as string | null) ?? null,
      status: String(row.status ?? ''),
      resolution: (row.resolution as string | null) ?? null,
      createdAt: String(row.created_at ?? ''),
    })),
  };
}

export async function resolveReport(
  reportId: string,
  status: 'actioned' | 'dismissed',
  resolution: string,
): Promise<OperatorResult<null>> {
  const { error } = await supabase.rpc('admin_resolve_report', {
    p_report_id: reportId,
    p_status: status,
    p_resolution: resolution,
  });
  return error ? { ok: false, error: friendly(error.message) } : { ok: true, data: null };
}

export async function setAccountStatus(
  userId: string,
  status: 'active' | 'restricted' | 'blocked',
  reason: string,
  expiresAt: string | null,
): Promise<OperatorResult<null>> {
  const { error } = await supabase.rpc('admin_set_account_status', {
    p_user_id: userId,
    p_status: status,
    p_reason: reason,
    p_expires_at: expiresAt,
  });
  return error ? { ok: false, error: friendly(error.message) } : { ok: true, data: null };
}

export async function setModuleEnabled(
  module: string,
  enabled: boolean,
  message: string | null,
): Promise<OperatorResult<null>> {
  const { error } = await supabase.rpc('admin_set_module_enabled', {
    p_module: module,
    p_enabled: enabled,
    p_message: message,
  });
  return error ? { ok: false, error: friendly(error.message) } : { ok: true, data: null };
}

/** Admin-tier only (0024) — a per-account override of a module switch,
 *  independent of the global one `setModuleEnabled` touches. */
export async function setUserModule(
  userId: string,
  module: string,
  enabled: boolean,
  note: string | null,
): Promise<OperatorResult<null>> {
  const { error } = await supabase.rpc('admin_set_user_module', {
    p_user_id: userId,
    p_module: module,
    p_enabled: enabled,
    p_note: note,
  });
  return error ? { ok: false, error: friendly(error.message) } : { ok: true, data: null };
}

/** Drops the override, returning the account to whatever the global switch says. */
export async function clearUserModule(
  userId: string,
  module: string,
): Promise<OperatorResult<null>> {
  const { error } = await supabase.rpc('admin_clear_user_module', {
    p_user_id: userId,
    p_module: module,
  });
  return error ? { ok: false, error: friendly(error.message) } : { ok: true, data: null };
}

/**
 * Full account detail — admin-tier only (0012), unlike `fetchUserReports`,
 * which staff can reach while a report is live. Every call is audited
 * server-side on view, the same as `fetchUserReports`.
 */
export async function fetchUserDetail(userId: string): Promise<OperatorResult<UserDetail>> {
  const { data, error } = await supabase.rpc('admin_user_detail', { p_user_id: userId });
  if (error) return { ok: false, error: friendly(error.message) };

  const row = ((data ?? [])[0] ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    data: {
      userId: String(row.user_id ?? userId),
      email: (row.email as string | null) ?? null,
      username: (row.username as string | null) ?? null,
      displayName: (row.display_name as string | null) ?? null,
      status: String(row.status ?? 'active'),
      statusReason: (row.status_reason as string | null) ?? null,
      statusExpiresAt: (row.status_expires_at as string | null) ?? null,
      statusAuto: row.status_auto === true,
    },
  };
}

export type UserDirectoryRow = {
  userId: string;
  email: string | null;
  username: string | null;
  displayName: string | null;
  createdAt: string;
  lastActive: string | null;
  status: string;
  modulesUsed: number;
  groupsJoined: number;
  devices: number;
};

/**
 * The full account directory — admin-tier only (0012's `admin_list_users`).
 *
 * `fetchUserDetail`/`fetchUserReports` above only ever open an account the
 * report queue already pointed at; this is the other way in, for the account
 * nobody has reported. Same audit trail either way — 0012's own comment says
 * every call here is logged server-side on view, the same as a report-driven
 * open.
 */
export async function listUsers(
  search: string,
  limit = 50,
  offset = 0,
): Promise<OperatorResult<UserDirectoryRow[]>> {
  const { data, error } = await supabase.rpc('admin_list_users', {
    p_search: search.trim() || null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) return { ok: false, error: friendly(error.message) };

  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    ok: true,
    data: rows.map((row) => ({
      userId: String(row.user_id ?? ''),
      email: (row.email as string | null) ?? null,
      username: (row.username as string | null) ?? null,
      displayName: (row.display_name as string | null) ?? null,
      createdAt: String(row.created_at ?? ''),
      lastActive: (row.last_active as string | null) ?? null,
      status: String(row.status ?? 'active'),
      modulesUsed: Number(row.modules_used ?? 0),
      groupsJoined: Number(row.groups_joined ?? 0),
      devices: Number(row.devices ?? 0),
    })),
  };
}

// --- roster (owner-only mutations; any operator may list) -------------------

export async function listOperators(): Promise<OperatorResult<Operator[]>> {
  const { data, error } = await supabase.rpc('admin_list_operators');
  if (error) return { ok: false, error: friendly(error.message) };

  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    ok: true,
    data: rows.map((row) => ({
      userId: String(row.user_id ?? ''),
      email: (row.email as string | null) ?? null,
      displayName: (row.display_name as string | null) ?? null,
      role: (row.role as OperatorRole) ?? 'staff',
      isOwner: row.is_owner === true,
      createdAt: String(row.created_at ?? ''),
    })),
  };
}

export async function addOperator(
  email: string,
  role: OperatorRole,
): Promise<OperatorResult<null>> {
  const { error } = await supabase.rpc('admin_add_operator', { p_email: email, p_role: role });
  return error ? { ok: false, error: friendly(error.message) } : { ok: true, data: null };
}

export async function setOperatorRole(
  userId: string,
  role: OperatorRole,
): Promise<OperatorResult<null>> {
  const { error } = await supabase.rpc('admin_set_operator_role', {
    p_user_id: userId,
    p_role: role,
  });
  return error ? { ok: false, error: friendly(error.message) } : { ok: true, data: null };
}

export async function removeOperator(userId: string): Promise<OperatorResult<null>> {
  const { error } = await supabase.rpc('admin_remove_operator', { p_user_id: userId });
  return error ? { ok: false, error: friendly(error.message) } : { ok: true, data: null };
}

// --- coupons (owner-only; 0045) ---------------------------------------------
//
// Moves real money, so gated on `is_owner()` in the database, same as the
// roster above — not merely `is_admin()`. This is a view over those RPCs,
// same discipline the rest of this file already follows.

export type Coupon = {
  id: string;
  code: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  durationCycles: number;
  maxRedemptions: number | null;
  redemptionsCount: number;
  startsAt: number;
  endsAt: number | null;
  planIds: string[] | null;
  active: boolean;
  createdAt: number;
};

export type CreateCouponInput = {
  code: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  durationCycles: number;
  maxRedemptions: number | null;
  startsAt: number;
  endsAt: number | null;
  planIds: string[] | null;
};

export async function listCoupons(): Promise<OperatorResult<Coupon[]>> {
  const { data, error } = await supabase.rpc('admin_list_coupons');
  if (error) return { ok: false, error: friendly(error.message) };

  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    ok: true,
    data: rows.map((row) => ({
      id: String(row.id ?? ''),
      code: String(row.code ?? ''),
      discountType: (row.discount_type as 'percent' | 'fixed') ?? 'percent',
      discountValue: Number(row.discount_value ?? 0),
      durationCycles: Number(row.duration_cycles ?? 1),
      maxRedemptions: (row.max_redemptions as number | null) ?? null,
      redemptionsCount: Number(row.redemptions_count ?? 0),
      startsAt: Number(row.starts_at ?? 0),
      endsAt: (row.ends_at as number | null) ?? null,
      planIds: (row.plan_ids as string[] | null) ?? null,
      active: row.active !== false,
      createdAt: Number(row.created_at ?? 0),
    })),
  };
}

export async function createCoupon(input: CreateCouponInput): Promise<OperatorResult<string>> {
  const { data, error } = await supabase.rpc('admin_create_coupon', {
    p_code: input.code,
    p_discount_type: input.discountType,
    p_discount_value: input.discountValue,
    p_duration_cycles: input.durationCycles,
    p_max_redemptions: input.maxRedemptions,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_plan_ids: input.planIds,
  });
  return error ? { ok: false, error: friendly(error.message) } : { ok: true, data: data as string };
}

export async function setCouponActive(
  id: string,
  active: boolean,
  endsAt: number | null,
  maxRedemptions: number | null,
): Promise<OperatorResult<null>> {
  const { error } = await supabase.rpc('admin_update_coupon', {
    p_id: id,
    p_active: active,
    p_ends_at: endsAt,
    p_max_redemptions: maxRedemptions,
  });
  return error ? { ok: false, error: friendly(error.message) } : { ok: true, data: null };
}

/**
 * The refusals that matter, translated.
 *
 * All are the database working correctly, and all read as broken software if
 * passed through raw. "Not an administrator" and "not an operator" are kept
 * distinct on purpose — a staff account hitting an admin-only RPC (resolving
 * a report, changing account status, the full user-detail view) does have
 * operator access, just not that tier, and "this account does not have
 * operator access" would be flatly wrong for them.
 */
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('only the owner can manage operators')) {
    return 'Only the app’s owner can manage operators.';
  }
  if (m.includes('only the owner can manage coupons')) {
    return 'Only the app’s owner can manage coupons.';
  }
  if (m.includes('only the owner')) {
    return 'Only the app’s owner can do this.';
  }
  if (m.includes('not an administrator')) {
    return 'This needs full admin access — staff can view, but not act here.';
  }
  if (m.includes('not an operator')) {
    return 'This account does not have operator access.';
  }
  if (m.includes('no open report') || m.includes('no live report')) {
    return 'Staff can only open an account while a live report names it. This one has none.';
  }
  if (m.includes('reason is required')) {
    return 'A reason of at least 8 characters is required, and it is written to the audit log.';
  }
  if (m.includes('already has an owner')) {
    return 'This app already has an owner.';
  }
  if (m.includes('no account with that email')) {
    return 'No account exists with that email.';
  }
  if (m.includes('owner') && (m.includes('cannot be removed') || m.includes('cannot be changed'))) {
    return 'The owner’s own role can’t be changed here.';
  }
  return message;
}
