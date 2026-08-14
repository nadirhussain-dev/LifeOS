import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';

import { bootstrapDatabase, type BootstrapTarget } from '@/database/bootstrap';
import * as schema from '@/database/schema';
import {
  listNotificationLog,
  logScheduledNotification,
  markNotificationRead,
  reconcilePassedNotifications,
  recordMissedRepeatingDeliveries,
  unreadNotificationCount,
} from '@/features/notifications/services/notification-log-repository';

/**
 * The bug this covers, seen on a real device.
 *
 * A task reminder fired at 05:12 with the app closed. The tray showed it. The
 * inbox, opened at 05:35, did not — and the bell badge read zero, because
 * arrivals are recorded by an expo listener that only runs in a live process.
 * `notificationStatus` called the same row "delivered" from the clock, so the
 * list and the badge were reading one table and disagreeing about it.
 *
 * Run against real SQLite rather than a mocked `getDb`, because the fix IS a
 * WHERE clause: which rows it matches is the entire behaviour, and a stubbed
 * query object would only prove the function was called.
 */

/** node:sqlite dressed as the surface drizzle's expo-sqlite driver calls:
 *  `prepareSync(sql)`, then `executeSync(params)` carrying both a changes count
 *  and the row accessors. Same engine expo-sqlite embeds, different build. */
function open() {
  const db = new DatabaseSync(':memory:');
  const adapted = Object.assign(db, {
    execSync: (sql: string) => db.exec(sql),
    getAllSync: <T>(sql: string) => db.prepare(sql).all() as T[],
    prepareSync: (sql: string) => {
      const stmt = db.prepare(sql);
      return {
        executeSync: (params: unknown[] = []) => {
          let ran: { changes: number | bigint; lastInsertRowid: number | bigint } | null = null;
          // Lazy: drizzle's run() reads `changes`, while all()/get() go
          // straight to the row accessors and must not execute twice.
          const runOnce = () => (ran ??= stmt.run(...(params as [])));
          return {
            get changes() {
              return Number(runOnce().changes);
            },
            get lastInsertRowId() {
              return Number(runOnce().lastInsertRowid);
            },
            getAllSync: () => stmt.all(...(params as [])),
            getFirstSync: () => stmt.get(...(params as [])),
          };
        },
        executeForRawResultSync: (params: unknown[] = []) => ({
          getAllSync: () =>
            (stmt.all(...(params as [])) as Record<string, unknown>[]).map((row) =>
              Object.values(row),
            ),
        }),
        finalizeSync: () => undefined,
      };
    },
  });
  bootstrapDatabase(adapted as unknown as BootstrapTarget);
  return adapted;
}

/** `mock`-prefixed because jest hoists the factory above every other
 *  declaration in the file, and only that prefix is allowed through. */
let mockDb: ReturnType<typeof drizzle>;

jest.mock('@/database/client', () => ({
  getDb: () => mockDb,
}));

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  mockDb = drizzle(open() as never, { schema });
});

describe('reconcilePassedNotifications', () => {
  it('stamps a one-time reminder whose moment has passed', () => {
    logScheduledNotification({
      notificationId: 'os-1',
      category: 'tasks',
      title: 'Test',
      body: 'It’s due now.',
      scheduledAt: NOW - HOUR,
      repeats: 'none',
    });

    // The state the device was in: listed by the inbox, invisible to the badge.
    expect(unreadNotificationCount()).toBe(0);

    expect(reconcilePassedNotifications(NOW)).toBe(1);
    expect(unreadNotificationCount()).toBe(1);
  });

  it('records when it arrived, not when the app reopened', () => {
    // Five hours later the inbox should still read "5 hours ago", not "now".
    logScheduledNotification({
      notificationId: 'os-1',
      category: 'notes',
      title: 'Note',
      body: '',
      scheduledAt: NOW - 5 * HOUR,
      repeats: 'none',
    });
    reconcilePassedNotifications(NOW);

    expect(listNotificationLog()[0].deliveredAt).toBe(NOW - 5 * HOUR);
  });

  it('leaves a reminder that has not fired yet alone', () => {
    logScheduledNotification({
      notificationId: 'os-1',
      category: 'tasks',
      title: 'Later',
      body: '',
      scheduledAt: NOW + HOUR,
      repeats: 'none',
    });

    expect(reconcilePassedNotifications(NOW)).toBe(0);
    expect(unreadNotificationCount()).toBe(0);
  });

  it('never stamps a repeating reminder', () => {
    // Its scheduledAt is the NEXT occurrence, so "past" is meaningless and
    // stamping it would consume the schedule row as if it were an arrival.
    logScheduledNotification({
      notificationId: 'os-1',
      category: 'water',
      title: 'Time to hydrate',
      body: '',
      scheduledAt: NOW - HOUR,
      repeats: 'daily',
    });

    expect(reconcilePassedNotifications(NOW)).toBe(0);
    expect(listNotificationLog()[0].deliveredAt).toBeNull();
  });

  it('is idempotent — a second pass finds nothing left to do', () => {
    logScheduledNotification({
      notificationId: 'os-1',
      category: 'tasks',
      title: 'Test',
      body: '',
      scheduledAt: NOW - HOUR,
      repeats: 'none',
    });

    expect(reconcilePassedNotifications(NOW)).toBe(1);
    expect(reconcilePassedNotifications(NOW)).toBe(0);
    expect(unreadNotificationCount()).toBe(1);
  });

  it('leaves repeating reminders to recordMissedRepeatingDeliveries', () => {
    // The two catch-ups must not both claim the same row, or one arrival lands
    // in the inbox twice.
    logScheduledNotification({
      notificationId: 'os-1',
      category: 'habits',
      title: 'Gym',
      body: '',
      scheduledAt: NOW - HOUR,
      repeats: 'weekly',
    });
    expect(reconcilePassedNotifications(NOW)).toBe(0);
  });

  it('does not resurrect a reminder that was already read', () => {
    const id = logScheduledNotification({
      notificationId: 'os-1',
      category: 'tasks',
      title: 'Test',
      body: '',
      scheduledAt: NOW - HOUR,
      repeats: 'none',
    });
    reconcilePassedNotifications(NOW);
    markNotificationRead(id);

    expect(unreadNotificationCount()).toBe(0);
    expect(reconcilePassedNotifications(NOW)).toBe(0);
    expect(unreadNotificationCount()).toBe(0);
  });
});

describe('recordMissedRepeatingDeliveries', () => {
  /** A daily reminder whose next fire is 20h out — so it last fired 4h ago. */
  const dailyReminder = (title = 'Time to hydrate') =>
    logScheduledNotification({
      notificationId: `os-${title}`,
      category: 'water',
      title,
      body: 'It’s been a while.',
      scheduledAt: NOW + 20 * HOUR,
      repeats: 'daily',
    });

  it('records an occurrence the app was closed for', () => {
    dailyReminder();
    expect(recordMissedRepeatingDeliveries(NOW - 6 * HOUR, NOW)).toBe(1);
    expect(unreadNotificationCount()).toBe(1);
  });

  it('leaves the schedule row pointing at the next fire', () => {
    // The whole reason repeating rows were skipped before: consuming the
    // schedule row would lose the next occurrence.
    dailyReminder();
    recordMissedRepeatingDeliveries(NOW - 6 * HOUR, NOW);

    const schedule = listNotificationLog().find((n) => n.repeats === 'daily');
    expect(schedule?.scheduledAt).toBe(NOW + 20 * HOUR);
    expect(schedule?.deliveredAt).toBeNull();
  });

  it('says nothing about an occurrence the live listener already caught', () => {
    dailyReminder();
    expect(recordMissedRepeatingDeliveries(NOW - HOUR, NOW)).toBe(0);
  });

  it('records one row per schedule, not one per missed morning', () => {
    dailyReminder();
    expect(recordMissedRepeatingDeliveries(NOW - 30 * 24 * HOUR, NOW)).toBe(1);
  });

  it('caps a long absence across many schedules', () => {
    for (let i = 0; i < 8; i++) dailyReminder(`Reminder ${i}`);
    expect(recordMissedRepeatingDeliveries(NOW - 30 * 24 * HOUR, NOW, 3)).toBe(3);
  });

  it('ignores one-time rows, which the other catch-up owns', () => {
    logScheduledNotification({
      notificationId: 'os-1',
      category: 'tasks',
      title: 'Test',
      body: '',
      scheduledAt: NOW - HOUR,
      repeats: 'none',
    });
    expect(recordMissedRepeatingDeliveries(NOW - 6 * HOUR, NOW)).toBe(0);
  });

  it('is safe to run twice — the second pass has a fresher watermark', () => {
    dailyReminder();
    expect(recordMissedRepeatingDeliveries(NOW - 6 * HOUR, NOW)).toBe(1);
    // The resync advances the watermark to `now` before the next launch.
    expect(recordMissedRepeatingDeliveries(NOW, NOW)).toBe(0);
    expect(unreadNotificationCount()).toBe(1);
  });
});
