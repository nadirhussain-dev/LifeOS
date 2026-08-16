import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';

import { bootstrapDatabase, type BootstrapTarget } from '@/database/bootstrap';
import * as schema from '@/database/schema';

/**
 * The reminder rules that are the same in every module, checked across the
 * modules that have to obey them.
 *
 * Each module owns its own `sync*Reminder`, and the rules they share — cancel
 * before rescheduling, stop reminding about something the user has put away,
 * honour the master switch and the per-category switch, keep out of quiet hours
 * unless the reminder is time-critical — were only ever enforced by each file
 * remembering to. This is where "every module behaves the same" is actually
 * asserted.
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

type Queued = {
  id: string;
  date: number;
  data: Record<string, unknown>;
  channelId?: string;
  sound?: string | boolean | null;
};

const mockQueue: Queued[] = [];
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
    const id = `os-${mockNextNotificationId++}`;
    const t = trigger as unknown as {
      date?: number;
      hour?: number;
      minute?: number;
      channelId?: string;
    };
    const c = content as unknown as {
      data: Record<string, unknown>;
      sound?: string | boolean | null;
    };
    mockQueue.push({
      id,
      date: t.date ?? (t.hour ?? 0) * 60 + (t.minute ?? 0),
      data: c.data,
      channelId: t.channelId,
      sound: c.sound,
    });
    return id;
  }),
  cancelScheduledNotificationAsync: jest.fn(async (id: string) => {
    const index = mockQueue.findIndex((entry) => entry.id === id);
    if (index >= 0) mockQueue.splice(index, 1);
  }),
  addNotificationReceivedListener: jest.fn(() => ({ remove: () => undefined })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: () => undefined })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
}));

/* Imported below the mock state rather than at the top — see the same note in
 * features/tasks/services/task-reminders.test.ts. */
/* eslint-disable import/first */
import { seedSlots } from '@/features/notifications/services/scheduling-budget';
import { useNotificationsStore } from '@/features/notifications/store/notifications-store';
import { syncNoteReminder } from '@/features/notes/services/note-reminders';
import {
  archiveNote,
  createNote,
  getNote,
  listNotesWithReminders,
  unarchiveNote,
  updateNote,
} from '@/features/notes/services/notes-repository';
import { syncTaskReminder } from '@/features/tasks/services/task-reminders';
import { createTask } from '@/features/tasks/services/tasks-repository';

const HOUR = 60 * 60 * 1000;

const defaults = useNotificationsStore.getState();

beforeEach(() => {
  mockDb = drizzle(open() as never, { schema });
  mockQueue.length = 0;
  mockNextNotificationId = 1;
  seedSlots(0);
  useNotificationsStore.setState({
    masterEnabled: true,
    categories: defaults.categories,
    deliveryMode: 'individual',
    quietHoursEnabled: true,
    quietStartMinutes: 22 * 60,
    quietEndMinutes: 7 * 60,
    soundId: defaults.soundId,
  });
});

function noteWithReminder(reminderAt = Date.now() + 2 * HOUR) {
  return createNote({ title: 'Read the lease', reminderAt });
}

function taskDueIn(ms: number) {
  return createTask({
    title: 'File the return',
    dueDate: Date.now() + ms,
    hasDueTime: true,
    reminderEnabled: true,
  });
}

describe('note reminders', () => {
  it('schedules a reminder for a future note reminder time', async () => {
    await syncNoteReminder(noteWithReminder());
    expect(mockQueue).toHaveLength(1);
  });

  it('stops reminding once the note is archived', async () => {
    const note = noteWithReminder();
    await syncNoteReminder(note);
    expect(mockQueue).toHaveLength(1);

    archiveNote(note.id);
    await syncNoteReminder(getNote(note.id)!);

    expect(mockQueue).toHaveLength(0);
    expect(getNote(note.id)?.reminderNotificationId).toBeNull();
  });

  it('keeps an archived note out of the launch rebuild', async () => {
    // The bug: archiving cancelled the reminder, then the next launch's rebuild
    // read this list, found the note, and scheduled it straight back. An
    // archived note nudged forever.
    const note = noteWithReminder();
    archiveNote(note.id);

    expect(listNotesWithReminders().map((n) => n.id)).not.toContain(note.id);
  });

  it('puts the reminder back when the note is un-archived', async () => {
    const note = noteWithReminder();
    archiveNote(note.id);
    await syncNoteReminder(getNote(note.id)!);

    unarchiveNote(note.id);
    await syncNoteReminder(getNote(note.id)!);

    expect(mockQueue).toHaveLength(1);
    expect(listNotesWithReminders().map((n) => n.id)).toContain(note.id);
  });

  it('replaces rather than duplicates when the reminder time moves', async () => {
    // Quiet hours off, so the assertion is about rescheduling rather than about
    // where in the day the suite happens to run.
    useNotificationsStore.setState({ quietHoursEnabled: false });
    const note = noteWithReminder();
    await syncNoteReminder(note);

    const later = Date.now() + 5 * HOUR;
    updateNote(note.id, { reminderAt: later });
    await syncNoteReminder(getNote(note.id)!);

    expect(mockQueue).toHaveLength(1);
    expect(mockQueue[0].date).toBe(later);
  });

  it('clears the reminder when the time is removed', async () => {
    const note = noteWithReminder();
    await syncNoteReminder(note);

    updateNote(note.id, { reminderAt: null });
    await syncNoteReminder(getNote(note.id)!);

    expect(mockQueue).toHaveLength(0);
  });
});

describe('the switches every module answers to', () => {
  it('schedules nothing while the master switch is off', async () => {
    useNotificationsStore.setState({ masterEnabled: false });
    await syncTaskReminder(taskDueIn(2 * HOUR));
    await syncNoteReminder(noteWithReminder());

    expect(mockQueue).toHaveLength(0);
  });

  it('schedules nothing for a category the user switched off', async () => {
    useNotificationsStore.setState({
      categories: { ...defaults.categories, notes: false },
    });
    await syncNoteReminder(noteWithReminder());
    expect(mockQueue).toHaveLength(0);

    // ...and leaves the others alone.
    await syncTaskReminder(taskDueIn(2 * HOUR));
    expect(mockQueue).toHaveLength(1);
  });

  it('folds a nudge category into the digest but still fires a due time', async () => {
    useNotificationsStore.setState({ deliveryMode: 'digest' });

    // Notes are a nudge — folded into the morning summary.
    await syncNoteReminder(noteWithReminder());
    expect(mockQueue).toHaveLength(0);

    // A task due time is time-critical — it always pings on its own.
    await syncTaskReminder(taskDueIn(2 * HOUR));
    expect(mockQueue).toHaveLength(1);
  });
});

describe('the chosen reminder tone', () => {
  it('routes a reminder to the channel that carries that tone', async () => {
    // On Android the sound belongs to the channel, so this — not `content.sound`
    // — is what actually decides which noise the phone makes.
    useNotificationsStore.setState({ soundId: 'beacon' });
    await syncTaskReminder(taskDueIn(2 * HOUR));

    expect(mockQueue[0].channelId).toContain('beacon');
    expect(mockQueue[0].sound).toBe('daykeep_beacon.wav');
  });

  it('moves the reminders of every category to the new tone together', async () => {
    useNotificationsStore.setState({ soundId: 'ripple' });
    await syncTaskReminder(taskDueIn(2 * HOUR));
    await syncNoteReminder(noteWithReminder());

    for (const entry of mockQueue) {
      expect(entry.channelId).toContain('ripple');
    }
  });

  it('keeps urgency and tone as separate parts of the channel id', async () => {
    // A task due time is time-critical; a note nudge is not. They must stay on
    // different channels so someone can turn one down without losing the other.
    useNotificationsStore.setState({ soundId: 'chime', quietHoursEnabled: false });
    await syncTaskReminder(taskDueIn(2 * HOUR));
    await syncNoteReminder(noteWithReminder());

    const [task, note] = mockQueue;
    expect(task.channelId).toContain('time-sensitive');
    expect(note.channelId).toContain('reminders');
    expect(task.channelId).not.toBe(note.channelId);
  });

  it('asks for no sound at all when the tone is Silent', async () => {
    useNotificationsStore.setState({ soundId: 'silent' });
    await syncTaskReminder(taskDueIn(2 * HOUR));

    // `false`, not null — that is expo's spelling for notification content, and
    // the notification still posts and still vibrates.
    expect(mockQueue[0].sound).toBe(false);
    expect(mockQueue[0].channelId).toContain('silent');
  });

  it('falls back to the default tone when the stored id is unknown', async () => {
    useNotificationsStore.setState({ soundId: 'from-a-future-release' as never });
    await syncTaskReminder(taskDueIn(2 * HOUR));

    expect(mockQueue[0].channelId).toContain('chime');
    expect(mockQueue[0].sound).toBe('daykeep_chime.wav');
  });
});

describe('quiet hours', () => {
  /** 02:00 tomorrow — inside the default 22:00–07:00 window. */
  function nextTwoAm(): number {
    const at = new Date();
    at.setDate(at.getDate() + 1);
    at.setHours(2, 0, 0, 0);
    return at.getTime();
  }

  it('shifts a nudge out of the quiet window instead of waking anyone', async () => {
    const at = nextTwoAm();
    await syncNoteReminder(noteWithReminder(at));

    expect(mockQueue).toHaveLength(1);
    expect(mockQueue[0].date).toBeGreaterThan(at);
    expect(new Date(mockQueue[0].date).getHours()).toBe(7);
  });

  it('lets a time-critical due time through the window untouched', async () => {
    const at = nextTwoAm();
    const task = createTask({
      title: 'Overnight deploy',
      dueDate: at,
      hasDueTime: true,
      reminderEnabled: true,
    });
    await syncTaskReminder(task);

    expect(mockQueue).toHaveLength(1);
    expect(mockQueue[0].date).toBe(at);
  });

  it('leaves everything where it is when quiet hours are off', async () => {
    useNotificationsStore.setState({ quietHoursEnabled: false });
    const at = nextTwoAm();
    await syncNoteReminder(noteWithReminder(at));

    expect(mockQueue[0].date).toBe(at);
  });
});
