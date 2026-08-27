import {
  QUOTE_COUNT,
  QUOTE_POOL,
  fetchDailyQuote,
  quoteForDate,
} from '@/features/dashboard/services/daily-quote';

/**
 * The dashboard's daily quote, and the first test `features/dashboard` has had.
 *
 * The rotation looks trivial and is not: it is date arithmetic that has to hold
 * at a year boundary, across a DST transition, and on a leap day. The version
 * this replaced subtracted a *local* midnight from `Date.now()` and floored the
 * result, which stops being a whole number of days when the clocks move — so
 * for part of one day a year it served yesterday's quote. Nothing would ever
 * have reported that.
 */

describe('daily quote rotation', () => {
  it('gives the same quote for every moment of one calendar day', () => {
    // The whole contract of a *daily* quote. Reading the clock rather than the
    // date is what breaks this, and it breaks invisibly.
    const justAfterMidnight = new Date(2026, 7, 27, 0, 0, 1);
    const midday = new Date(2026, 7, 27, 12, 30, 0);
    const justBeforeMidnight = new Date(2026, 7, 27, 23, 59, 59);

    expect(quoteForDate(midday)).toEqual(quoteForDate(justAfterMidnight));
    expect(quoteForDate(justBeforeMidnight)).toEqual(quoteForDate(justAfterMidnight));
  });

  it('moves on at the local day boundary', () => {
    // Consecutive days must differ, or the rotation has silently stalled.
    const day = new Date(2026, 7, 27, 12, 0, 0);
    const nextDay = new Date(2026, 7, 28, 12, 0, 0);

    expect(quoteForDate(nextDay)).not.toEqual(quoteForDate(day));
  });

  it('advances by exactly one step for every consecutive pair of days in a year', () => {
    // The general form of the DST bug, and deliberately not a test pinned to
    // one DST date: CI runs in UTC, where naming 29 March proves nothing
    // because no transition happens there. Adjacency across all 365 pairs is
    // the invariant the old elapsed-milliseconds arithmetic actually broke —
    // it holds in every zone, and in a zone with DST this is the regression.
    const index = (date: Date) => {
      const quote = quoteForDate(date);
      return QUOTE_POOL.findIndex((q) => q.quote === quote.quote);
    };

    for (let day = 0; day < 364; day++) {
      const today = new Date(2026, 0, 1 + day);
      const tomorrow = new Date(2026, 0, 2 + day);
      const step = (index(tomorrow) - index(today) + QUOTE_COUNT) % QUOTE_COUNT;
      expect({ day, step }).toEqual({ day, step: 1 });
    }
  });

  it('handles 1 January and 31 December without going out of bounds', () => {
    // `dayOfYear` feeds an array index. An off-by-one at either end is an
    // `undefined` read, which crashes the widget rather than degrading.
    for (const date of [new Date(2026, 0, 1), new Date(2026, 11, 31)]) {
      const quote = quoteForDate(date);
      expect(quote).toBeDefined();
      expect(typeof quote.quote).toBe('string');
    }
  });

  it('handles a leap day', () => {
    // 2028 is the next leap year. Day 366 must still land inside the pool.
    const quote = quoteForDate(new Date(2028, 1, 29));
    expect(quote).toBeDefined();
    expect(typeof quote.author).toBe('string');
  });

  it('stays in bounds for every day of a leap year', () => {
    // Exhaustive rather than sampled, because the failure is a single index.
    for (let i = 0; i < 366; i++) {
      const date = new Date(2028, 0, 1 + i);
      expect(quoteForDate(date)).toBeDefined();
    }
  });

  it('ships a pool with no blank entries', () => {
    // A missing author or an empty string renders as `— ` under the quote.
    for (let i = 0; i < QUOTE_COUNT; i++) {
      const { quote, author } = quoteForDate(new Date(2026, 0, 1 + i));
      expect(quote.trim().length).toBeGreaterThan(0);
      expect(author.trim().length).toBeGreaterThan(0);
    }
  });

  it('returns a value synchronously, with no fake network delay', () => {
    // The point of the rename. `fetchDailyQuote` used to return a promise that
    // resolved after 300ms, which put a skeleton on the dashboard's most-read
    // card on every cold open for a local array lookup.
    const result = fetchDailyQuote();
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof result.quote).toBe('string');
  });
});
