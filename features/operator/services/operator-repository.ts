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

export type OperatorResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Whether this account can see any of it. Anything other than a clean `true`
 *  is treated as no — an error here means the question could not be answered,
 *  and a console that opens on an unanswered permission check is a console that
 *  will eventually open for the wrong person. */
export async function isOperator(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_staff');
  return !error && data === true;
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

/**
 * The two refusals that matter, translated.
 *
 * Both are the database working correctly, and both read as broken software if
 * passed through raw — "not an operator" on a screen the person just opened is
 * confusing unless it says why.
 */
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('not an operator') || m.includes('not an administrator')) {
    return 'This account does not have operator access.';
  }
  if (m.includes('no open report')) {
    return 'Staff can only open an account while a live report names it. This one has none.';
  }
  if (m.includes('reason is required')) {
    return 'A reason of at least 8 characters is required, and it is written to the audit log.';
  }
  return message;
}
