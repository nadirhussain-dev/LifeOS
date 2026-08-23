import { chargesPerYear, toSafepayRecurrence, SUPPORTS_INTERVAL_COUNT } from './interval';

/**
 * The one calculation where being wrong charges a real customer on the wrong
 * schedule.
 *
 * The predecessor was `period === 'year' ? 'YEAR' : 'MONTH'`, which is correct
 * for exactly the two periods that existed when it was written and silently
 * wrong for every one added afterwards.
 */

describe('toSafepayRecurrence', () => {
  it('bills a monthly plan once a month', () => {
    expect(toSafepayRecurrence('month')).toEqual({ interval: 'MONTH', count: 1 });
  });

  it('bills a yearly plan once a year', () => {
    expect(toSafepayRecurrence('year')).toEqual({ interval: 'YEAR', count: 1 });
  });

  it('bills a quarterly plan every three months, not every month', () => {
    /*
     * The bug, stated as a test. Under the old ternary a quarterly plan fell to
     * the `MONTH` default and charged the three-month price twelve times a
     * year — a 3× overcharge that nothing would have reported, because both
     * sides of the integration would have been internally consistent about the
     * wrong answer.
     */
    expect(SUPPORTS_INTERVAL_COUNT).toBe(true);
    expect(toSafepayRecurrence('quarter')).toEqual({ interval: 'MONTH', count: 3 });
  });

  it('throws on a period it does not know, rather than guessing', () => {
    // Guessing is what the ternary did. A period this file has not been taught
    // is a bug upstream — `billing_plans.period` is constrained — and the only
    // safe response is to refuse to create a plan at all.
    for (const bad of ['week', 'fortnight', 'quarterly', '', 'MONTH']) {
      expect(() => toSafepayRecurrence(bad)).toThrow(/no Safepay recurrence/);
    }
  });

  it('refuses `free`, which has no recurrence at all', () => {
    // Reaching here with a free plan means a caller skipped the check that
    // should have stopped it before a Safepay plan was created.
    expect(() => toSafepayRecurrence('free')).toThrow(/no Safepay recurrence/);
  });
});

describe('chargesPerYear', () => {
  it('counts each period the number of times it is actually billed', () => {
    expect(chargesPerYear('month')).toBe(12);
    expect(chargesPerYear('quarter')).toBe(4);
    expect(chargesPerYear('year')).toBe(1);
  });

  it('agrees with the recurrence it is meant to describe', () => {
    /*
     * The two are one fact. If a quarter is three months to Safepay it has to
     * be four charges a year here, or a price comparison shown to the user
     * disagrees with the schedule they are put on.
     */
    for (const period of ['month', 'quarter', 'year']) {
      const { interval, count } = toSafepayRecurrence(period);
      const monthsBetween = interval === 'YEAR' ? 12 * count : count;
      expect(12 / monthsBetween).toBe(chargesPerYear(period));
    }
  });

  it('throws on an unknown period, like its neighbour', () => {
    expect(() => chargesPerYear('decade')).toThrow(/no charge frequency/);
  });
});

describe('the ladder shipped in 0073', () => {
  it('gets cheaper per month as the commitment gets longer', () => {
    /*
     * Prices in paisa, mirroring the migration's seed. A ladder where a longer
     * commitment costs more per month is one where the discount is a penalty,
     * and it is the kind of arithmetic mistake that survives review because
     * every individual number looks plausible.
     */
    const paisa = { month: 34900, quarter: 92900, year: 314900 };
    const perMonth = (period: keyof typeof paisa) => paisa[period] / (12 / chargesPerYear(period));

    expect(perMonth('month')).toBeGreaterThan(perMonth('quarter'));
    expect(perMonth('quarter')).toBeGreaterThan(perMonth('year'));

    // And the headline savings the paywall will quote.
    expect(Math.round((1 - perMonth('quarter') / perMonth('month')) * 100)).toBe(11);
    expect(Math.round((1 - perMonth('year') / perMonth('month')) * 100)).toBe(25);
  });
});
