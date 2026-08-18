// Converting a stored price into the amount Safepay is actually told to
// charge.
//
// Deliberately its own file with no imports. `safepay.ts` imports the SDK by
// URL, which Jest cannot resolve, so anything living there is untestable —
// and this is the one calculation in the whole billing feature where being
// wrong means charging a real customer the wrong number.
//
// ## The bug this replaces
//
// `createSafepayPlan` sent `String(Math.round(amountCents / 100))`. The seeded
// plans are 499 and 3999 cents, so Safepay was told "5" and "40": every USD
// customer overcharged, and every percentage coupon rounded into
// meaninglessness — 10% off 499 computes 449 and then bills 400. Worse,
// `plan_coupon_variants.price_cents` caches the correct figure, so the
// database and Safepay disagree permanently and no reconciliation ever lines
// up.
//
// ## What is still unverified
//
// Whether Safepay's plan API takes major units ("4.99") or minor units
// ("499"), per currency. `SAFEPAY_MINOR_UNITS` below is the single switch for
// that, and `ZERO_DECIMAL` is the single list of currencies that have no minor
// unit at all. Both are named here rather than inlined so that confirming the
// answer against a sandbox account is a one-line change — see
// docs/BILLING_PLAN.md §III.2, which is the step that answers it.
//
// Until that is confirmed the defaults below are the conservative reading of
// Safepay's Subscriptions guide: major units, and PKR treated as having
// minor units like USD. If sandbox says otherwise, change these two constants
// and nothing else.

/** Currencies with no minor unit — an "amount" is already whole. */
export const ZERO_DECIMAL = new Set<string>([]);

/** Whether Safepay's plan API expects the smallest unit (499) rather than the
 *  major one (4.99). */
export const SAFEPAY_MINOR_UNITS = false;

export function minorUnitDigits(currency: string): number {
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? 0 : 2;
}

/**
 * The string to put in a Safepay plan's `amount`.
 *
 * Never rounds away real money: a zero-decimal currency is stored in whole
 * units already, and a two-decimal one keeps both digits. The only rounding is
 * to the currency's own precision, which is the one place rounding is correct.
 *
 * Throws rather than clamping on a negative amount. A negative price is always
 * a bug upstream — a fixed-amount coupon larger than the plan it was applied
 * to — and silently sending "0" would create a free recurring subscription
 * that nobody notices until the revenue report.
 */
export function toSafepayAmount(amountCents: number, currency: string): string {
  if (!Number.isFinite(amountCents)) {
    throw new Error(`amount is not a number: ${amountCents}`);
  }
  if (amountCents < 0) {
    throw new Error(`amount is negative: ${amountCents}`);
  }

  const digits = minorUnitDigits(currency);

  if (SAFEPAY_MINOR_UNITS) {
    return String(Math.round(amountCents));
  }
  if (digits === 0) {
    return String(Math.round(amountCents));
  }
  return (Math.round(amountCents) / 100).toFixed(digits);
}

/**
 * What a coupon takes off a price, in the same minor units the price is in.
 *
 * Shared so that the preview the user is shown before subscribing and the
 * amount actually sent to Safepay come from one function and cannot drift —
 * `safepay-checkout` computed this inline, and the client was about to grow
 * its own copy for the coupon preview.
 *
 * Floors at zero. A percentage can never take more than the price, but a fixed
 * discount can, and 0 is the honest result of "Rs 500 off a Rs 300 plan".
 * Whether a zero-priced recurring plan is legal at Safepay is a separate
 * question, answered before the coupon is ever issued rather than here — see
 * `admin_create_coupon` and docs/BILLING_PLAN.md §IV.1.
 */
export function discountedCents(
  priceCents: number,
  discountType: 'percent' | 'fixed',
  discountValue: number,
): number {
  if (discountType === 'percent') {
    return Math.max(0, Math.round(priceCents * (1 - discountValue / 100)));
  }
  return Math.max(0, priceCents - discountValue);
}
