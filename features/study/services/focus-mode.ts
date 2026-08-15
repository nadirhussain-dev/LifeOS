import { Linking, Platform } from 'react-native';

import { pauseForFocus } from '@/features/music/services/player-controller';
import { useFocusModeStore } from '@/features/study/store/focus-mode-store';
import { announceHeldReminders } from '@/lib/notifications';

/**
 * The shield around a study focus block: while it's up, nothing Daykeep controls
 * is allowed to interrupt.
 *
 * What it does, and where each piece lives:
 *
 *  - Music pauses (features/music/services/player-controller).
 *  - Daykeep reminders are swallowed instead of shown. The foreground handler in
 *    lib/notifications checks the focus flag and holds them; they are already
 *    rows in the in-app inbox, and everything held is re-announced as a single
 *    summary the moment the block ends, so no reminder is lost — only deferred.
 *
 * Keeping the screen awake is not here: it belongs to the timer screen being on
 * screen rather than to the focus phase, so app/study/timer.tsx holds that wake
 * lock via expo-keep-awake's `useKeepAwake` for as long as it's mounted.
 *
 * What this deliberately does NOT do: silence the phone itself. See
 * {@link canOpenSystemDoNotDisturb} — that is not something an app can do.
 */
export function enterFocusMode(): void {
  const store = useFocusModeStore.getState();
  if (store.active) return;

  store.activate();
  pauseForFocus();
}

/**
 * Drops the shield and tells the user what it caught.
 *
 * `summarize` receives the number of held reminders and returns the notification
 * text, so the copy stays in the i18n layer where the caller has `t`.
 */
export async function exitFocusMode(
  summarize?: (count: number) => { title: string; body: string },
): Promise<void> {
  const store = useFocusModeStore.getState();
  if (!store.active) return;

  const held = store.heldTitles;
  store.deactivate();

  if (held.length > 0 && summarize) {
    const { title, body } = summarize(held.length);
    await announceHeldReminders({ title, body });
  }
}

/**
 * Whether a one-tap route into the OS's Do Not Disturb settings exists.
 *
 * An app cannot turn Do Not Disturb on or off by itself. On Android that needs
 * `NotificationManager.setInterruptionFilter`, which is gated behind a
 * user-granted policy-access grant and has no Expo binding — it would take a
 * custom native module, and even then the user still has to grant it by hand
 * first. On iOS there is no API at all: Focus is user-controlled by design, and
 * the closest sanctioned integration (Focus Filters) still requires the *user*
 * to switch the Focus on.
 *
 * So the honest offer is a shortcut to the right settings screen, on the one
 * platform that exposes one, and no pretence on the other.
 */
export function canOpenSystemDoNotDisturb(): boolean {
  return Platform.OS === 'android';
}

/** Opens the OS Do Not Disturb settings. Returns false if nothing could be
 * opened, so the caller can say so rather than appearing to do nothing. */
export async function openSystemDoNotDisturb(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  // ZEN_MODE_PRIORITY_SETTINGS lands directly on Do Not Disturb. It's public API
  // but OEM skins do rearrange Settings, so fall back to the sound screen (DND
  // is always reachable from there) rather than failing outright.
  const actions = [
    'android.settings.ZEN_MODE_PRIORITY_SETTINGS',
    'android.settings.SOUND_SETTINGS',
  ];
  for (const action of actions) {
    try {
      await Linking.sendIntent(action);
      return true;
    } catch {
      // Try the next one.
    }
  }
  return false;
}
