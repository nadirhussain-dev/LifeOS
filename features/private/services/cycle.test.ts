import {
  averageCycleLength,
  dayOfCycle,
  periodsFrom,
  predictedNextStart,
  type CycleEntry,
} from '@/features/private/services/cycle-math';

/** The `yyyy-MM-dd` key for a date in LOCAL time — the same day boundary the
 *  app uses everywhere. Never build one from `toISOString()`, which is UTC. */
const localKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

const entry = (date: string, flow: CycleEntry['flow']): CycleEntry => ({
  id: date,
  createdAt: 0,
  updatedAt: 0,
  date,
  flow,
  symptoms: [],
  mood: null,
  note: '',
});

describe('periodsFrom', () => {
  it('groups consecutive bleeding days into one period', () => {
    const periods = periodsFrom([
      entry('2026-01-01', 'medium'),
      entry('2026-01-02', 'heavy'),
      entry('2026-01-03', 'light'),
    ]);
    expect(periods).toEqual([{ start: '2026-01-01', end: '2026-01-03', days: 3 }]);
  });

  it('does not split a period across a single missed day', () => {
    // People forget to log. Treating a one-day gap as a new period would
    // double the period count and halve the average cycle length.
    const periods = periodsFrom([entry('2026-01-01', 'medium'), entry('2026-01-03', 'light')]);
    expect(periods).toHaveLength(1);
    expect(periods[0]).toEqual({ start: '2026-01-01', end: '2026-01-03', days: 3 });
  });

  it('splits when the gap is genuinely a new cycle', () => {
    const periods = periodsFrom([entry('2026-01-01', 'medium'), entry('2026-01-29', 'medium')]);
    expect(periods).toHaveLength(2);
    expect(periods[0].start).toBe('2026-01-29');
  });

  it('ignores symptom-only days', () => {
    // PMS logged before bleeding starts must not extend the period backwards.
    const periods = periodsFrom([entry('2026-01-01', null), entry('2026-01-03', 'medium')]);
    expect(periods).toEqual([{ start: '2026-01-03', end: '2026-01-03', days: 1 }]);
  });

  it('returns nothing when nothing has been logged', () => {
    expect(periodsFrom([])).toEqual([]);
  });
});

describe('averageCycleLength', () => {
  const cycleStartingOn = (dates: string[]) =>
    periodsFrom(dates.map((d) => entry(d, 'medium' as const)));

  it('refuses to average a single gap', () => {
    // One gap is a data point, not an average — and presenting it as one is
    // how a tracker confidently names the wrong week.
    expect(averageCycleLength(cycleStartingOn(['2026-01-01', '2026-01-29']))).toBeNull();
  });

  it('averages once there are enough cycles', () => {
    const periods = cycleStartingOn(['2026-01-01', '2026-01-29', '2026-02-26']);
    expect(averageCycleLength(periods)).toBe(28);
  });

  it('discards an implausible gap rather than letting it skew the mean', () => {
    // A mis-typed year is the common case, and without the guard it drags the
    // average to something absurd.
    const periods = cycleStartingOn(['2026-01-01', '2026-01-29', '2026-02-26', '2027-06-01']);
    expect(averageCycleLength(periods)).toBe(28);
  });
});

describe('predictedNextStart', () => {
  it('projects from the most recent period', () => {
    const periods = periodsFrom(
      ['2026-01-01', '2026-01-29', '2026-02-26'].map((d) => entry(d, 'medium')),
    );
    expect(predictedNextStart(periods, 28)).toBe('2026-03-26');
  });

  it('lands on the right calendar day across a daylight-saving change', () => {
    // The bug this guards: adding 28 × 86,400,000 ms to a local midnight lands
    // an hour early once the clocks move, and the ISO date then reads as the
    // day before. A cycle due 26 March displayed as 25 March, twice a year,
    // for everybody in a DST timezone.
    const periods = periodsFrom(
      ['2026-01-01', '2026-01-29', '2026-02-26'].map((d) => entry(d, 'medium')),
    );
    expect(predictedNextStart(periods, 28)).toBe('2026-03-26');

    // And the other direction, across the autumn change.
    const autumn = periodsFrom(
      ['2026-08-06', '2026-09-03', '2026-10-01'].map((d) => entry(d, 'medium')),
    );
    expect(predictedNextStart(autumn, 28)).toBe('2026-10-29');
  });

  it('says nothing without an average', () => {
    const periods = periodsFrom([entry('2026-01-01', 'medium')]);
    expect(predictedNextStart(periods, null)).toBeNull();
  });
});

describe('dayOfCycle', () => {
  it('counts the first day of a period as day 1', () => {
    // A fixed instant, and a key derived from it in LOCAL time.
    //
    // This read `new Date().toISOString().slice(0, 10)`, which is the date in
    // UTC, and compared it against `dayOfCycle`, which counts local calendar
    // days. Every evening west of Greenwich the two disagree, so the test
    // logged a period starting *tomorrow* and asserted it was day 1 — it is day
    // 0. CI runs in UTC and never saw it; it failed only on the machines of
    // people in the Americas, only after about 5pm, which is close to the worst
    // possible signal a test can give.
    const start = new Date(2026, 4, 17, 9, 0);
    expect(dayOfCycle(periodsFrom([entry(localKey(start), 'medium')]), start)).toBe(1);
  });

  it('counts a period that started three days ago as day 4', () => {
    const start = new Date(2026, 4, 17, 9, 0);
    const now = new Date(2026, 4, 20, 23, 30);
    expect(dayOfCycle(periodsFrom([entry(localKey(start), 'medium')]), now)).toBe(4);
  });

  it('is null before anything is logged', () => {
    expect(dayOfCycle([])).toBeNull();
  });
});
