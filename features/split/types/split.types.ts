/**
 * Shared expense groups. Mirrors supabase/migrations/0003_expense_groups.sql.
 *
 * Unlike the rest of Daykeep these rows are not mirrored into SQLite: a group is
 * shared, so it has many writers, and there is no honest automatic merge for
 * two people editing the same amount offline. Supabase is the source of truth
 * and react-query holds the cache.
 */

export type GroupKind = 'trip' | 'home' | 'family' | 'work' | 'other';
export type MemberRole = 'owner' | 'member';

export type ExpenseGroup = {
  id: string;
  name: string;
  kind: GroupKind;
  currency: string;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
};

/**
 * A participant. `userId` is null until an invited person accepts, so somebody
 * can be split with before they have an account — `email` carries their
 * identity until then.
 */
export type GroupMember = {
  id: string;
  groupId: string;
  userId: string | null;
  email: string | null;
  displayName: string | null;
  role: MemberRole;
  joinedAt: number | null;
  /**
   * Set when they were removed or left. The row is a tombstone, never deleted:
   * their expenses, shares and settlements all point at it, and the arithmetic
   * only balances while every party to it still resolves. Filtering these out
   * of the balance computation is what made £75 disappear from a £100 dinner —
   * see supabase/migrations/0008.
   */
  removedAt: number | null;
};

export type GroupExpense = {
  id: string;
  groupId: string;
  paidByMemberId: string;
  description: string;
  amountCents: number;
  currency: string;
  spentAt: number;
  note: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
};

/** One member's slice of one expense, in whole cents. */
export type ExpenseShare = {
  id: string;
  expenseId: string;
  memberId: string;
  shareCents: number;
};

export type Settlement = {
  id: string;
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  amountCents: number;
  currency: string;
  settledAt: number;
  note: string | null;
  createdBy: string | null;
};

export type ActivityAction =
  | 'group_created'
  | 'group_deleted'
  | 'group_renamed'
  | 'member_added'
  | 'member_joined'
  | 'member_left'
  | 'member_removed'
  | 'expense_added'
  | 'expense_edited'
  | 'expense_deleted'
  | 'settlement_added'
  | 'settlement_deleted';

export type GroupActivity = {
  id: string;
  groupId: string;
  actorId: string | null;
  actorName: string | null;
  action: ActivityAction;
  expenseId: string | null;
  settlementId: string | null;
  /** Values as they were when the action happened, so the entry still reads
   *  correctly after the underlying row is edited or removed. */
  meta: Record<string, unknown> | null;
  createdAt: number;
};

/** How an expense is divided. */
export type SplitMode =
  /** Equal slices; the indivisible remainder goes to the earliest members. */
  | { mode: 'equal'; memberIds: string[] }
  /** Caller-supplied cents per member — must already sum to the total. */
  | { mode: 'exact'; shares: { memberId: string; shareCents: number }[] };

/**
 * A member's position in the group.
 *
 * Positive means the group owes them; negative means they owe the group. Always
 * derived from the shares ledger, never stored — see split-math.
 */
export type MemberBalance = {
  memberId: string;
  /** What they fronted. */
  paidCents: number;
  /** What they consumed (sum of their shares). */
  owedCents: number;
  /** paid − owed, adjusted by settlements. */
  netCents: number;
};

/** A suggested "X pays Y" to square the group up. */
export type Transfer = {
  fromMemberId: string;
  toMemberId: string;
  amountCents: number;
};
