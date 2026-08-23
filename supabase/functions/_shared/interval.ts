// How a stored billing period becomes the recurrence Safepay is told to bill
// on.
//
// Its own file with no imports, for the same reason `money.ts` is: `safepay.ts`
// imports the SDK by URL and drags a network client in with it, and this is a
// pure mapping whose only failure mode is charging a real customer on the wrong
// schedule.
//
// ## The bug this exists to prevent
//
// `toSafepayInterval` was `period === 'year' ? 'YEAR' : 'MONTH'` — a two-value
// map with a silent default. The moment 0073 added a quarterly plan, that
// default made a Rs 929 three-month subscription bill **every month**: the same
// amount, three times as often, with nothing anywhere reporting a problem. The
// customer is overcharged 3×, the database says quarterly, Safepay says
// monthly, and no reconciliation ever lines the two up.
//
// So the map is total and it throws. An unmapped period is a bug upstream —
// `billing_plans.period` is constrained to a known list by 0073 — and refusing
// to guess is the only behaviour that cannot quietly take somebody's money.

/** What Safepay is told: a unit, and how many of them between charges. */
export type SafepayRecurrence = {
  interval: 'MONTH' | 'YEAR';
  /**
   * How many `interval`s between charges. Quarterly is three months rather
   * than a `QUARTER` unit.
   *
   * **Unverified against a live account**, exactly like `SAFEPAY_MINOR_UNITS`
   * in money.ts, and listed with it in docs/BILLING_PLAN.md's sandbox step.
   * Safepay's Subscriptions guide documents the unit; whether the plan API
   * honours a count alongside it is the one thing that cannot be settled from
   * here. If it does not, the fallback is a `MONTH` plan charged three times
   * per period, which is a different implementation rather than a different
   * constant — hence `SUPPORTS_INTERVAL_COUNT` being a named switch and
   * `quarter` being the only period that depends on it.
   */
  count: number;
};

/** Whether Safepay's plan API accepts a count alongside the unit. See above. */
export const SUPPORTS_INTERVAL_COUNT = true;

/**
 * The recurrence for a stored `billing_plans.period`.
 *
 * Throws on anything it does not recognise, including `'free'` — a free plan
 * has no recurrence and asking for one means a caller skipped the check that
 * should have stopped it before a Safepay plan was ever created.
 */
export function toSafepayRecurrence(period: string): SafepayRecurrence {
  switch (period) {
    case 'month':
      return { interval: 'MONTH', count: 1 };
    case 'quarter':
      if (!SUPPORTS_INTERVAL_COUNT) {
        throw new Error(
          'quarterly billing needs interval counts, which this integration has not confirmed',
        );
      }
      return { interval: 'MONTH', count: 3 };
    case 'year':
      return { interval: 'YEAR', count: 1 };
    default:
      throw new Error(`no Safepay recurrence for period: ${period}`);
  }
}

/**
 * How many times a year a period is charged.
 *
 * Used to compare plans honestly — a quarterly price is not comparable to a
 * monthly one until both are per-month — and kept here so the comparison and
 * the charge are derived from one table rather than two.
 */
export function chargesPerYear(period: string): number {
  switch (period) {
    case 'month':
      return 12;
    case 'quarter':
      return 4;
    case 'year':
      return 1;
    default:
      throw new Error(`no charge frequency for period: ${period}`);
  }
}
