import {
  cancelCalendarEventReminder,
  scheduleCalendarEventReminder,
} from '@/features/timeline/services/calendar-event-reminders';
import type { CalendarEvent } from '@/features/timeline/types/timeline.types';

/**
 * Calendar event reminders, and the first test `features/timeline` has had.
 *
 * Both of this file's own comments describe bugs it was written to close, and
 * neither had a test holding it shut:
 *
 *  - **Cancel before scheduling.** Without it, a resync (or a second save of
 *    the same event) leaves the previous notification queued alongside the new
 *    one, so an event edited three times fires three reminders.
 *  - **Clear the column on cancel.** Skipping it leaves the row pointing at an
 *    id the OS has forgotten, and a later sync "cancels" whatever now holds
 *    that id — someone else's reminder — while the event still looks armed.
 *
 * Both are silent in the direction that matters: nothing errors, the reminder
 * count is just wrong.
 */

const mockCancel = jest.fn();
const mockSchedule = jest.fn();
const mockSetNotificationId = jest.fn();

jest.mock('@/lib/notifications', () => ({
  cancelNotification: (...args: unknown[]) => mockCancel(...args),
  scheduleOneTimeNotification: (...args: unknown[]) => mockSchedule(...args),
}));

jest.mock('@/features/timeline/services/calendar-events-repository', () => ({
  setCalendarEventReminderNotificationId: (...args: unknown[]) => mockSetNotificationId(...args),
}));

jest.mock('@/lib/i18n', () => ({
  __esModule: true,
  default: {
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${vars.count}` : key),
  },
}));

/** 15 June 2026, 14:00 local. */
const START = new Date(2026, 5, 15, 14, 0, 0).getTime();

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    title: 'Dentist',
    startAt: START,
    endAt: null,
    colorToken: null,
    notes: null,
    reminderMinutesBefore: 30,
    reminderNotificationId: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSchedule.mockResolvedValue('notif-new');
});

describe('scheduleCalendarEventReminder', () => {
  it('cancels the previous notification before scheduling the new one', async () => {
    // The documented bug. Order matters as much as the call: cancelling after
    // scheduling would race the id it has just written.
    await scheduleCalendarEventReminder(event({ reminderNotificationId: 'notif-old' }));

    expect(mockCancel).toHaveBeenCalledWith('notif-old');
    expect(mockCancel.mock.invocationCallOrder[0]).toBeLessThan(
      mockSchedule.mock.invocationCallOrder[0],
    );
  });

  it('stores the new notification id against the event', async () => {
    // Without this the next cancel has nothing to cancel.
    await scheduleCalendarEventReminder(event());

    expect(mockSetNotificationId).toHaveBeenCalledWith('evt-1', 'notif-new');
  });

  it('fires the reminder the requested number of minutes before the start', async () => {
    await scheduleCalendarEventReminder(event({ reminderMinutesBefore: 30 }));

    const [{ date }] = mockSchedule.mock.calls[0];
    expect(date).toBe(START - 30 * 60_000);
  });

  it('fires at the start itself when the offset is zero', async () => {
    // Zero is a real choice, not an absent one — and `== null` rather than
    // falsiness is what keeps it working. A `!reminderMinutesBefore` check here
    // would silently drop every "at time of event" reminder.
    await scheduleCalendarEventReminder(event({ reminderMinutesBefore: 0 }));

    expect(mockSchedule).toHaveBeenCalled();
    const [{ date, body }] = mockSchedule.mock.calls[0];
    expect(date).toBe(START);
    expect(body).toBe('timeline.reminderStartingNow');
  });

  it('uses the counted copy for a non-zero offset', async () => {
    await scheduleCalendarEventReminder(event({ reminderMinutesBefore: 15 }));

    const [{ body }] = mockSchedule.mock.calls[0];
    expect(body).toBe('timeline.reminderStartingIn:15');
  });

  it('clears the column and schedules nothing when the reminder is switched off', async () => {
    // Turning a reminder off has to leave the row clean, or the event goes on
    // looking armed on every screen that reads the column.
    await scheduleCalendarEventReminder(
      event({ reminderMinutesBefore: null, reminderNotificationId: 'notif-old' }),
    );

    expect(mockCancel).toHaveBeenCalledWith('notif-old');
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(mockSetNotificationId).toHaveBeenCalledWith('evt-1', null);
  });

  it('deep-links to the day the event starts on', async () => {
    // The tap target is the timeline for that date. A wrong date here lands the
    // person on an empty day and the reminder looks like it fired for nothing.
    await scheduleCalendarEventReminder(event());

    const [{ data }] = mockSchedule.mock.calls[0];
    expect(data.route).toBe('/timeline/[date]');
    expect(data.params).toEqual({ date: '2026-06-15' });
  });

  it('tags the notification with its category and dedupe key', async () => {
    // The category is what the master and per-category switches act on; the key
    // is how a resync recognises its own reminder rather than duplicating it.
    await scheduleCalendarEventReminder(event());

    const [{ data }] = mockSchedule.mock.calls[0];
    expect(data.category).toBe('calendar');
    expect(data.key).toBe('calendar:evt-1');
  });

  it('carries the event title as the notification title', async () => {
    await scheduleCalendarEventReminder(event({ title: 'Flight to Karachi' }));

    const [{ title }] = mockSchedule.mock.calls[0];
    expect(title).toBe('Flight to Karachi');
  });

  it('schedules a reminder whose trigger has already passed rather than guessing', async () => {
    // Deliberately not filtered here: the scheduler owns the past-trigger rule,
    // and dropping it in two places is how one of them drifts. This asserts the
    // call is still made, so that decision stays in one file.
    await scheduleCalendarEventReminder(
      event({ startAt: Date.now() - 86_400_000, reminderMinutesBefore: 10 }),
    );

    expect(mockSchedule).toHaveBeenCalled();
  });
});

describe('cancelCalendarEventReminder', () => {
  it('cancels the notification and clears the column', async () => {
    // The second documented bug: cancelling the OS notification without
    // clearing the column leaves a dangling id that a later sync will act on.
    await cancelCalendarEventReminder({ id: 'evt-1', reminderNotificationId: 'notif-1' });

    expect(mockCancel).toHaveBeenCalledWith('notif-1');
    expect(mockSetNotificationId).toHaveBeenCalledWith('evt-1', null);
  });

  it('still clears the column when there was no notification id', async () => {
    // Idempotence. Cancelling twice, or cancelling an event that never had a
    // reminder, must leave the same clean state rather than skipping the write.
    await cancelCalendarEventReminder({ id: 'evt-1', reminderNotificationId: null });

    expect(mockSetNotificationId).toHaveBeenCalledWith('evt-1', null);
  });
});
