export type TransactionType = 'income' | 'expense' | 'savings';

export type BudgetAccount = 'cash' | 'wallet' | 'bank';

export type ExpenseCategoryId =
  | 'food'
  | 'shopping'
  | 'gym'
  | 'education'
  | 'entertainment'
  | 'transport'
  | 'bills'
  | 'health'
  | 'investment'
  | 'others';

export type IncomeCategoryId = 'salary' | 'freelance' | 'gift' | 'investment' | 'other';

export type BudgetTransaction = {
  id: string;
  type: TransactionType;
  amountCents: number;
  category: string;
  account: BudgetAccount;
  note: string | null;
  occurredAt: number;
  logDate: string;
  savingsGoalId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type SavingsGoal = {
  id: string;
  name: string;
  targetCents: number;
  colorToken: string;
  deadline: number | null;
  createdAt: number;
};

export type SavingsGoalWithProgress = SavingsGoal & {
  savedCents: number;
  progress: number;
};

export type BudgetSettings = {
  currency: string;
  monthlyBudgetCents: number | null;
};

export type CreateTransactionInput = {
  type: TransactionType;
  amountCents: number;
  category: string;
  account: BudgetAccount;
  note?: string | null;
  occurredAt: number;
  savingsGoalId?: string | null;
};

export type UpdateTransactionInput = Partial<
  Pick<
    BudgetTransaction,
    'amountCents' | 'category' | 'account' | 'note' | 'occurredAt' | 'savingsGoalId'
  >
>;

/** 'borrowed' = you owe this person; 'lent' = this person owes you. */
export type DebtDirection = 'borrowed' | 'lent';

export type Debt = {
  id: string;
  direction: DebtDirection;
  counterparty: string;
  principalCents: number;
  paidCents: number;
  currency: string;
  note: string | null;
  dueDate: number | null;
  reminderDaysBefore: number | null;
  reminderNotificationId: string | null;
  settledAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type DebtStatus = 'settled' | 'overdue' | 'due_soon' | 'upcoming' | 'no_date';

export type DebtWithStatus = Debt & {
  remainingCents: number;
  progress: number;
  isSettled: boolean;
  daysLeft: number | null;
  status: DebtStatus;
};

export type CreateDebtInput = {
  direction: DebtDirection;
  counterparty: string;
  principalCents: number;
  currency: string;
  note?: string | null;
  dueDate?: number | null;
  reminderDaysBefore?: number | null;
};

export type UpdateDebtInput = Partial<
  Pick<
    Debt,
    | 'counterparty'
    | 'principalCents'
    | 'paidCents'
    | 'note'
    | 'dueDate'
    | 'reminderDaysBefore'
    | 'settledAt'
  >
>;

/** Aggregated IOU totals, converted to nothing — each side is summed in its
 * own stored currency is NOT assumed; totals are per the user's main currency
 * for display only (mixed-currency debts are summed naively, so the UI groups
 * by currency where it matters). */
export type DebtTotals = {
  oweCents: number;
  owedCents: number;
  netCents: number;
  activeCount: number;
};

export type BudgetSummary = {
  incomeCents: number;
  expenseCents: number;
  savingsCents: number;
  /** income − expense − savings for the period. */
  balanceCents: number;
};

export type CategorySlice = {
  categoryId: string;
  label: string;
  tint: string;
  amountCents: number;
  share: number;
};

export type BudgetTrendPoint = {
  label: string;
  incomeCents: number;
  expenseCents: number;
};

export type AccountBalance = {
  account: BudgetAccount;
  balanceCents: number;
};

/** One capped expense category's standing within the current month. */
export type CategoryBudgetStatus = {
  category: string;
  spentCents: number;
  limitCents: number;
  /** Can be negative — that is the point of it. */
  remainingCents: number;
  /** Unclamped, and Infinity for anything spent against a zero cap. */
  ratio: number;
  isOver: boolean;
};

export type CategoryLimit = {
  id: string;
  category: string;
  limitCents: number;
};

export type RecurringFrequencyOption = 'weekly' | 'monthly' | 'yearly';

export type RecurringTransaction = {
  id: string;
  type: 'income' | 'expense' | 'savings';
  amountCents: number;
  category: string;
  account: BudgetAccount;
  note: string | null;
  frequency: RecurringFrequencyOption;
  interval: number;
  anchorDate: string;
  lastPostedDate: string | null;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
};

export type CreateRecurringInput = {
  type: 'income' | 'expense' | 'savings';
  amountCents: number;
  category: string;
  account?: BudgetAccount;
  note?: string | null;
  frequency: RecurringFrequencyOption;
  interval?: number;
  /** `yyyy-MM-dd` of the first occurrence. */
  anchorDate: string;
};
