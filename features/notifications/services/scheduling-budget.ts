/**
 * How many pending OS notification slots the app has spent.
 *
 * ## Why a ledger, and not just an ordering
 *
 * iOS keeps 64 pending notifications and silently discards the rest — no
 * error, no callback. `reminder-scheduler.ts` orders its rebuild by importance
 * ("if anything is going to be squeezed out by the platform ceiling, it should
 * be this") on the assumption that scheduling first means surviving. It does
 * not. iOS keeps the 64 that fire **soonest**, not the 64 registered first, so
 * ordering the rebuild cannot influence which survive at all.
 *
 * That inverts the intent exactly. Hydration every 30 minutes fires sooner than
 * almost anything else in the app, so under pressure the reminders that survive
 * are the least consequential ones, and the task due tomorrow — scheduled first,
 * deliberately — is the one the platform throws away.
 *
 * The only thing that actually works is never exceeding the ceiling. Count the
 * slots as they are spent and stop before the limit, and the platform never has
 * to choose; the rebuild's ordering then means what it says, because the
 * reminders that go unscheduled are the ones it reached last.
 *
 * ## Accuracy
 *
 * An in-process counter, not a query. Reading the real queue costs a native
 * round trip, and the rebuild schedules dozens of notifications in a row —
 * checking each time would make the common path much slower to defend against
 * a ceiling only iOS has.
 *
 * It can drift: a scheduled notification that has since fired still counts
 * against the ledger until something reseeds it. Drift is always in the safe
 * direction (over-counting reserves fewer slots than are free, so nothing is
 * silently dropped), and every resync reseeds from the real queue —
 * `seedSlots()` — which happens on launch and after any settings change.
 *
 * Pure and dependency-free: the budget is passed in rather than read from
 * `SCHEDULING_BUDGET`, so this is testable without a native runtime and one
 * import away from the module that owns the platform constant.
 */

let spent = 0;

/** Replaces the count with the real queue depth. Called by the resync once the
 *  OS queue is known, which is the moment the ledger can be made truthful. */
export function seedSlots(count: number): void {
  spent = Math.max(0, count);
}

/** One notification was accepted by the OS. */
export function spendSlot(): void {
  spent += 1;
}

/** One notification left the queue — cancelled, or its item deleted. */
export function releaseSlot(): void {
  spent = Math.max(0, spent - 1);
}

export function slotsSpent(): number {
  return spent;
}

/** Slots still free under `budget`. `Infinity` on platforms without a ceiling,
 *  which is what makes every caller below a no-op off iOS. */
export function remainingSlots(budget: number): number {
  return Math.max(0, budget - spent);
}

export function hasHeadroom(budget: number): boolean {
  return spent < budget;
}

/**
 * How many of `requested` slots a feature may actually take.
 *
 * Reserves `keepFree` slots for whatever has not been scheduled yet. Hydration
 * is the one caller today: it is both the largest consumer and the least
 * consequential reminder, so it takes what is left rather than what it wants,
 * and the digest and private-space steps that follow it still have room.
 */
export function allowance(requested: number, budget: number, keepFree = 0): number {
  const free = remainingSlots(budget) - keepFree;
  if (free <= 0) return 0;
  return Math.min(requested, free);
}
