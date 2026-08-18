import {
  CATCHUP_LIMIT,
  dueOccurrences,
  nextOccurrence,
  occurrenceTransactionId,
  type RecurringRule,
} from '@/features/budget/services/recurring-transactions';

const rule = (over: Partial<RecurringRule> = {}): RecurringRule => ({
  frequency: 'monthly',
  interval: 1,
  anchorDate: '2026-01-15',
  lastPostedDate: null,
  isActive: true,
  ...over,
});

const on = (iso: string) => new Date(`${iso}T12:00:00`);

describe('dueOccurrences', () => {
  it('owes the anchor occurrence once the date arrives', () => {
    expect(dueOccurrences(rule(), on('2026-01-15'))).toEqual(['2026-01-15']);
  });

  it('owes nothing before the anchor', () => {
    expect(dueOccurrences(rule(), on('2026-01-14'))).toEqual([]);
  });

  it('owes every occurrence up to today', () => {
    expect(dueOccurrences(rule(), on('2026-03-20'))).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
    ]);
  });

  it('owes nothing already posted', () => {
    const posted = rule({ lastPostedDate: '2026-02-15' });
    expect(dueOccurrences(posted, on('2026-03-20'))).toEqual(['2026-03-15']);
  });

  it('does not post the same occurrence twice on the same day', () => {
    // The idempotency that keeps a launch-time catch-up safe to run on every
    // launch. Anything else doubles somebody's rent in their own records.
    const posted = rule({ lastPostedDate: '2026-03-15' });
    expect(dueOccurrences(posted, on('2026-03-15'))).toEqual([]);
  });

  it('respects an inactive rule', () => {
    expect(dueOccurrences(rule({ isActive: false }), on('2026-06-01'))).toEqual([]);
  });

  describe('cadence', () => {
    it('handles every N weeks', () => {
      const fortnightly = rule({ frequency: 'weekly', interval: 2, anchorDate: '2026-01-01' });
      expect(dueOccurrences(fortnightly, on('2026-01-30'))).toEqual([
        '2026-01-01',
        '2026-01-15',
        '2026-01-29',
      ]);
    });

    it('handles every N months', () => {
      const quarterly = rule({ interval: 3, anchorDate: '2026-01-10' });
      expect(dueOccurrences(quarterly, on('2026-08-01'))).toEqual([
        '2026-01-10',
        '2026-04-10',
        '2026-07-10',
      ]);
    });

    it('handles yearly', () => {
      const yearly = rule({ frequency: 'yearly', anchorDate: '2024-02-20' });
      expect(dueOccurrences(yearly, on('2026-03-01'))).toEqual([
        '2024-02-20',
        '2025-02-20',
        '2026-02-20',
      ]);
    });
  });

  describe('month-end', () => {
    it('clamps only where it must, and recovers afterwards', () => {
      // The bug this pins. Stepping from each occurrence to the next compounds
      // the clamp — 31 Jan becomes 28 Feb, and every month after that is the
      // 28th forever. Indexing from the anchor gives back the 31st in March.
      const rent = rule({ anchorDate: '2026-01-31' });
      expect(dueOccurrences(rent, on('2026-04-05'))).toEqual([
        '2026-01-31',
        '2026-02-28',
        '2026-03-31',
      ]);
    });

    it('keeps a 30th-anchored rule on the 30th through February', () => {
      const rule30 = rule({ anchorDate: '2026-01-30' });
      expect(dueOccurrences(rule30, on('2026-05-05'))).toEqual([
        '2026-01-30',
        '2026-02-28',
        '2026-03-30',
        '2026-04-30',
      ]);
    });

    it('does not drift a February-clamped yearly rule', () => {
      const leap = rule({ frequency: 'yearly', anchorDate: '2024-02-29' });
      expect(dueOccurrences(leap, on('2028-06-01'))).toEqual([
        '2024-02-29',
        '2025-02-28',
        '2026-02-28',
        '2027-02-28',
        '2028-02-29',
      ]);
    });
  });

  describe('a rule out of the database', () => {
    it('treats a zero interval as 1 instead of looping forever', () => {
      const broken = rule({ interval: 0, anchorDate: '2026-01-15' });
      expect(dueOccurrences(broken, on('2026-03-20'))).toEqual([
        '2026-01-15',
        '2026-02-15',
        '2026-03-15',
      ]);
    });

    it('treats a negative interval as 1', () => {
      const broken = rule({ interval: -3 });
      expect(dueOccurrences(broken, on('2026-02-20'))).toHaveLength(2);
    });

    it('owes nothing for an unparseable anchor', () => {
      expect(dueOccurrences(rule({ anchorDate: 'not-a-date' }), on('2026-06-01'))).toEqual([]);
    });
  });

  describe('catch-up after a long absence', () => {
    it('is bounded', () => {
      // A year away must not produce twelve months of invented rent. Those
      // transactions did not happen as far as the bank is concerned, and a
      // ledger full of plausible fiction is worse than one with a gap.
      const long = rule({ anchorDate: '2024-01-15' });
      const due = dueOccurrences(long, on('2026-06-20'));
      expect(due.length).toBeLessThanOrEqual(CATCHUP_LIMIT);
    });

    it('keeps the most recent occurrences, not the oldest', () => {
      // If only some can be posted, the ones that matter to this month's budget
      // are the recent ones.
      const long = rule({ anchorDate: '2024-01-15' });
      const due = dueOccurrences(long, on('2026-06-20'));
      expect(due[due.length - 1]).toBe('2026-06-15');
    });
  });
});

describe('nextOccurrence', () => {
  it('looks forward, not back', () => {
    expect(nextOccurrence(rule(), on('2026-02-20'))).toBe('2026-03-15');
  });

  it('returns the anchor when it has not happened yet', () => {
    expect(nextOccurrence(rule(), on('2026-01-01'))).toBe('2026-01-15');
  });

  it('has no answer for an inactive rule', () => {
    expect(nextOccurrence(rule({ isActive: false }), on('2026-01-01'))).toBeNull();
  });

  it('has no answer for an unparseable anchor', () => {
    expect(nextOccurrence(rule({ anchorDate: '' }), on('2026-01-01'))).toBeNull();
  });
});

describe('occurrenceTransactionId', () => {
  it('is derived from the rule and the date', () => {
    // Two devices catching up offline compute the same id, so the upsert
    // collapses them rather than posting the rent twice.
    expect(occurrenceTransactionId('r1', '2026-03-15')).toBe('recurring:r1:2026-03-15');
    expect(occurrenceTransactionId('r1', '2026-03-15')).toBe(
      occurrenceTransactionId('r1', '2026-03-15'),
    );
  });

  it('differs per occurrence and per rule', () => {
    expect(occurrenceTransactionId('r1', '2026-03-15')).not.toBe(
      occurrenceTransactionId('r1', '2026-04-15'),
    );
    expect(occurrenceTransactionId('r1', '2026-03-15')).not.toBe(
      occurrenceTransactionId('r2', '2026-03-15'),
    );
  });
});
