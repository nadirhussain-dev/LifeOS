import {
  allowScreenCaptureAsync,
  enableAppSwitcherProtectionAsync,
  preventScreenCaptureAsync,
} from 'expo-screen-capture';
import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * Blocks screenshots, screen recording and the app-switcher preview while a
 * private screen is mounted.
 *
 * Worth being precise about what this buys. It does not stop a determined
 * attacker — nothing stops a second phone pointed at the screen. It stops the
 * *accidental* disclosures that actually happen to people: a screenshot landing
 * in the camera roll and from there in an auto-backup or a shared album, a
 * screen recording left running, and a legible thumbnail of the vault sitting
 * in the app switcher for whoever picks the phone up next.
 *
 * On Android this is `FLAG_SECURE`, which covers the switcher as a side effect.
 * On iOS the capture block needs iOS 13+, and the switcher needs its own call —
 * hence the extra line, which is a no-op elsewhere.
 *
 * Failures are swallowed on purpose: an OS that refuses the flag should cost
 * the flag, not the screen the user opened.
 */
const CAPTURE_KEY = 'daykeep-private';

export function useSecureScreen(): void {
  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        await preventScreenCaptureAsync(CAPTURE_KEY);
        if (Platform.OS === 'ios') await enableAppSwitcherProtectionAsync();
      } catch {
        // Older OS, or an unsupported build. Nothing else to do.
      }
    })();

    return () => {
      if (!active) return;
      active = false;
      // Released on unmount so the rest of the app stays screenshot-able —
      // people do screenshot their habit streaks, and should be able to.
      void allowScreenCaptureAsync(CAPTURE_KEY).catch(() => undefined);
    };
  }, []);
}

/** Component form, for screens that would rather not add a hook call. */
export function SecureScreen(): null {
  useSecureScreen();
  return null;
}
