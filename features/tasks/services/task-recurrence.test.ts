import {
  nextRecurrenceDueDate,
  WEEKDAY_PRESET,
  type RecurrenceRule,
} from '@/features/tasks/services/task-recurrence';

/** 2026-08-19 is a Wednesday. Every fixture below is built from it so the
 *  weekday arithmetic can be read without a calendar. */
const WED = new Date(2026, 7, 19, 9, 0).getTime();

const rule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  frequency: 'daily',
  interval: 1,
  daysOfWeek: null,
  anchor: 'due_date',
  ...over,
});

const asDate = (ms: number | null) => new Date(ms as number).toDateString();

describe('nextRecurrenceDueDate', () => {
  it('returns null for a task that does not repeat', () => {
    expect(nextRecurrenceDueDate(rule({ frequency: 'none' }), WED, WED)).toBeNull();
  });

  describe('intervals', () => {
    it('repeats every N days', () => {
      expect(asDate(nextRecurrenceDueDate(rule({ interval: 3 }), WED, WED))).toBe(
        'Sat Aug 22 2026',
      );
    });

    it('repeats every N weeks — the fortnightly case the old enum could not express', () => {
      const next = nextRecurrenceDueDate(rule({ frequency: 'weekly', interval: 2 }), WED, WED);
      expect(asDate(next)).toBe('Wed Sep 02 2026');
    });

    it('repeats every N months', () => {
      const next = nextRecurrenceDueDate(rule({ frequency: 'monthly', interval: 3 }), WED, WED);
      expect(asDate(next)).toBe('Thu Nov 19 2026');
    });

    it('repeats every N years', () => {
      const next = nextRecurrenceDueDate(rule({ frequency: 'yearly', interval: 1 }), WED, WED);
      expect(asDate(next)).toBe('Thu Aug 19 2027');
    });

    it('keeps the time of day', () => {
      const next = nextRecurrenceDueDate(rule(), WED, WED) as number;
      expect(new Date(next).getHours()).toBe(9);
      expect(new Date(next).getMinutes()).toBe(0);
    });
  });

  describe('a rule that came out of the database', () => {
    // An interval of 0 would repeat forever on the same day, and a negative one
    // walks backwards, generating overdue clones on every completion.
    it('treats a zero interval as 1 rather than repeating in place', () => {
      expect(asDate(nextRecurrenceDueDate(rule({ interval: 0 }), WED, WED))).toBe(
        'Thu Aug 20 2026',
      );
    });

    it('treats a negative interval as 1 rather than walking backwards', () => {
      expect(asDate(nextRecurrenceDueDate(rule({ interval: -4 }), WED, WED))).toBe(
        'Thu Aug 20 2026',
      );
    });
  });

  describe('weekly on chosen days', () => {
    const monWedFri = { frequency: 'weekly' as const, daysOfWeek: [1, 3, 5] };

    it('moves to the next chosen day in the same week', () => {
      // Wednesday -> Friday, not Wednesday + 7.
      expect(asDate(nextRecurrenceDueDate(rule(monWedFri), WED, WED))).toBe('Fri Aug 21 2026');
    });

    it('wraps to the first chosen day of the next week', () => {
      const FRI = new Date(2026, 7, 21, 9, 0).getTime();
      expect(asDate(nextRecurrenceDueDate(rule(monWedFri), FRI, FRI))).toBe('Mon Aug 24 2026');
    });

    it('applies the interval to the wrap, not to each day', () => {
      // "Every 2 weeks on Mon/Wed/Fri" is both days of one week then a
      // fortnight's gap — not Mon, skip, Wed, skip.
      const FRI = new Date(2026, 7, 21, 9, 0).getTime();
      expect(asDate(nextRecurrenceDueDate(rule({ ...monWedFri, interval: 2 }), FRI, FRI))).toBe(
        'Mon Aug 31 2026',
      );
    });

    it('handles the weekday preset', () => {
      const FRI = new Date(2026, 7, 21, 9, 0).getTime();
      const next = nextRecurrenceDueDate(
        rule({ frequency: 'weekly', daysOfWeek: WEEKDAY_PRESET }),
        FRI,
        FRI,
      );
      expect(asDate(next)).toBe('Mon Aug 24 2026');
    });

    it('falls back to plain weekly when no day is selected', () => {
      const next = nextRecurrenceDueDate(rule({ frequency: 'weekly', daysOfWeek: [] }), WED, WED);
      expect(asDate(next)).toBe('Wed Aug 26 2026');
    });

    it('ignores out-of-range days rather than producing a wild date', () => {
      const next = nextRecurrenceDueDate(
        rule({ frequency: 'weekly', daysOfWeek: [9, -2, 5] }),
        WED,
        WED,
      );
      expect(asDate(next)).toBe('Fri Aug 21 2026');
    });
  });

  describe('month-end clamping', () => {
    it('does not skid into the next month from the 31st', () => {
      // Jan 31 + 1 month is Feb 28, not Mar 3 — otherwise the task drifts a
      // further day every month it repeats.
      const JAN_31 = new Date(2026, 0, 31, 9, 0).getTime();
      const next = nextRecurrenceDueDate(rule({ frequency: 'monthly' }), JAN_31, JAN_31);
      expect(asDate(next)).toBe('Sat Feb 28 2026');
    });

    it('clamps a 29 February yearly repeat', () => {
      const LEAP = new Date(2028, 1, 29, 9, 0).getTime();
      const next = nextRecurrenceDueDate(rule({ frequency: 'yearly' }), LEAP, LEAP);
      expect(asDate(next)).toBe('Wed Feb 28 2029');
    });
  });

  describe('anchored on completion', () => {
    const completion = { anchor: 'completion' as const, interval: 3 };

    it('counts from the day it was finished, not the day it was due', () => {
      // Due Wednesday, actually done the following Monday: next is Monday + 3.
      const MON = new Date(2026, 7, 24, 22, 30).getTime();
      expect(asDate(nextRecurrenceDueDate(rule(completion), WED, MON))).toBe('Thu Aug 27 2026');
    });

    it('keeps the due time, so a late-night tick does not reschedule to midnight', () => {
      const LATE = new Date(2026, 7, 24, 23, 48).getTime();
      const next = nextRecurrenceDueDate(rule(completion), WED, LATE) as number;
      expect(new Date(next).getHours()).toBe(9);
      expect(new Date(next).getMinutes()).toBe(0);
    });

    it('still follows the due date when anchored there', () => {
      const MON = new Date(2026, 7, 24, 22, 30).getTime();
      expect(asDate(nextRecurrenceDueDate(rule({ interval: 3 }), WED, MON))).toBe(
        'Sat Aug 22 2026',
      );
    });
  });
});
