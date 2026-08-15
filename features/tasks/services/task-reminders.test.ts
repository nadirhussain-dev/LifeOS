import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';

import { bootstrapDatabase, type BootstrapTarget } from '@/database/bootstrap';
import * as schema from '@/database/schema';

/**
 * The reported bug, reproduced end to end.
 *
 * "A new todo's reminder fires. Then the due time passes, I push the time
 * forward, and nothing ever fires again." Everything between the edit and the
 * OS queue is here — the repository write, `syncTaskReminder`, the scheduling
 * primitive's gates, the inbox log — against real SQLite and a fake
 * expo-notifications, because the failure is in how those parts compose rather
 * than in any one of them.
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

jest.mock('@/database/client', () => ({
  getDb: () => mockDb,
}));

/** Keeps `notificationsAvailable` true — the real value reads the Expo Go
 *  execution environment, which no test runs in. */
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'bare' },
  ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
}));

jest.mock('@/lib/i18n', () => ({
  __esModule: true,
  default: { t: (key: string) => key, language: 'en' },
}));

type Queued = { id: string; date: number; data: Record<string, unknown> };

const mockQueue: Queued[] = [];
let mockPermission = { granted: true, canAskAgain: true, status: 'granted' };
let mockNextNotificationId = 1;

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
  getPermissionsAsync: jest.fn(async () => mockPermission),
  requestPermissionsAsync: jest.fn(async () => mockPermission),
  getAllScheduledNotificationsAsync: jest.fn(async () =>
    mockQueue.map((entry) => ({ identifier: entry.id, content: { data: entry.data } })),
  ),
  scheduleNotificationAsync: jest.fn(
    async ({
      content,
      trigger,
    }: {
      content: { data: Record<string, unknown> };
      trigger: { date: number };
    }) => {
      const id = `os-${mockNextNotificationId++}`;
      mockQueue.push({ id, date: trigger.date, data: content.data });
      return id;
    },
  ),
  cancelScheduledNotificationAsync: jest.fn(async (id: string) => {
    const index = mockQueue.findIndex((entry) => entry.id === id);
    if (index >= 0) mockQueue.splice(index, 1);
  }),
  addNotificationReceivedListener: jest.fn(() => ({ remove: () => undefined })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: () => undefined })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
}));

/* Imported below the mock state, not at the top of the file.
 *
 * Babel hoists `jest.mock(...)` above the imports, but not the `const mockQueue`
 * the factory closes over — so with these at the top, the first module to be
 * required would build the mock while that binding is still in its temporal dead
 * zone. The lint rule does not know that, hence the exemption below. */
/* eslint-disable import/first */
import { seedSlots } from '@/features/notifications/services/scheduling-budget';
import {
  listNotificationLog,
  recordNotificationDelivery,
} from '@/features/notifications/services/notification-log-repository';
import { syncTaskReminder } from '@/features/tasks/services/task-reminders';
import {
  completeTask,
  createTask,
  getTask,
  updateTask,
} from '@/features/tasks/services/tasks-repository';
import type { Task } from '@/features/tasks/types/task.types';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * The notification firing: the OS drops it from the pending queue, and the
 * app's arrival listener writes down that it landed — exactly what
 * `useNotificationCenter` does on a device.
 */
function fire(notificationId: string | null) {
  const index = mockQueue.findIndex((entry) => entry.id === notificationId);
  if (index < 0) return;
  const [entry] = mockQueue.splice(index, 1);
  recordNotificationDelivery({
    logId: entry.data.logId as string | undefined,
    notificationId: entry.id,
    category: 'tasks',
    title: 'Pay the electricity bill',
    body: 'tasks.reminderDueNow',
  });
}

function newTaskDueIn(ms: number): Task {
  return createTask({
    title: 'Pay the electricity bill',
    dueDate: Date.now() + ms,
    hasDueTime: true,
    reminderEnabled: true,
  });
}

beforeEach(() => {
  mockDb = drizzle(open() as never, { schema });
  mockQueue.length = 0;
  mockNextNotificationId = 1;
  mockPermission = { granted: true, canAskAgain: true, status: 'granted' };
  seedSlots(0);
});

describe('task reminder lifecycle', () => {
  it('schedules a reminder for a new task with a future due time', async () => {
    const task = newTaskDueIn(2 * HOUR);
    await syncTaskReminder(task);

    expect(mockQueue).toHaveLength(1);
    expect(getTask(task.id)?.reminderNotificationId).toBe(mockQueue[0].id);
  });

  it('reschedules when the due time is pushed forward BEFORE it fires', async () => {
    const task = newTaskDueIn(2 * HOUR);
    await syncTaskReminder(task);
    const firstId = getTask(task.id)!.reminderNotificationId;

    const later = Date.now() + 5 * HOUR;
    updateTask(task.id, { dueDate: later, hasDueTime: true });
    await syncTaskReminder(getTask(task.id)!);

    expect(mockQueue).toHaveLength(1);
    expect(mockQueue[0].id).not.toBe(firstId);
    expect(mockQueue[0].date).toBe(later);
  });

  it('reschedules when the due time is pushed forward AFTER it has fired', async () => {
    // The reported failure. The reminder fired, the task is overdue and still
    // open, and the user moves the due time to later today.
    const task = newTaskDueIn(MINUTE);
    await syncTaskReminder(task);
    const firedId = getTask(task.id)!.reminderNotificationId;
    fire(firedId);
    expect(mockQueue).toHaveLength(0);

    const later = Date.now() + 3 * HOUR;
    updateTask(task.id, { dueDate: later, hasDueTime: true });
    await syncTaskReminder(getTask(task.id)!);

    expect(mockQueue).toHaveLength(1);
    expect(mockQueue[0].date).toBe(later);
    expect(getTask(task.id)?.reminderNotificationId).toBe(mockQueue[0].id);
  });

  it('keeps the delivered reminder in the inbox after the task is edited', async () => {
    // The bug: re-syncing an item cancels its old notification id, and the
    // cancel erased the log row — including one that had already arrived. So a
    // reminder showed up on the lock screen and then could not be found in the
    // app at all, and the bell badge dropped back to zero with it.
    const task = newTaskDueIn(MINUTE);
    await syncTaskReminder(task);
    fire(getTask(task.id)!.reminderNotificationId);

    const delivered = listNotificationLog().filter((row) => row.deliveredAt !== null);
    expect(delivered).toHaveLength(1);

    updateTask(task.id, { dueDate: Date.now() + 3 * HOUR, hasDueTime: true });
    await syncTaskReminder(getTask(task.id)!);

    const rows = listNotificationLog();
    // The one that arrived, plus the newly scheduled one.
    expect(rows.filter((row) => row.deliveredAt !== null)).toHaveLength(1);
    expect(rows).toHaveLength(2);
  });

  it('still drops the inbox row for a reminder cancelled before it arrived', async () => {
    // The other half of the same rule: a reminder that will never fire must not
    // sit in the inbox claiming it is scheduled.
    const task = newTaskDueIn(2 * HOUR);
    await syncTaskReminder(task);
    expect(listNotificationLog()).toHaveLength(1);

    updateTask(task.id, { reminderEnabled: false });
    await syncTaskReminder(getTask(task.id)!);

    expect(listNotificationLog()).toHaveLength(0);
  });

  it('leaves nothing queued when the reminder toggle is switched off', async () => {
    const task = newTaskDueIn(2 * HOUR);
    await syncTaskReminder(task);

    updateTask(task.id, { reminderEnabled: false });
    await syncTaskReminder(getTask(task.id)!);

    expect(mockQueue).toHaveLength(0);
    expect(getTask(task.id)?.reminderNotificationId).toBeNull();
  });

  it('does not queue anything for a due time that is still in the past', async () => {
    const task = newTaskDueIn(-HOUR);
    await syncTaskReminder(task);

    expect(mockQueue).toHaveLength(0);
    expect(getTask(task.id)?.reminderNotificationId).toBeNull();
  });

  it('does not leave a duplicate behind when synced twice for the same state', async () => {
    const task = newTaskDueIn(2 * HOUR);
    await syncTaskReminder(task);
    await syncTaskReminder(getTask(task.id)!);

    expect(mockQueue).toHaveLength(1);
  });

  it('recovers a reminder that could not be scheduled when permission was denied', async () => {
    mockPermission = { granted: false, canAskAgain: true, status: 'denied' };
    const task = newTaskDueIn(2 * HOUR);
    await syncTaskReminder(task);
    expect(getTask(task.id)?.reminderNotificationId).toBeNull();

    mockPermission = { granted: true, canAskAgain: true, status: 'granted' };
    await syncTaskReminder(getTask(task.id)!);
    expect(mockQueue).toHaveLength(1);
  });
});

describe('recurring task reminders', () => {
  const recurring = () =>
    createTask({
      title: 'Water the plants',
      dueDate: Date.now() + HOUR,
      hasDueTime: true,
      reminderEnabled: true,
      recurrenceFrequency: 'daily',
    });

  it('carries the reminder onto the next occurrence', async () => {
    // The bug: `reminderEnabled` was not among the fields copied onto the
    // clone, so it fell to its `false` default. A daily task reminded exactly
    // once — the first time — and then went silent forever.
    const task = recurring();
    await syncTaskReminder(task);

    const next = completeTask(task.id);
    expect(next).not.toBeNull();
    expect(next!.reminderEnabled).toBe(true);
  });

  it('queues the next occurrence at its own due time', async () => {
    const task = recurring();
    await syncTaskReminder(task);
    const firstId = getTask(task.id)!.reminderNotificationId;

    const next = completeTask(task.id)!;
    // What the mutation does: drop the finished task's reminder, schedule the
    // clone's.
    await syncTaskReminder(getTask(task.id)!);
    await syncTaskReminder(next);

    expect(mockQueue).toHaveLength(1);
    expect(mockQueue[0].id).not.toBe(firstId);
    expect(mockQueue[0].date).toBe(next.dueDate);
    expect(getTask(next.id)?.reminderNotificationId).toBe(mockQueue[0].id);
  });

  it('does not clone a reminder the user had switched off', async () => {
    const task = createTask({
      title: 'Water the plants',
      dueDate: Date.now() + HOUR,
      hasDueTime: true,
      reminderEnabled: false,
      recurrenceFrequency: 'daily',
    });

    expect(completeTask(task.id)!.reminderEnabled).toBe(false);
  });

  it('creates nothing to schedule for a one-off task', async () => {
    const task = newTaskDueIn(HOUR);
    expect(completeTask(task.id)).toBeNull();
  });
});

describe('completed and archived tasks', () => {
  it('drops the reminder when the task is completed', async () => {
    const task = newTaskDueIn(2 * HOUR);
    await syncTaskReminder(task);

    updateTask(task.id, { status: 'completed' });
    await syncTaskReminder(getTask(task.id)!);

    expect(mockQueue).toHaveLength(0);
  });

  it('brings the reminder back when a completed task is reopened', async () => {
    const task = newTaskDueIn(2 * HOUR);
    await syncTaskReminder(task);
    updateTask(task.id, { status: 'completed' });
    await syncTaskReminder(getTask(task.id)!);

    updateTask(task.id, { status: 'todo' });
    await syncTaskReminder(getTask(task.id)!);

    expect(mockQueue).toHaveLength(1);
  });

  it('drops the reminder when the task is archived', async () => {
    const task = newTaskDueIn(2 * HOUR);
    await syncTaskReminder(task);

    updateTask(task.id, { status: 'archived' });
    await syncTaskReminder(getTask(task.id)!);

    expect(mockQueue).toHaveLength(0);
    expect(getTask(task.id)?.reminderNotificationId).toBeNull();
  });
});

describe('all-day tasks', () => {
  it('reminds at 9am on the due date rather than at midnight', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const task = createTask({
      title: 'Renew the passport',
      dueDate: tomorrow.getTime(),
      hasDueTime: false,
      reminderEnabled: true,
    });
    await syncTaskReminder(task);

    expect(mockQueue).toHaveLength(1);
    expect(new Date(mockQueue[0].date).getHours()).toBe(9);
  });

  it('says nothing today when 9am on the due date has already gone', async () => {
    const earlier = new Date();
    earlier.setHours(0, 0, 0, 0);

    const task = createTask({
      title: 'Renew the passport',
      dueDate: earlier.getTime(),
      hasDueTime: false,
      reminderEnabled: true,
    });
    await syncTaskReminder(task);

    // Only meaningful after 09:00 local; before then the reminder is still due.
    if (Date.now() > new Date(earlier).setHours(9, 0, 0, 0)) {
      expect(mockQueue).toHaveLength(0);
    } else {
      expect(mockQueue).toHaveLength(1);
    }
  });
});
