import { and, desc, eq, isNull } from 'drizzle-orm';
import { format } from 'date-fns';

import { getDb } from '@/database/client';
import {
  budgetCategoryLimits,
  budgetSettings,
  budgetTransactions,
  savingsGoals,
} from '@/database/schema';
import { generateId } from '@/lib/id';
import { LOCAL_USER_ID } from '@/lib/local-user';
import type {
  BudgetSettings,
  BudgetTransaction,
  CategoryLimit,
  CreateTransactionInput,
  SavingsGoal,
  SavingsGoalWithProgress,
  UpdateTransactionInput,
} from '@/features/budget/types/budget.types';

const DEFAULT_SETTINGS: BudgetSettings = { currency: '$', monthlyBudgetCents: null };

function toTransaction(row: typeof budgetTransactions.$inferSelect): BudgetTransaction {
  return {
    id: row.id,
    type: row.type,
    amountCents: row.amountCents,
    category: row.category,
    account: row.account,
    note: row.note,
    occurredAt: row.occurredAt,
    logDate: row.logDate,
    savingsGoalId: row.savingsGoalId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSavingsGoal(row: typeof savingsGoals.$inferSelect): SavingsGoal {
  return {
    id: row.id,
    name: row.name,
    targetCents: row.targetCents,
    colorToken: row.colorToken,
    deadline: row.deadline,
    createdAt: row.createdAt,
  };
}

// ---- Transactions ----

export function listTransactions(): BudgetTransaction[] {
  return getDb()
    .select()
    .from(budgetTransactions)
    .where(and(eq(budgetTransactions.userId, LOCAL_USER_ID), isNull(budgetTransactions.deletedAt)))
    .orderBy(desc(budgetTransactions.occurredAt))
    .all()
    .map(toTransaction);
}

export function getTransaction(id: string): BudgetTransaction | null {
  const row = getDb().select().from(budgetTransactions).where(eq(budgetTransactions.id, id)).get();
  return row ? toTransaction(row) : null;
}

export function createTransaction(input: CreateTransactionInput): BudgetTransaction {
  const now = Date.now();
  const transaction: BudgetTransaction = {
    id: generateId(),
    type: input.type,
    amountCents: Math.round(input.amountCents),
    category: input.category,
    account: input.account,
    note: input.note ?? null,
    occurredAt: input.occurredAt,
    logDate: format(new Date(input.occurredAt), 'yyyy-MM-dd'),
    savingsGoalId: input.savingsGoalId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  getDb()
    .insert(budgetTransactions)
    .values({ ...transaction, userId: LOCAL_USER_ID, syncStatus: 'pending' })
    .run();
  return transaction;
}

export function updateTransaction(id: string, input: UpdateTransactionInput) {
  const patch: Record<string, unknown> = { ...input, updatedAt: Date.now(), syncStatus: 'pending' };
  if (input.occurredAt !== undefined)
    patch.logDate = format(new Date(input.occurredAt), 'yyyy-MM-dd');
  if (input.amountCents !== undefined) patch.amountCents = Math.round(input.amountCents);
  getDb().update(budgetTransactions).set(patch).where(eq(budgetTransactions.id, id)).run();
}

export function deleteTransaction(id: string) {
  getDb()
    .update(budgetTransactions)
    .set({ deletedAt: Date.now(), updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(budgetTransactions.id, id))
    .run();
}

// ---- Savings goals ----

export function listSavingsGoals(): SavingsGoal[] {
  return getDb()
    .select()
    .from(savingsGoals)
    .where(and(eq(savingsGoals.userId, LOCAL_USER_ID), isNull(savingsGoals.deletedAt)))
    .orderBy(savingsGoals.createdAt)
    .all()
    .map(toSavingsGoal);
}

/** Savings goals enriched with saved-to-date (summed from savings transactions
 * linked to each goal) and their progress ratio. */
export function listSavingsGoalsWithProgress(): SavingsGoalWithProgress[] {
  const goals = listSavingsGoals();
  const savingsTx = getDb()
    .select()
    .from(budgetTransactions)
    .where(
      and(
        eq(budgetTransactions.userId, LOCAL_USER_ID),
        eq(budgetTransactions.type, 'savings'),
        isNull(budgetTransactions.deletedAt),
      ),
    )
    .all();

  const savedByGoal = new Map<string, number>();
  for (const tx of savingsTx) {
    if (!tx.savingsGoalId) continue;
    savedByGoal.set(tx.savingsGoalId, (savedByGoal.get(tx.savingsGoalId) ?? 0) + tx.amountCents);
  }

  return goals.map((goal) => {
    const savedCents = savedByGoal.get(goal.id) ?? 0;
    return {
      ...goal,
      savedCents,
      progress: goal.targetCents > 0 ? Math.min(1, savedCents / goal.targetCents) : 0,
    };
  });
}

export function createSavingsGoal(
  name: string,
  targetCents: number,
  colorToken: string,
  deadline: number | null,
): SavingsGoal {
  const now = Date.now();
  const goal: SavingsGoal = {
    id: generateId(),
    name: name.trim(),
    targetCents,
    colorToken,
    deadline,
    createdAt: now,
  };
  getDb()
    .insert(savingsGoals)
    .values({ ...goal, userId: LOCAL_USER_ID, updatedAt: now })
    .run();
  return goal;
}

export function updateSavingsGoal(
  id: string,
  patch: Partial<Pick<SavingsGoal, 'name' | 'targetCents' | 'deadline'>>,
) {
  getDb()
    .update(savingsGoals)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(savingsGoals.id, id))
    .run();
}

export function deleteSavingsGoal(id: string) {
  getDb()
    .update(savingsGoals)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(savingsGoals.id, id))
    .run();
}

// ---- Settings ----

export function getBudgetSettings(): BudgetSettings {
  const row = getDb()
    .select()
    .from(budgetSettings)
    .where(eq(budgetSettings.userId, LOCAL_USER_ID))
    .get();
  if (!row) return { ...DEFAULT_SETTINGS };
  return { currency: row.currency, monthlyBudgetCents: row.monthlyBudgetCents };
}

export function updateBudgetSettings(input: Partial<BudgetSettings>) {
  const db = getDb();
  const existing = db
    .select()
    .from(budgetSettings)
    .where(eq(budgetSettings.userId, LOCAL_USER_ID))
    .get();
  const now = Date.now();
  if (!existing) {
    db.insert(budgetSettings)
      .values({ userId: LOCAL_USER_ID, ...DEFAULT_SETTINGS, ...input, updatedAt: now })
      .run();
    return;
  }
  db.update(budgetSettings)
    .set({ ...input, updatedAt: now })
    .where(eq(budgetSettings.userId, LOCAL_USER_ID))
    .run();
}

// ---- Per-category spending caps -------------------------------------------

/** Derived from the pair, so two devices capping the same category offline
 *  agree on one row instead of leaving two caps and no way to choose. */
function categoryLimitId(category: string): string {
  return `${LOCAL_USER_ID}:${category}`;
}

export function listCategoryLimits(): CategoryLimit[] {
  return getDb()
    .select()
    .from(budgetCategoryLimits)
    .where(
      and(eq(budgetCategoryLimits.userId, LOCAL_USER_ID), isNull(budgetCategoryLimits.deletedAt)),
    )
    .all()
    .map((row) => ({ id: row.id, category: row.category, limitCents: row.limitCents }));
}

/** Category → cap, the shape `categoryBudgetStatuses` wants. */
export function categoryLimitsByCategory(): Record<string, number> {
  return Object.fromEntries(
    listCategoryLimits().map((limit) => [limit.category, limit.limitCents]),
  );
}

/**
 * Sets or clears a category's cap.
 *
 * A null cap is a soft delete, not a zero: zero is "I plan to spend nothing
 * here" and must keep showing as over budget when anything is spent, while
 * absent means this feature has no opinion about the category. Collapsing the
 * two would make it impossible to express the first.
 *
 * Reconciled rather than deleted-and-reinserted, because the id is derived from
 * the category — re-capping has to revive the existing row or the primary key
 * refuses the second insert.
 */
export function setCategoryLimit(category: string, limitCents: number | null) {
  const db = getDb();
  const now = Date.now();
  const id = categoryLimitId(category);
  const existing = db
    .select()
    .from(budgetCategoryLimits)
    .where(eq(budgetCategoryLimits.id, id))
    .get();

  if (existing) {
    db.update(budgetCategoryLimits)
      .set({
        limitCents: limitCents ?? existing.limitCents,
        deletedAt: limitCents === null ? now : null,
        updatedAt: now,
      })
      .where(eq(budgetCategoryLimits.id, id))
      .run();
    return;
  }

  if (limitCents === null) return;

  db.insert(budgetCategoryLimits)
    .values({
      id,
      userId: LOCAL_USER_ID,
      category,
      limitCents,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}
