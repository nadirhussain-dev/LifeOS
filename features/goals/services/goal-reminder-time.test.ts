import { reminderTime } from '@/features/goals/services/goal-reminder-time';
import type { GoalReminderSettings } from '@/features/goals/store/goal-reminder-store';

const at = (daysBefore: number, hour = 9, minute = 0): GoalReminderSettings => ({
  enabled: true,
  daysBefore,
  hour,
  minute,
});

/** Local-time constructor, deliberately. The whole point of this function is
 *  that it reasons in the user's calendar, so a test that speaks UTC would be
 *  testing something else — see 3dd6f71 and a7dfbdc for the two places that
 *  mistake had already been made in this repo. */
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe('reminderTime', () => {
  it('fires on the due date itself when daysBefore is 0', () => {
    const due = local(2026, 5, 17, 23, 40);
    const fire = new Date(reminderTime(due.getTime(), at(0)));
    expect([fire.getFullYear(), fire.getMonth() + 1, fire.getDate()]).toEqual([2026, 5, 17]);
    expect([fire.getHours(), fire.getMinutes()]).toEqual([9, 0]);
  });

  it('ignores the time of day the deadline happens to carry', () => {
    // A goal created at 23:40 stores that time on its due date. Subtracting raw
    // milliseconds would remind at 23:40; "at 9am" has to mean 9am.
    const late = reminderTime(local(2026, 5, 17, 23, 40).getTime(), at(3));
    const early = reminderTime(local(2026, 5, 17, 0, 5).getTime(), at(3));
    expect(late).toBe(early);
    expect(new Date(late).getHours()).toBe(9);
  });

  it('counts back in calendar days', () => {
    const fire = new Date(reminderTime(local(2026, 5, 17).getTime(), at(3)));
    expect([fire.getMonth() + 1, fire.getDate()]).toEqual([5, 14]);
  });

  it('walks back across a month boundary', () => {
    const fire = new Date(reminderTime(local(2026, 3, 2).getTime(), at(7)));
    expect([fire.getMonth() + 1, fire.getDate()]).toEqual([2, 23]);
  });

  it('walks back across a leap day', () => {
    // 2028 is a leap year, so seven days before 2 March is 24 February.
    const fire = new Date(reminderTime(local(2028, 3, 2).getTime(), at(7)));
    expect([fire.getMonth() + 1, fire.getDate()]).toEqual([2, 24]);
  });

  it('walks back across a year boundary', () => {
    const fire = new Date(reminderTime(local(2026, 1, 3).getTime(), at(7)));
    expect([fire.getFullYear(), fire.getMonth() + 1, fire.getDate()]).toEqual([2025, 12, 27]);
  });

  it('keeps the wall-clock time across a daylight-saving change', () => {
    // Whatever this machine's timezone, a reminder set for 09:00 must land on
    // 09:00 — subtracting 14 days in milliseconds would land on 08:00 or 10:00
    // wherever a DST boundary falls inside the window.
    const fire = new Date(reminderTime(local(2026, 4, 5, 12, 0).getTime(), at(14, 9, 30)));
    expect([fire.getHours(), fire.getMinutes()]).toEqual([9, 30]);
  });

  it('always lands before the deadline', () => {
    const due = local(2026, 5, 17, 8, 0).getTime();
    // Even at daysBefore 0 with a reminder hour later than the deadline's own
    // time, this is the one case where it can land after — worth knowing rather
    // than discovering. The scheduler drops anything already past.
    expect(reminderTime(due, at(1))).toBeLessThan(due);
    expect(reminderTime(due, at(3))).toBeLessThan(due);
  });
});
