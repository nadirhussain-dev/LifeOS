import { ensureProfileRow } from '@/features/auth/services/ensure-profile';
import { supabase } from '@/lib/supabase';
import { generateId } from '@/lib/id';
import { toEdgeFunctionError, toSupabaseError } from '@/lib/supabase-error';
import type {
  ExpenseShare,
  ExpenseGroup,
  GroupActivity,
  GroupExpense,
  GroupKind,
  GroupMember,
  Settlement,
} from '@/features/split/types/split.types';

/**
 * Supabase access for shared expense groups.
 *
 * Unlike every other repository in the app this does NOT read SQLite: group
 * data is shared, so the server is the source of truth and react-query holds
 * the cache. Reads rely on the RLS policies from 0003 — there is no explicit
 * "where I am a member" clause because the database already refuses to return
 * anything else.
 *
 * Writes that touch more than one table go through the RPCs in 0004 so they
 * land atomically.
 */

// --- row mapping -----------------------------------------------------------

type Row = Record<string, unknown>;

const num = (v: unknown, fallback = 0) => (typeof v === 'number' ? v : fallback);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

const toGroup = (r: Row): ExpenseGroup => ({
  id: String(r.id),
  name: String(r.name),
  kind: (str(r.kind) ?? 'other') as GroupKind,
  currency: str(r.currency) ?? 'USD',
  createdBy: str(r.created_by),
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at),
});

const toMember = (r: Row): GroupMember => ({
  id: String(r.id),
  groupId: String(r.group_id),
  userId: str(r.user_id),
  email: str(r.email),
  displayName: str(r.display_name),
  role: (str(r.role) ?? 'member') as GroupMember['role'],
  joinedAt: typeof r.joined_at === 'number' ? r.joined_at : null,
  removedAt: typeof r.deleted_at === 'number' ? r.deleted_at : null,
});

const toExpense = (r: Row): GroupExpense => ({
  id: String(r.id),
  groupId: String(r.group_id),
  paidByMemberId: String(r.paid_by_member_id),
  description: String(r.description),
  amountCents: num(r.amount_cents),
  currency: str(r.currency) ?? 'USD',
  spentAt: num(r.spent_at),
  note: str(r.note),
  createdBy: str(r.created_by),
  createdAt: num(r.created_at),
  updatedAt: num(r.updated_at),
});

const toShare = (r: Row): ExpenseShare => ({
  id: String(r.id),
  expenseId: String(r.expense_id),
  memberId: String(r.member_id),
  shareCents: num(r.share_cents),
});

const toSettlement = (r: Row): Settlement => ({
  id: String(r.id),
  groupId: String(r.group_id),
  fromMemberId: String(r.from_member_id),
  toMemberId: String(r.to_member_id),
  amountCents: num(r.amount_cents),
  currency: str(r.currency) ?? 'USD',
  settledAt: num(r.settled_at),
  note: str(r.note),
  createdBy: str(r.created_by),
});

const toActivity = (r: Row): GroupActivity => ({
  id: String(r.id),
  groupId: String(r.group_id),
  actorId: str(r.actor_id),
  actorName: str(r.actor_name),
  action: String(r.action) as GroupActivity['action'],
  expenseId: str(r.expense_id),
  settlementId: str(r.settlement_id),
  meta: (r.meta as Record<string, unknown> | null) ?? null,
  createdAt: num(r.created_at),
});

/**
 * Supabase returns `{ data, error }`; make the error a throw so react-query
 * surfaces it instead of silently rendering an empty list.
 *
 * Rethrown through toSupabaseError so the PostgREST/SQLSTATE code survives —
 * `new Error(error.message)` discarded it, which left every screen with nothing
 * to distinguish "you're offline" from "this project never ran the migrations"
 * and so telling everyone to check their connection.
 */
function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw toSupabaseError(result.error);
  return (result.data ?? []) as T;
}

/** Same, for calls that care about a single row or a void result. */
function assertOk(error: unknown): void {
  if (error) throw toSupabaseError(error);
}

// --- reads -----------------------------------------------------------------

export async function listGroups(): Promise<ExpenseGroup[]> {
  const res = await supabase
    .from('expense_groups')
    .select('*')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  return unwrap<Row[]>(res).map(toGroup);
}

export async function getGroup(id: string): Promise<ExpenseGroup | null> {
  const res = await supabase
    .from('expense_groups')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  assertOk(res.error);
  return res.data ? toGroup(res.data as Row) : null;
}

/**
 * Everyone who has ever been in the group, removed members included.
 *
 * This used to filter `deleted_at is null`, and the balances are computed over
 * whatever it returns — so removing somebody took everything they had PAID out
 * of the ledger while leaving everything they were OWED for in it. A £100
 * dinner paid by one person and split four ways became three people owing £25
 * each and nobody being owed anything, with "Settle up" reporting the group as
 * square. Callers that need only the current line-up filter on `removedAt`.
 */
export async function listMembers(groupId: string): Promise<GroupMember[]> {
  const res = await supabase
    .from('expense_group_members')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at');
  return unwrap<Row[]>(res).map(toMember);
}

export async function listExpenses(groupId: string): Promise<GroupExpense[]> {
  const res = await supabase
    .from('expense_group_expenses')
    .select('*')
    .eq('group_id', groupId)
    .is('deleted_at', null)
    .order('spent_at', { ascending: false });
  return unwrap<Row[]>(res).map(toExpense);
}

/** Shares for a whole group. Fetched by expense id because shares carry no
 *  group_id of their own — they belong to the expense, not the group. */
export async function listShares(expenseIds: string[]): Promise<ExpenseShare[]> {
  if (expenseIds.length === 0) return [];
  const res = await supabase.from('expense_group_shares').select('*').in('expense_id', expenseIds);
  return unwrap<Row[]>(res).map(toShare);
}

export async function listSettlements(groupId: string): Promise<Settlement[]> {
  const res = await supabase
    .from('expense_group_settlements')
    .select('*')
    .eq('group_id', groupId)
    .is('deleted_at', null)
    .order('settled_at', { ascending: false });
  return unwrap<Row[]>(res).map(toSettlement);
}

/**
 * Every group plus the ledger rows needed to price them, in five requests
 * regardless of how many groups there are.
 *
 * The groups list is the screen people open to answer one question — "am I up
 * or down, and by how much?" — and it could not answer it, because a balance
 * needs members, expenses, shares and settlements and fetching those per group
 * is an N+1. Batching by `in(group_id, ids)` keeps it flat, and the arithmetic
 * stays in split-math.ts rather than being reimplemented in SQL, so the numbers
 * on this screen and the numbers inside a group can never disagree.
 */
export async function listGroupLedgers(): Promise<{
  groups: ExpenseGroup[];
  members: GroupMember[];
  expenses: GroupExpense[];
  shares: ExpenseShare[];
  settlements: Settlement[];
}> {
  const groups = await listGroups();
  const ids = groups.map((g) => g.id);
  if (ids.length === 0) {
    return { groups, members: [], expenses: [], shares: [], settlements: [] };
  }

  const [membersRes, expensesRes, settlementsRes] = await Promise.all([
    // Removed members included, for the same reason listMembers includes them.
    supabase.from('expense_group_members').select('*').in('group_id', ids),
    supabase.from('expense_group_expenses').select('*').in('group_id', ids).is('deleted_at', null),
    supabase
      .from('expense_group_settlements')
      .select('*')
      .in('group_id', ids)
      .is('deleted_at', null),
  ]);

  const expenses = unwrap<Row[]>(expensesRes).map(toExpense);
  const shares = await listShares(expenses.map((e) => e.id));

  return {
    groups,
    members: unwrap<Row[]>(membersRes).map(toMember),
    expenses,
    shares,
    settlements: unwrap<Row[]>(settlementsRes).map(toSettlement),
  };
}

export async function listActivity(groupId: string, limit = 50): Promise<GroupActivity[]> {
  const res = await supabase
    .from('expense_group_activity')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return unwrap<Row[]>(res).map(toActivity);
}

// --- writes ----------------------------------------------------------------

export async function createGroup(input: {
  name: string;
  kind: GroupKind;
  currency: string;
  displayName: string | null;
}): Promise<string> {
  // The RPC reads `profiles` to build the owner's member row, and on a project
  // that has not had migration 0007 applied it does so with INSERT..SELECT —
  // which silently inserts nothing if that row is missing, leaving the group
  // memberless and failing the next statement with an RLS violation. Repairing
  // the row first makes group creation work on every deployed schema version.
  await ensureProfileRow();

  const groupId = generateId();
  const { error } = await supabase.rpc('create_expense_group', {
    p_group_id: groupId,
    p_name: input.name,
    p_kind: input.kind,
    p_currency: input.currency,
    p_member_id: generateId(),
    p_display_name: input.displayName,
    p_activity_id: generateId(),
    p_now: Date.now(),
  });
  assertOk(error);
  return groupId;
}

/** Adds somebody by email. They become a member immediately — splittable
 *  straight away — and user_id is filled in when they accept the invitation. */
export async function addMemberByEmail(input: {
  groupId: string;
  email: string;
  displayName: string | null;
}): Promise<void> {
  const now = Date.now();
  const { error } = await supabase.from('expense_group_members').insert({
    id: generateId(),
    group_id: input.groupId,
    user_id: null,
    email: input.email.trim().toLowerCase(),
    display_name: input.displayName,
    role: 'member',
    created_at: now,
    updated_at: now,
  });
  assertOk(error);
}

/**
 * Emails an invitation for an existing placeholder member.
 *
 * The token is minted in the edge function, never here: an invite token is a
 * bearer credential — whoever holds it can join the group — so the client must
 * not be able to choose it. When email isn't configured yet the function still
 * creates a real, redeemable invitation and returns the link to share by hand.
 */
export async function sendInvite(input: {
  groupId: string;
  memberId: string;
  email: string;
  groupName: string;
}): Promise<{ link: string; emailed: boolean }> {
  const { data, error, response } = await supabase.functions.invoke('send-invite', { body: input });
  // Not assertOk: `invoke` hands a non-2xx back as a FunctionsHttpError whose
  // message is a generic "non-2xx status code", with the function's own body on
  // a separate Response. Through toSupabaseError the 429 this can now return
  // would read as 'unknown' — "check your connection" over a rate limit.
  if (error) throw await toEdgeFunctionError(error, response);
  return { link: String(data?.link ?? ''), emailed: data?.emailed === true };
}

/** What an invitee may see before joining: the group's name, nothing more. */
export async function peekInvitation(
  token: string,
): Promise<{ groupName: string | null; status: string }> {
  const { data, error } = await supabase.rpc('peek_group_invitation', {
    p_token: token,
    p_now: Date.now(),
  });
  assertOk(error);
  const row = Array.isArray(data) ? data[0] : data;
  return { groupName: row?.group_name ?? null, status: String(row?.status ?? 'invalid') };
}

export async function acceptInvitation(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_group_invitation', {
    p_token: token,
    p_now: Date.now(),
  });
  assertOk(error);
  return String(data);
}

/**
 * Removes a member, or leaves the group when it is your own membership.
 *
 * Goes through the RPC so the removal is authorised (owner, or yourself) and
 * recorded in the activity feed in one transaction — the direct update it
 * replaces could be issued by any member and left no trace of who did it, in a
 * feature whose whole safety model is "anyone can edit, and the log says who".
 */
export async function removeMember(memberId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_group_member', {
    p_member_id: memberId,
    p_activity_id: generateId(),
    p_now: Date.now(),
  });
  assertOk(error);
}

/** Retires a group. Owner only, and soft — the ledger stays intact for
 *  everybody who was in it. */
export async function deleteGroup(groupId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_expense_group', {
    p_group_id: groupId,
    p_activity_id: generateId(),
    p_now: Date.now(),
  });
  assertOk(error);
}

export async function createExpense(input: {
  groupId: string;
  paidByMemberId: string;
  description: string;
  amountCents: number;
  currency: string;
  spentAt: number;
  note: string | null;
  shares: { memberId: string; shareCents: number }[];
}): Promise<string> {
  const expenseId = generateId();
  const { error } = await supabase.rpc('create_group_expense', {
    p_expense_id: expenseId,
    p_group_id: input.groupId,
    p_paid_by_member_id: input.paidByMemberId,
    p_description: input.description,
    p_amount_cents: input.amountCents,
    p_currency: input.currency,
    p_spent_at: input.spentAt,
    p_note: input.note,
    p_shares: input.shares.map((s) => ({ member_id: s.memberId, share_cents: s.shareCents })),
    p_activity_id: generateId(),
    p_now: Date.now(),
  });
  assertOk(error);
  return expenseId;
}

export async function updateExpense(input: {
  expenseId: string;
  paidByMemberId: string;
  description: string;
  amountCents: number;
  spentAt: number;
  note: string | null;
  shares: { memberId: string; shareCents: number }[];
}): Promise<void> {
  const { error } = await supabase.rpc('update_group_expense', {
    p_expense_id: input.expenseId,
    p_description: input.description,
    p_amount_cents: input.amountCents,
    p_paid_by_member_id: input.paidByMemberId,
    p_spent_at: input.spentAt,
    p_note: input.note,
    p_shares: input.shares.map((s) => ({ member_id: s.memberId, share_cents: s.shareCents })),
    p_activity_id: generateId(),
    p_now: Date.now(),
  });
  assertOk(error);
}

export async function deleteExpense(expenseId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_group_expense', {
    p_expense_id: expenseId,
    p_activity_id: generateId(),
    p_now: Date.now(),
  });
  assertOk(error);
}

export async function recordSettlement(input: {
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  amountCents: number;
  currency: string;
  note: string | null;
}): Promise<void> {
  const now = Date.now();
  const { error } = await supabase.rpc('record_settlement', {
    p_settlement_id: generateId(),
    p_group_id: input.groupId,
    p_from_member_id: input.fromMemberId,
    p_to_member_id: input.toMemberId,
    p_amount_cents: input.amountCents,
    p_currency: input.currency,
    p_settled_at: now,
    p_note: input.note,
    p_activity_id: generateId(),
    p_now: now,
  });
  assertOk(error);
}
