import * as Updates from 'expo-updates';
import { DevSettings, I18nManager, Platform } from 'react-native';

import type { Language } from '@/features/settings/store/language-store';

/** Languages Daykeep supports that are written right-to-left. */
export const RTL_LANGUAGES: readonly Language[] = ['ur', 'ar'];

export function isRTL(language: Language): boolean {
  return RTL_LANGUAGES.includes(language);
}

/**
 * Points React Native's layout engine at the direction `language` reads in.
 *
 * Returns true when the direction actually changed, which means the app has to
 * restart before anything looks different: `I18nManager` writes a *native*
 * flag (NSUserDefaults / SharedPreferences) that the already-mounted view tree
 * never re-reads, so every `flex-row`, `paddingStart` and `insetInlineStart`
 * keeps the side it was laid out with until RN builds the tree again from
 * scratch. Translating the strings alone leaves an LTR skeleton behind — which
 * is exactly what a plain `forceRTL` call looks like in practice.
 *
 * Because the flag is persisted natively, a cold start after a flip is already
 * correct; only the in-session switch needs the reload below.
 */
export function applyLayoutDirection(language: Language): boolean {
  // On web direction comes from the document, and I18nManager is a no-op.
  if (Platform.OS === 'web') return false;

  const shouldBeRTL = isRTL(language);
  if (shouldBeRTL === I18nManager.isRTL) return false;

  // allowRTL is what lets the device's own RTL locale through on a fresh
  // install; forceRTL pins it to our choice regardless of the device locale.
  I18nManager.allowRTL(shouldBeRTL);
  I18nManager.forceRTL(shouldBeRTL);
  return true;
}

/**
 * Restarts the JS runtime so a direction flip takes effect.
 *
 * `Updates.reloadAsync` throws against a dev server (the Updates module
 * refuses to run in development), so dev goes through `DevSettings` instead.
 * In a release build it recreates the React context from the embedded bundle —
 * expo-updates does that even with no update URL configured (its
 * DisabledAppController still runs the relaunch procedure), so this works
 * without EAS Update being set up.
 *
 * Resolves false if neither path worked, so the caller can fall back to asking
 * the person to reopen the app themselves.
 */
export async function reloadForDirectionChange(): Promise<boolean> {
  if (__DEV__) {
    DevSettings.reload();
    return true;
  }
  try {
    await Updates.reloadAsync();
    return true;
  } catch {
    return false;
  }
}
