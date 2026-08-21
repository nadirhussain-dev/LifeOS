import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';

import { bootstrapDatabase, type BootstrapTarget } from '@/database/bootstrap';
import * as schema from '@/database/schema';

/**
 * One reminder, however many times it is asked for.
 *
 * The streak reminder shipped holding its OS notification ids in module-level
 * variables, and every one of the ways that can go wrong went wrong at once —
 * the reported symptom was four identical "Do not lose today" alerts arriving
 * together at 20:00, with four matching inbox rows.
 *
 * The three failure modes, all asserted below:
 *
 *  1. **Concurrency.** The sync is a cancel-then-schedule with several `await`
 *     points, called fire-and-forget from a store subscription. Overlapping
 *     callers all read the same id, all found nothing to cancel, and all
 *     scheduled — leaving orphans nothing held a reference to.
 *  2. **Process restart.** Module-level state is empty on a cold start, so the
 *     first sync of every launch queued a second copy beside the survivor of
 *     the last one.
 *  3. **Orphans already on the device.** A fix that only prevents *new*
 *     duplicates leaves every phone that has already accumulated them still
 *     ringing four times.
 *
 * These are properties of the scheduling layer rather than of the challenge, so
 * they are tested through the public sync functions and against the queue the
 * OS would actually hold — not against the ids the module happens to remember.
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
let mockNextNotificationId = 1;

/**
 * `scheduleNotificationAsync` yields before it appends.
 *
 * Deliberate, and the whole point of the concurrency case: a mock that resolved
 * synchronously would let each caller observe the previous one's write and the
 * duplicate would never reproduce, so the test would pass against the code it
 * is supposed to catch. A real native call yields; this one does too.
 */
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
  getPermissionsAsync: jest.fn(async () => ({
    granted: true,
    canAskAgain: true,
    status: 'granted',
  })),
  requestPermissionsAsync: jest.fn(async () => ({
    granted: true,
    canAskAgain: true,
    status: 'granted',
  })),
  getAllScheduledNotificationsAsync: jest.fn(async () =>
    mockQueue.map((entry) => ({ identifier: entry.id, content: { data: entry.data } })),
  ),
  scheduleNotificationAsync: jest.fn(async ({ trigger, content }: Record<string, never>) => {
    await Promise.resolve();
    const id = `os-${mockNextNotificationId++}`;
    const t = trigger as unknown as { date?: number };
    const c = content as unknown as { data: Record<string, unknown> };
    mockQueue.push({ id, date: t.date ?? 0, data: c.data });
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

/* Imported below the mock state rather than at the top — see the same note in
 * features/notifications/services/module-reminders.test.ts. */
/* eslint-disable import/first */
import {
  cancelChallengeReminder,
  resyncChallengeReminder,
  scheduleWinBack,
  syncChallengeReminder,
} from '@/features/challenge/services/challenge-reminders';
import { currentDay, useChallengeStore } from '@/features/challenge/store/challenge-store';
import { useModuleFlagsStore } from '@/features/module-flags/store/module-flags-store';
import {
  CHALLENGE_AT_RISK_KEY,
  CHALLENGE_LAST_CALL_KEY,
  CHALLENGE_WIN_BACK_KEY,
} from '@/features/notifications/services/notification-keys';
import { seedSlots } from '@/features/notifications/services/scheduling-budget';
import { useNotificationsStore } from '@/features/notifications/store/notifications-store';
import { cancelScheduledByKey, invalidateScheduledQueueCache } from '@/lib/notifications';

const notificationDefaults = useNotificationsStore.getState();
const challengeDefaults = useChallengeStore.getState();

/** Entries queued under `key`. The assertion the whole file is about. */
function queuedFor(key: string): Queued[] {
  return mockQueue.filter((entry) => entry.data.key === key);
}

/**
 * Mid-afternoon, so both the 20:00 and 22:00 windows are still open. Fixed
 * rather than `Date.now()`: run this suite at 21:00 and `fireAtHour` correctly
 * declines the last call, which would look exactly like a scheduling failure.
 */
function atAfternoon() {
  jest.useFakeTimers().setSystemTime(new Date(2026, 7, 14, 15, 0, 0));
}

/** An enrolled run with nothing done yet, holding no shield — the population
 *  both evening reminders are meant for. Takes the store so it can also seed a
 *  freshly re-required instance after `jest.resetModules()`. */
function seedEnrolledRun(store: typeof useChallengeStore, day: string) {
  store.setState({
    ...challengeDefaults,
    enrolled: true,
    hydrated: true,
    required: ['tasks', 'journal'],
    minWrites: 1,
    liveRequired: false,
    days: { [day]: { writes: {}, activeSeconds: 0, attested: [] } },
    standing: { ...challengeDefaults.standing, qualifiedDays: 84, shields: 0 },
  });
}

beforeEach(() => {
  mockDb = drizzle(open() as never, { schema });
  mockQueue.length = 0;
  mockNextNotificationId = 1;
  seedSlots(0);
  atAfternoon();
  // lib/notifications caches its view of the OS queue, and these tests reach
  // past it to seed `mockQueue` directly — which is exactly what an older build
  // leaving entries behind looks like. The app drops the cache on launch and on
  // every foreground for the same reason.
  invalidateScheduledQueueCache();

  useNotificationsStore.setState({
    masterEnabled: true,
    categories: notificationDefaults.categories,
    deliveryMode: 'individual',
    quietHoursEnabled: false,
    soundId: notificationDefaults.soundId,
  });
  useModuleFlagsStore.setState({ flags: {} });
  seedEnrolledRun(useChallengeStore, currentDay());
});

afterEach(() => {
  jest.useRealTimers();
});

describe('concurrent syncs', () => {
  it('leaves one reminder per key when four run at once', async () => {
    // The reported bug, reproduced at its source: a foreground flush applies
    // the server's response through several separate `set()` calls, each one
    // firing the subscription that calls this.
    await Promise.all([
      syncChallengeReminder(['tasks']),
      syncChallengeReminder(['tasks']),
      syncChallengeReminder(['tasks']),
      syncChallengeReminder(['tasks']),
    ]);

    expect(queuedFor(CHALLENGE_AT_RISK_KEY)).toHaveLength(1);
    expect(queuedFor(CHALLENGE_LAST_CALL_KEY)).toHaveLength(1);
  });

  it('holds to one across a burst of resyncs reading live state', async () => {
    await Promise.all(Array.from({ length: 8 }, () => resyncChallengeReminder()));

    expect(queuedFor(CHALLENGE_AT_RISK_KEY)).toHaveLength(1);
  });

  it('does not let a sync racing a cancel leave anything behind', async () => {
    // Sign-out landing on top of an in-flight write. Whichever order they
    // serialise in, "cancelled" must be the state that survives — the queue is
    // rebuilt from scratch, so a stale sync cannot resurrect a reminder.
    const sync = syncChallengeReminder(['tasks']);
    const cancel = cancelChallengeReminder();
    await Promise.all([sync, cancel]);

    expect(queuedFor(CHALLENGE_AT_RISK_KEY)).toHaveLength(0);
    expect(queuedFor(CHALLENGE_LAST_CALL_KEY)).toHaveLength(0);
  });
});

describe('across a process restart', () => {
  it('replaces yesterday’s reminder rather than joining it', async () => {
    await syncChallengeReminder(['tasks']);
    const [first] = queuedFor(CHALLENGE_AT_RISK_KEY);
    expect(first).toBeDefined();

    // What a cold start looks like from this module's side: the OS queue
    // survives, every module-level variable does not. Re-requiring resets the
    // latter; the module is deliberately not asked what it remembers.
    //
    // `require` rather than `import()`, which needs --experimental-vm-modules
    // that this suite does not run with. The mock factories close over the
    // queue declared in this file, so a reset registry rebuilds the module
    // against the same queue — which is the point.
    jest.resetModules();
    /* eslint-disable @typescript-eslint/no-require-imports */
    const reloaded = require('@/features/challenge/services/challenge-reminders') as {
      syncChallengeReminder: (outstanding: string[]) => Promise<void>;
    };
    // The reset rebuilds the whole dependency graph, so the reloaded module is
    // reading a *fresh* challenge store — which is itself faithful to a restart,
    // and means the enrolment has to be seeded again on the new instance rather
    // than on the one this file captured before the reset.
    const reloadedStore = require('@/features/challenge/store/challenge-store') as {
      useChallengeStore: typeof useChallengeStore;
      currentDay: typeof currentDay;
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
    seedEnrolledRun(reloadedStore.useChallengeStore, reloadedStore.currentDay());

    await reloaded.syncChallengeReminder(['tasks']);

    const queued = queuedFor(CHALLENGE_AT_RISK_KEY);
    expect(queued).toHaveLength(1);
    // And it is genuinely the new one — the old entry was cancelled, not left
    // in place while a second was skipped.
    expect(queued[0].id).not.toBe(first.id);
  });
});

describe('orphans already on the device', () => {
  it('reaps duplicates left by an older build', async () => {
    // Four entries under one key, as a phone updating from the broken build
    // would be carrying. Nothing in the app holds their ids.
    for (let i = 0; i < 4; i++) {
      mockQueue.push({
        id: `stale-${i}`,
        date: Date.now() + 5 * 60 * 60 * 1000,
        data: { category: 'streak', route: '/challenge', key: CHALLENGE_AT_RISK_KEY },
      });
    }

    await syncChallengeReminder(['tasks']);

    const queued = queuedFor(CHALLENGE_AT_RISK_KEY);
    expect(queued).toHaveLength(1);
    expect(queued[0].id.startsWith('stale-')).toBe(false);
  });

  it('cancels by key without touching a sibling key', async () => {
    await syncChallengeReminder(['tasks']);
    await scheduleWinBack(84, 100);
    expect(queuedFor(CHALLENGE_WIN_BACK_KEY)).toHaveLength(1);

    // The at-risk rebuild must not take the win-back with it: all three share
    // the 'streak' category, so a cancel-by-category would, and that is exactly
    // the granularity a key buys over `cancelScheduledInCategory`.
    await syncChallengeReminder(['tasks', 'journal']);

    expect(queuedFor(CHALLENGE_AT_RISK_KEY)).toHaveLength(1);
    expect(queuedFor(CHALLENGE_WIN_BACK_KEY)).toHaveLength(1);
  });

  it('reports how many it cancelled', async () => {
    await syncChallengeReminder(['tasks']);
    await expect(cancelScheduledByKey(CHALLENGE_AT_RISK_KEY)).resolves.toBe(1);
    await expect(cancelScheduledByKey(CHALLENGE_AT_RISK_KEY)).resolves.toBe(0);
  });
});

describe('what must not be scheduled', () => {
  it('queues nothing once the day is complete, and drops a pending win-back', async () => {
    await scheduleWinBack(84, 100);
    await syncChallengeReminder([]);

    expect(queuedFor(CHALLENGE_AT_RISK_KEY)).toHaveLength(0);
    expect(queuedFor(CHALLENGE_LAST_CALL_KEY)).toHaveLength(0);
    expect(queuedFor(CHALLENGE_WIN_BACK_KEY)).toHaveLength(0);
  });

  it('stays silent for a run that is not enrolled', async () => {
    useChallengeStore.setState({ enrolled: false });
    await syncChallengeReminder(['tasks']);

    expect(queuedFor(CHALLENGE_AT_RISK_KEY)).toHaveLength(0);
  });

  it('stays silent when the operator has switched the programme off', async () => {
    // The launch rebuild reaches this module now, so the kill switch has to
    // hold here and not only in the tracking hook that used to be its only
    // caller — otherwise a resync revives reminders for a disabled feature.
    useModuleFlagsStore.setState({ flags: { rewards: { enabled: false } } as never });
    await resyncChallengeReminder();

    expect(queuedFor(CHALLENGE_AT_RISK_KEY)).toHaveLength(0);
  });

  it('skips the 22:00 last call for a run holding a shield', async () => {
    useChallengeStore.setState({
      standing: { ...challengeDefaults.standing, qualifiedDays: 84, shields: 1 },
    });
    await syncChallengeReminder(['tasks']);

    expect(queuedFor(CHALLENGE_AT_RISK_KEY)).toHaveLength(1);
    expect(queuedFor(CHALLENGE_LAST_CALL_KEY)).toHaveLength(0);
  });
});
