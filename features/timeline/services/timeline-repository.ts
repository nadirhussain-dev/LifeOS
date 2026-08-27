import { endOfDay } from 'date-fns/endOfDay';
import { parseISO } from 'date-fns/parseISO';
import { startOfDay } from 'date-fns/startOfDay';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';

import { getDb } from '@/database/client';
import {
  habitLogs,
  habits,
  journalEntries,
  notes,
  tasks,
  waterIntakeLogs,
} from '@/database/schema';
import { listCalendarEventsBetween } from '@/features/timeline/services/calendar-events-repository';
import i18n from '@/lib/i18n';
import { LOCAL_USER_ID } from '@/lib/local-user';
import type { TimelineEvent } from '@/features/timeline/types/timeline.types';

/**
 * Aggregates one day's Life Timeline. Timeline owns no data of its own
 * (besides standalone calendar_events) — it queries each module's existing
 * timestamp columns directly and merges by time, so it can never drift out
 * of sync with the real data and every future module only needs one small
 * adapter block here, not a new table.
 */
export function listTimelineForDate(dateKey: string): TimelineEvent[] {
  const dayStart = startOfDay(parseISO(dateKey)).getTime();
  const dayEnd = endOfDay(parseISO(dateKey)).getTime();
  const db = getDb();
  const events: TimelineEvent[] = [];

  const completedTasks = db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, LOCAL_USER_ID),
        isNull(tasks.deletedAt),
        gte(tasks.completedAt, dayStart),
        lte(tasks.completedAt, dayEnd),
      ),
    )
    .all();
  for (const task of completedTasks) {
    events.push({
      id: `task-completed-${task.id}`,
      sourceId: task.id,
      type: 'task_completed',
      time: task.completedAt!,
      title: task.title,
      emoji: '✅',
      linkHref: `/task/${task.id}`,
    });
  }

  const dueTasks = db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, LOCAL_USER_ID),
        isNull(tasks.deletedAt),
        eq(tasks.hasDueTime, true),
        gte(tasks.dueDate, dayStart),
        lte(tasks.dueDate, dayEnd),
      ),
    )
    .all();
  for (const task of dueTasks) {
    if (task.status === 'completed') continue; // already represented above
    events.push({
      id: `task-scheduled-${task.id}`,
      sourceId: task.id,
      type: 'task_scheduled',
      time: task.dueDate!,
      title: task.title,
      emoji: '🗓️',
      linkHref: `/task/${task.id}`,
    });
  }

  const logs = db
    .select()
    .from(habitLogs)
    .where(and(eq(habitLogs.userId, LOCAL_USER_ID), eq(habitLogs.logDate, dateKey)))
    .all();
  for (const log of logs) {
    const habit = db.select().from(habits).where(eq(habits.id, log.habitId)).get();
    events.push({
      id: `habit-${log.id}`,
      sourceId: log.habitId,
      type: 'habit_completed',
      time: log.loggedAt,
      title: habit
        ? i18n.t('timeline.habitNamedCompleted', { name: habit.name })
        : i18n.t('timeline.habitCompleted'),
      emoji: habit?.emoji ?? '💪',
      linkHref: `/habit/${log.habitId}`,
    });
  }

  const createdNotes = db
    .select()
    .from(notes)
    .where(
      and(
        eq(notes.userId, LOCAL_USER_ID),
        isNull(notes.deletedAt),
        gte(notes.createdAt, dayStart),
        lte(notes.createdAt, dayEnd),
      ),
    )
    .all();
  for (const note of createdNotes) {
    events.push({
      id: `note-${note.id}`,
      sourceId: note.id,
      type: 'note_created',
      time: note.createdAt,
      title: note.title || i18n.t('notes.untitled'),
      emoji: '📝',
      linkHref: `/note/${note.id}`,
    });
  }

  const entry = db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.userId, LOCAL_USER_ID),
        eq(journalEntries.entryDate, dateKey),
        isNull(journalEntries.deletedAt),
      ),
    )
    .get();
  if (entry && entry.body.trim()) {
    events.push({
      id: `journal-${entry.id}`,
      sourceId: entry.id,
      type: 'journal_written',
      time: entry.updatedAt,
      title: i18n.t('timeline.journalWritten'),
      emoji: '📖',
      linkHref: `/journal/${dateKey}`,
    });
  }

  const waterLogs = db
    .select()
    .from(waterIntakeLogs)
    .where(and(eq(waterIntakeLogs.userId, LOCAL_USER_ID), eq(waterIntakeLogs.logDate, dateKey)))
    .all();
  for (const log of waterLogs) {
    events.push({
      id: `water-${log.id}`,
      sourceId: log.id,
      type: 'water_logged',
      time: log.loggedAt,
      title: i18n.t('timeline.drankWater', { amount: log.amountMl }),
      emoji: '💧',
      linkHref: '/water-intake/history',
    });
  }

  for (const event of listCalendarEventsBetween(dayStart, dayEnd)) {
    events.push({
      id: `event-${event.id}`,
      sourceId: event.id,
      type: 'calendar_event',
      time: event.startAt,
      endTime: event.endAt ?? undefined,
      title: event.title,
      subtitle: event.notes ?? undefined,
      emoji: '📅',
      colorToken: event.colorToken ?? undefined,
      linkHref: `/timeline/${dateKey}`,
    });
  }

  return events.sort((a, b) => a.time - b.time);
}
