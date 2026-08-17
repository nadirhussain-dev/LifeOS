import * as NavigationBar from 'expo-navigation-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Makes Android's navigation bar follow the app's theme instead of the phone's.
 *
 * `expo-status-bar` has always handled the top of the screen, so the clock and
 * signal icons flip with the app. Nothing handled the bottom, and the two are
 * not the same question: the app's theme is its own setting (System / Light /
 * Dark, in Settings → Appearance), so a phone whose system theme is Light and
 * whose Daykeep is set to Dark got a white navigation bar with black glyphs
 * pinned under a near-black app. It reads as a rendering fault rather than a
 * setting, and it is the last thing on screen that does not belong to the app.
 *
 * Two calls, because which one works depends on how the build draws its bars:
 *
 *  - `setStyle` is the edge-to-edge path — the app draws behind a transparent
 *    bar and only the glyph colour is ours to choose. It also needs the
 *    three-button bar; a gesture pill has no glyphs to recolour and needs
 *    nothing.
 *  - `setButtonStyleAsync` is the same choice for a build where edge-to-edge is
 *    off, where it is the supported call and `setStyle` is not.
 *
 * Both are attempted and both failures are swallowed, deliberately. These are
 * native calls that are unsupported in some combinations by design, and are
 * simply absent until the next native build picks the module up — and there is
 * no arrangement of system bars worth crashing an app over, still less one worth
 * crashing it at launch, which is when this runs.
 *
 * `light`/`dark` here name the *glyphs*, not the bar: a dark app wants light
 * ones. Getting that inverted is the one mistake this makes that still looks
 * deliberate, so it is spelled out rather than left to the reader.
 */
export function SystemBarsBridge() {
  const scheme = useColorScheme() ?? 'light';

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const glyphs = scheme === 'dark' ? 'light' : 'dark';

    try {
      NavigationBar.setStyle(glyphs);
    } catch {
      // Edge-to-edge off, or the module is not in this build yet.
    }
    NavigationBar.setButtonStyleAsync(glyphs).catch(() => {
      // Edge-to-edge on, where this call is the unsupported one of the pair.
    });
  }, [scheme]);

  return null;
}
