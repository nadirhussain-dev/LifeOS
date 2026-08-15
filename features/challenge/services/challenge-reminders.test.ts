import { atRiskReminderDate } from './challenge-reminders';

/**
 * The scheduling window, tested directly.
 *
 * The whole reason this reminder can exist as a *local* notification is that it
 * is re-queued from current state rather than set once in the morning — and the
 * one piece of that with arithmetic in it is "is there still time today". Get it
 * wrong in the permissive direction and the app schedules a notification for a
 * moment that has already passed, which some platforms deliver immediately: a
 * "you are about to lose today" alert firing at 22:40, after the point of
 * acting on it.
 */
describe('atRiskReminderDate', () => {
  it('fires at 20:00 local when the day still has room', () => {
    const at = atRiskReminderDate(new Date(2026, 7, 14, 9, 30));
    expect(at).not.toBeNull();
    const fireAt = new Date(at as number);
    expect(fireAt.getHours()).toBe(20);
    expect(fireAt.getMinutes()).toBe(0);
    expect(fireAt.getSeconds()).toBe(0);
    expect(fireAt.getDate()).toBe(14);
  });

  it('schedules nothing once the hour has passed', () => {
    // Deliberately not "tomorrow at 20:00": tomorrow's reminder is somebody
    // else's problem, and it will be queued by the next write anyway.
    expect(atRiskReminderDate(new Date(2026, 7, 14, 20, 0, 1))).toBeNull();
    expect(atRiskReminderDate(new Date(2026, 7, 14, 23, 55))).toBeNull();
  });

  it('treats the boundary as too late rather than just in time', () => {
    expect(atRiskReminderDate(new Date(2026, 7, 14, 20, 0, 0))).toBeNull();
  });
});
