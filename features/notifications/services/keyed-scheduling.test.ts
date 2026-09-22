import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';

import { bootstrapDatabase, type BootstrapTarget } from '@/database/bootstrap';
import * as schema from '@/database/schema';

/**
 * The keyed-scheduling contract, tested on the primitives rather than through
 * one feature.
 *
 * The feature test that drove this out was `challenge-reminder-identity.test.ts`,
 * removed with the streak programme. This proves the mechanism itself — that a
 * key makes a schedule idempotent for any caller, that keys cannot collide
 * across modules,
 * that a set can be rebuilt without cancelling its own members, and that the
 * sweep catches whatever slips past all of it.
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

const mockQueue: Queued[] = [];
let mockNextNotificationId = 1;

/** Both native calls yield, so concurrent callers really do interleave. That is
 *  the race the lock in `withKey` exists for: without the yield the test would
 *  pass against a scheduler that has no lock at all. */
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
  addNotificationReceivedListener: jest.fn(() => ({ remove: () => undefined })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: () => undefined })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
}));

/* eslint-disable import/first */
import {
  habitReminderKey,
  taskReminderKey,
  waterReminderKey,
  WATER_KEY_PREFIX,
} from '@/features/notifications/services/notification-keys';
import { seedSlots } from '@/features/notifications/services/scheduling-budget';
import { useNotificationsStore } from '@/features/notifications/store/notifications-store';
import {
  cancelScheduledByKeyPrefix,
  invalidateScheduledQueueCache,
  scheduleDailyNotification,
  scheduleOneTimeNotification,
  sweepDuplicateKeys,
} from '@/lib/notifications';

const defaults = useNotificationsStore.getState();
const HOUR = 60 * 60 * 1000;

function keysInQueue(): string[] {
  return mockQueue.map((entry) => entry.data.key as string);
}

/** A keyed one-shot two hours out — far enough to clear quiet hours and the
 *  "already passed" guard without pinning the clock. */
function scheduleTask(id: string) {
  return scheduleOneTimeNotification({
    title: `Task ${id}`,
    body: 'due',
    date: Date.now() + 2 * HOUR,
    data: { category: 'tasks', route: '/tasks', key: taskReminderKey(id) },
  });
}

beforeEach(() => {
  mockDb = drizzle(open() as never, { schema });
  mockQueue.length = 0;
  mockNextNotificationId = 1;
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

describe('a key makes a schedule idempotent', () => {
  it('replaces rather than joins, however many times it is called', async () => {
    await scheduleTask('abc');
    await scheduleTask('abc');
    await scheduleTask('abc');

    expect(keysInQueue()).toEqual([taskReminderKey('abc')]);
  });

  it('holds under concurrent callers', async () => {
    await Promise.all([scheduleTask('abc'), scheduleTask('abc'), scheduleTask('abc')]);

    expect(keysInQueue()).toEqual([taskReminderKey('abc')]);
  });

  it('keeps different rows apart', async () => {
    await Promise.all([scheduleTask('abc'), scheduleTask('def')]);

    expect(keysInQueue().sort()).toEqual([taskReminderKey('abc'), taskReminderKey('def')].sort());
  });

  it('leaves an unkeyed schedule alone', async () => {
    // The migration relies on this: a module that has not been given a key yet
    // must behave exactly as it did before, including being able to queue two.
    const unkeyed = {
      title: 'Legacy',
      body: 'body',
      date: Date.now() + 2 * HOUR,
      data: { category: 'tasks', route: '/tasks' } as const,
    };
    await scheduleOneTimeNotification(unkeyed);
    await scheduleOneTimeNotification(unkeyed);

    expect(mockQueue).toHaveLength(2);
  });
});

describe('sets, rebuilt wholesale', () => {
  const slots: [number, number][] = [
    [8, 0],
    [10, 0],
    [12, 0],
  ];

  async function scheduleWater(set: [number, number][]) {
    await cancelScheduledByKeyPrefix(WATER_KEY_PREFIX);
    for (const [hour, minute] of set) {
      await scheduleDailyNotification({
        title: 'Hydrate',
        body: 'drink',
        hour,
        minute,
        data: {
          category: 'water',
          route: '/water-intake/history',
          key: waterReminderKey(hour, minute),
        },
      });
    }
  }

  it('does not cancel its own siblings', async () => {
    await scheduleWater(slots);
    expect(keysInQueue()).toHaveLength(3);
  });

  it('reaps the members a smaller set drops', async () => {
    await scheduleWater(slots);
    // The failure this exists for: widening the interval retires slots whose
    // keys nothing will ever schedule again, so per-key replacement alone would
    // leave them firing forever.
    await scheduleWater([[8, 0]]);

    expect(keysInQueue()).toEqual([waterReminderKey(8, 0)]);
  });

  it('confines a prefix to its own module', async () => {
    await scheduleWater(slots);
    await scheduleTask('abc');

    await cancelScheduledByKeyPrefix(WATER_KEY_PREFIX);

    expect(keysInQueue()).toEqual([taskReminderKey('abc')]);
  });

  it('gives each habit its own prefix', async () => {
    // Two habits, same weekday: the keys must not collide, or rebuilding one
    // habit's reminders would silently cancel the other's.
    expect(habitReminderKey('habit-1', 3)).not.toBe(habitReminderKey('habit-2', 3));
    // And a habit's daily trigger is distinct from any of its weekly ones.
    expect(habitReminderKey('habit-1', 'daily')).not.toBe(habitReminderKey('habit-1', 1));
  });
});

describe('the sweep', () => {
  it('collapses duplicates a scheduler never revisited', async () => {
    // What a device updating from a build without keys is carrying: nothing in
    // the app holds these ids, and no scheduler will touch this key this
    // session.
    for (let i = 0; i < 4; i++) {
      mockQueue.push({
        id: `stale-${i}`,
        data: { category: 'tasks', key: taskReminderKey('abc') },
      });
    }
    mockQueue.push({ id: 'other', data: { category: 'tasks', key: taskReminderKey('def') } });
    invalidateScheduledQueueCache();

    await expect(sweepDuplicateKeys()).resolves.toBe(3);
    expect(keysInQueue().sort()).toEqual([taskReminderKey('abc'), taskReminderKey('def')].sort());
  });

  it('leaves unkeyed notifications where they are', async () => {
    // Two untagged entries are not duplicates of each other — the sweep has no
    // way to tell, and guessing would delete somebody's reminder.
    mockQueue.push({ id: 'a', data: { category: 'tasks' } });
    mockQueue.push({ id: 'b', data: { category: 'tasks' } });
    invalidateScheduledQueueCache();

    await expect(sweepDuplicateKeys()).resolves.toBe(0);
    expect(mockQueue).toHaveLength(2);
  });

  it('finds nothing after a clean rebuild', async () => {
    await Promise.all([scheduleTask('abc'), scheduleTask('def'), scheduleTask('abc')]);

    await expect(sweepDuplicateKeys()).resolves.toBe(0);
  });
});
