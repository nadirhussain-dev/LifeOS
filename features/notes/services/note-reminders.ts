import { setNoteReminderNotificationId } from '@/features/notes/services/notes-repository';
import i18n from '@/lib/i18n';
import { cancelNotification, scheduleOneTimeNotification } from '@/lib/notifications';
import type { Note } from '@/features/notes/types/note.types';

/** Cancels any previously-scheduled reminder and, if the note still wants
 * one, schedules a fresh one-time notification for it — called after every
 * create/update so the schedule can never drift from what's saved. */
export async function syncNoteReminder(note: Note): Promise<void> {
  await cancelNotification(note.reminderNotificationId);

  // An archived note is out of the way by definition — reminding about it is
  // the app arguing with a decision the user already made. Same rule the task
  // reminder applies to an archived task.
  if (!note.reminderAt || note.isArchived) {
    setNoteReminderNotificationId(note.id, null);
    return;
  }

  const id = await scheduleOneTimeNotification({
    title: note.title || i18n.t('notes.reminderTitle'),
    body: i18n.t('notes.reminderBody'),
    date: note.reminderAt,
    data: { category: 'notes', route: '/note/[id]', params: { id: note.id } },
  });
  setNoteReminderNotificationId(note.id, id);
}

export async function cancelNoteReminder(
  note: Pick<Note, 'id' | 'reminderNotificationId'>,
): Promise<void> {
  await cancelNotification(note.reminderNotificationId);
  setNoteReminderNotificationId(note.id, null);
}
