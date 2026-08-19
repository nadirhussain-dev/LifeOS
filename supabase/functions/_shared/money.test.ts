/**
 * The one calculation in billing where being wrong charges a real customer the
 * wrong number. See money.ts's header for the bug these tests pin down.
 */
import { discountedCents, toSafepayAmount, ZERO_DECIMAL } from './money';

describe('toSafepayAmount', () => {
  it('keeps both minor-unit digits instead of rounding them away', () => {
    // The regression: `Math.round(499 / 100)` sent "5" — a 1c overcharge on
    // every subscriber, every cycle.
    expect(toSafepayAmount(499, 'usd')).toBe('4.99');
    expect(toSafepayAmount(3999, 'usd')).toBe('39.99');
  });

  it('does not round a coupon price into a different price', () => {
    // 10% off 499 is 449. The old code billed 4.
    expect(toSafepayAmount(discountedCents(499, 'percent', 10), 'usd')).toBe('4.49');
  });

  it('is case-insensitive about the currency code', () => {
    expect(toSafepayAmount(499, 'USD')).toBe(toSafepayAmount(499, 'usd'));
  });

  it('formats whole amounts with their decimals, not as bare integers', () => {
    expect(toSafepayAmount(500, 'usd')).toBe('5.00');
  });

  it('handles zero', () => {
    expect(toSafepayAmount(0, 'usd')).toBe('0.00');
  });

  it('sends whole units for a zero-decimal currency', () => {
    // Guards the branch rather than any particular currency being in the set —
    // ZERO_DECIMAL is empty until sandbox confirms it (money.ts's header), and
    // this test has to keep passing either way.
    ZERO_DECIMAL.add('xyz');
    try {
      expect(toSafepayAmount(1200, 'xyz')).toBe('1200');
    } finally {
      ZERO_DECIMAL.delete('xyz');
    }
  });

  it('throws rather than silently creating a free subscription', () => {
    // A fixed coupon larger than the plan is the realistic way this happens.
    expect(() => toSafepayAmount(-100, 'usd')).toThrow(/negative/);
    expect(() => toSafepayAmount(Number.NaN, 'usd')).toThrow(/not a number/);
  });
});

describe('discountedCents', () => {
  it('takes a percentage off', () => {
    expect(discountedCents(499, 'percent', 10)).toBe(449);
    expect(discountedCents(3999, 'percent', 25)).toBe(2999);
  });

  it('takes a fixed amount off', () => {
    expect(discountedCents(499, 'fixed', 100)).toBe(399);
  });

  it('floors at zero rather than going negative', () => {
    // "Rs 500 off a Rs 300 plan" — 0 is the honest answer, and toSafepayAmount
    // is what refuses to send a negative one.
    expect(discountedCents(300, 'fixed', 500)).toBe(0);
    expect(discountedCents(499, 'percent', 100)).toBe(0);
  });

  it('rounds a percentage to a whole minor unit', () => {
    // 33% off 499 is 334.33; a fractional cent is not a price.
    expect(Number.isInteger(discountedCents(499, 'percent', 33))).toBe(true);
  });
});
