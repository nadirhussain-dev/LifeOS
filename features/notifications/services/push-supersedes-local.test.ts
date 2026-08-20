import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';

import { bootstrapDatabase, type BootstrapTarget } from '@/database/bootstrap';
import * as schema from '@/database/schema';

/**
 * A keyed push stands the local reminder down — and a local one never stands
 * itself down.
 *
 * This is the contract that lets push and local coexist. A local notification
 * carries text fixed when it was scheduled and cannot evaluate anything at fire
 * time; a server can. So a push about `challenge:at-risk` has to be able to
 * cancel the queued local reminder, or the user gets both — the duplicate this
 * whole body of work removes, reintroduced from the other side.
 *
 * The dangerous half is the guard. Every local notification arrives at the same
 * listener carrying the same key, and a *repeating* one is still queued when it
 * fires. Cancelling on that arrival would delete somebody's daily habit
 * reminder the first morning it went off — a far worse bug than the one being
 * fixed, and completely silent.
 */

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

let mockDb: ReturnType<typeof drizzle>;

jest.mock('@/database/client', () => ({ getDb: () => mockDb }));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'bare' },
  ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
}));

jest.mock('@/lib/i18n', () => ({
  __esModule: true,
  default: { t: (key: string) => key, language: 'en' },
}));

type Queued = { id: string; data: Record<string, unknown> };
type Trigger = { type: string };

const mockQueue: Queued[] = [];
let mockNextNotificationId = 1;
let receivedHandler: ((notification: unknown) => void) | null = null;

jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: {
    DATE: 'date',
    DAILY: 'daily',
    WEEKLY: 'weekly',
    TIME_INTERVAL: 'timeInterval',
  },
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  deleteNotificationChannelAsync: jest.fn(async () => undefined),
  getNotificationChannelsAsync: jest.fn(async () => []),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () =>
    mockQueue.map((entry) => ({ identifier: entry.id, content: { data: entry.data } })),
  ),
  scheduleNotificationAsync: jest.fn(async ({ content }: Record<string, never>) => {
    await Promise.resolve();
    const id = `os-${mockNextNotificationId++}`;
    const c = content as unknown as { data: Record<string, unknown> };
    mockQueue.push({ id, data: c.data });
    return id;
  }),
  cancelScheduledNotificationAsync: jest.fn(async (id: string) => {
    await Promise.resolve();
    const index = mockQueue.findIndex((entry) => entry.id === id);
    if (index >= 0) mockQueue.splice(index, 1);
  }),
  addNotificationReceivedListener: jest.fn((handler: (n: unknown) => void) => {
    receivedHandler = handler;
    return {
      remove: () => {
        receivedHandler = null;
      },
    };
  }),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: () => undefined })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
}));

/* eslint-disable import/first */
import { habitReminderKey } from '@/features/notifications/services/notification-keys';
import { seedSlots } from '@/features/notifications/services/scheduling-budget';
import { useNotificationsStore } from '@/features/notifications/store/notifications-store';
import {
  addNotificationReceivedListener,
  cancelScheduledByKey,
  invalidateScheduledQueueCache,
  scheduleDailyNotification,
  type ReceivedNotification,
} from '@/lib/notifications';

const defaults = useNotificationsStore.getState();

/** Delivers a notification through the real listener wrapper, so the `remote`
 *  flag is derived exactly as it is in the app rather than asserted directly. */
function deliver(trigger: Trigger | null, data: Record<string, unknown>) {
  receivedHandler?.({
    request: {
      identifier: 'delivered-1',
      content: { title: 'T', body: 'B', data },
      trigger,
    },
  });
}

beforeEach(() => {
  mockDb = drizzle(open() as never, { schema });
  mockQueue.length = 0;
  mockNextNotificationId = 1;
  receivedHandler = null;
  seedSlots(0);
  invalidateScheduledQueueCache();
  useNotificationsStore.setState({
    masterEnabled: true,
    categories: defaults.categories,
    deliveryMode: 'individual',
    quietHoursEnabled: false,
    soundId: defaults.soundId,
  });
});

/** A daily habit reminder — repeating, so it stays queued after it fires. */
async function scheduleHabitReminder(habitId: string) {
  return scheduleDailyNotification({
    title: 'Habit',
    body: 'do the thing',
    hour: 9,
    minute: 0,
    data: {
      category: 'habits',
      route: '/habits',
      key: habitReminderKey(habitId, 'daily'),
    },
  });
}

describe('what the listener reports', () => {
  it('marks a server push as remote', () => {
    const seen: ReceivedNotification[] = [];
    const stop = addNotificationReceivedListener((n) => seen.push(n));

    deliver({ type: 'push' }, { category: 'split', key: 'split:group-1' });

    expect(seen[0].remote).toBe(true);
    stop();
  });

  it('marks this device’s own reminders as not remote', () => {
    const seen: ReceivedNotification[] = [];
    const stop = addNotificationReceivedListener((n) => seen.push(n));

    for (const trigger of [{ type: 'daily' }, { type: 'weekly' }, { type: 'date' }, null]) {
      deliver(trigger, { category: 'habits' });
    }

    expect(seen.map((n) => n.remote)).toEqual([false, false, false, false]);
    stop();
  });
});

describe('a keyed push supersedes the local reminder', () => {
  it('cancels the queued local notification sharing its key', async () => {
    await scheduleHabitReminder('habit-1');
    expect(mockQueue).toHaveLength(1);

    // The server has something to say about the same reminder — something the
    // local one could not have known when it was scheduled.
    await cancelScheduledByKey(habitReminderKey('habit-1', 'daily'));

    expect(mockQueue).toHaveLength(0);
  });

  it('leaves reminders under other keys alone', async () => {
    await scheduleHabitReminder('habit-1');
    await scheduleHabitReminder('habit-2');

    await cancelScheduledByKey(habitReminderKey('habit-1', 'daily'));

    expect(mockQueue.map((e) => e.data.key)).toEqual([habitReminderKey('habit-2', 'daily')]);
  });
});

describe('the guard that protects repeating reminders', () => {
  it('does not cancel a daily reminder when that reminder itself fires', async () => {
    // The bug this guard exists for. A repeating local notification is STILL
    // QUEUED when it fires, and it arrives at the same listener carrying the
    // same key. Acting on that would delete somebody's habit reminder the first
    // morning it went off, silently and permanently.
    await scheduleHabitReminder('habit-1');
    const key = habitReminderKey('habit-1', 'daily');

    let cancelled = false;
    const stop = addNotificationReceivedListener((received) => {
      if (received.remote && received.payload.key) {
        cancelled = true;
        void cancelScheduledByKey(received.payload.key);
      }
    });

    deliver({ type: 'daily' }, { category: 'habits', key });
    await Promise.resolve();

    expect(cancelled).toBe(false);
    expect(mockQueue.map((e) => e.data.key)).toEqual([key]);
    stop();
  });

  it('does act when the same key arrives from the server', async () => {
    await scheduleHabitReminder('habit-1');
    const key = habitReminderKey('habit-1', 'daily');

    const stop = addNotificationReceivedListener((received) => {
      if (received.remote && received.payload.key) {
        void cancelScheduledByKey(received.payload.key);
      }
    });

    deliver({ type: 'push' }, { category: 'habits', key });
    // Two ticks: the listener is sync, the cancel it starts is not.
    await Promise.resolve();
    await Promise.resolve();

    expect(mockQueue).toHaveLength(0);
    stop();
  });

  it('ignores a push carrying no key at all', async () => {
    await scheduleHabitReminder('habit-1');

    const stop = addNotificationReceivedListener((received) => {
      if (received.remote && received.payload.key) {
        void cancelScheduledByKey(received.payload.key);
      }
    });

    // Every push sent today is of this shape — no key, so nothing is superseded
    // and the local queue is untouched.
    deliver({ type: 'push' }, { category: 'split', route: '/split/group-1' });
    await Promise.resolve();

    expect(mockQueue).toHaveLength(1);
    stop();
  });
});
