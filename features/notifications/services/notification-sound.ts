import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

import {
  notificationSound,
  type NotificationSoundId,
} from '@/features/notifications/config/notification-sounds';
import { resyncAllReminders } from '@/features/notifications/services/reminder-scheduler';
import { useNotificationsStore } from '@/features/notifications/store/notifications-store';
import { reportError } from '@/lib/error-reporting';
import { configureAndroidChannels } from '@/lib/notifications';

/**
 * Choosing a notification tone, and hearing one before you choose it.
 *
 * Both halves are less obvious than they look, and for opposite reasons.
 */

/**
 * One player, reused.
 *
 * Created lazily so that merely importing this file — which the settings screen
 * does on mount — does not spin up an audio session on a device that may be
 * playing something else. Reused rather than created per tap because a picker
 * invites rapid tapping, and a fresh native player per tap leaks one until the
 * GC gets to it.
 */
let previewPlayer: AudioPlayer | null = null;

/**
 * Plays a tone through the app's own speaker output.
 *
 * This is emphatically NOT the same path as a real notification, and cannot be:
 * the OS plays notification sounds itself, from its own copy of the file, at the
 * notification volume. What this previews is the tone, not the delivery — so it
 * is honest about pitch, length and character, and says nothing about how loud
 * the phone will actually be. That is the right trade: the alternative is
 * posting a real notification for every tap in the picker.
 *
 * Silently does nothing for tones with no asset of ours (the system sound, which
 * belongs to the OS, and silence, which has nothing to play).
 */
export function previewNotificationSound(id: NotificationSoundId): void {
  const asset = notificationSound(id).preview;
  if (asset === null) return;

  try {
    previewPlayer ??= createAudioPlayer();
    previewPlayer.replace(asset);
    // `replace` leaves the position wherever the last preview ended, so a second
    // tap on the same tone would otherwise play silence from its tail.
    void previewPlayer.seekTo(0);
    previewPlayer.play();
  } catch (error) {
    // A preview that will not play is a disappointment, not a failure — the
    // choice it belongs to must still be selectable.
    reportError(error, { scope: 'notification-sound-preview' });
  }
}

/** Frees the native player. Call when the picker is unmounted. */
export function releaseNotificationSoundPreview(): void {
  previewPlayer?.remove();
  previewPlayer = null;
}

/**
 * Switches the tone every future reminder arrives with.
 *
 * The store write is the easy part. The rest exists because of one Android rule:
 * a notification channel's sound is fixed at creation and every already-queued
 * notification carries the channel it was scheduled against. So without the two
 * steps below, picking a new tone would appear to work and change nothing
 * audible — every reminder already in the queue (which, after a launch resync,
 * is all of them) would go on playing the old one, possibly for weeks.
 *
 *  1. Build the channels for the new tone, and delete the old tone's, so the
 *     user's system-settings list shows what the app actually uses.
 *  2. Rebuild every reminder, which re-queues each one against the new channel.
 *
 * Returns once both are done so the caller can show it having finished — this
 * takes long enough to be worth a spinner on a phone with many reminders.
 */
export async function applyNotificationSound(id: NotificationSoundId): Promise<void> {
  useNotificationsStore.getState().setSoundId(id);
  await configureAndroidChannels().catch((error) =>
    reportError(error, { scope: 'notification-sound-channels' }),
  );
  await resyncAllReminders();
}
