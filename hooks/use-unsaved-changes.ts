import { usePreventRemove } from '@react-navigation/native';
import { useNavigation } from 'expo-router';
import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { confirm } from '@/lib/dialog-store';

/**
 * Stops a half-filled form from vanishing without being asked.
 *
 * Every create/edit screen in the app is a presented modal whose only exit was
 * an unconditional `router.back()` — from the ✕ chip, from Android's hardware
 * back, and from the iOS swipe-down. All three threw away whatever had been
 * typed, silently, with no way to get it back. On a screen like `task/new`,
 * where the title field is `autoFocus`ed and people start typing immediately,
 * a mis-swipe on the way to the date picker costs the whole entry. It is the
 * one flow in the app that can lose work.
 *
 * `usePreventRemove` is the right level to fix it at, rather than each screen
 * intercepting its own close button. It sits on the navigator, so it catches
 * *every* way a screen can leave — including the native gesture, which a
 * hand-rolled `onClose` never sees, and Android's back button, which would
 * otherwise need its own `BackHandler`. React Navigation 7 added it precisely
 * because `beforeRemove` could not stop a native-stack dismissal; this one
 * sets `preventNativeDismiss` under the hood, so the modal genuinely stays.
 *
 * ## The saved path
 *
 * A successful save also calls `router.back()`, and prevention cannot tell that
 * apart from an abandon — so saving would prompt "discard your changes?" on the
 * way out, which is worse than not asking at all.
 *
 * Hence the returned `release`: call it immediately before navigating away on
 * purpose. It flips a ref rather than state, so it takes effect within the same
 * tick as the `router.back()` that follows it — a `setState` would not have
 * re-rendered in time and the prompt would still appear. Prevention stays
 * nominally "on"; the callback just re-dispatches the action it was handed
 * instead of asking.
 *
 * @param dirty Whether the form holds work worth keeping. Pass `false` for a
 *   pristine form so an immediate close never asks a pointless question.
 * @returns `release` — mark the next navigation as intentional.
 */
export function useUnsavedChanges(dirty: boolean): () => void {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const bypass = useRef(false);

  usePreventRemove(dirty, ({ data }) => {
    if (bypass.current) {
      navigation.dispatch(data.action);
      return;
    }

    void confirm({
      title: t('common.discardTitle'),
      message: t('common.discardBody'),
      confirmLabel: t('common.discard'),
      cancelLabel: t('common.keepEditing'),
      destructive: true,
    }).then((discard) => {
      if (discard) navigation.dispatch(data.action);
    });
  });

  return useCallback(() => {
    bypass.current = true;
  }, []);
}
