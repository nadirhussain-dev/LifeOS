import { useMemo } from 'react';

import {
  colors,
  moduleTint,
  moduleTintText,
  readableTint,
  resolveTint,
  type ModuleName,
  type ThemeName,
  type TintPair,
} from '@/constants/design-tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * The active theme, resolved once.
 *
 * `useColorScheme() ?? 'light'` followed by `colors[scheme]` appears in over
 * three hundred places, and every one of them also has to remember which of
 * `moduleTint` / `moduleTintText` / `resolveTint` / `readableTint` is the right
 * call for what it is colouring — a distinction that is easy to state (fills
 * take one, text takes the other) and easy to forget at the point of use.
 *
 * This bundles the lot behind one call, with the theme already applied:
 *
 * ```tsx
 * const { c, tint, tintText, resolve } = useTheme();
 * <Icon color={tint('habit')} />                  // a fill  — 3:1
 * <Text style={{ color: tintText('habit') }} />   // text    — 4.5:1
 * <View style={{ borderColor: c.border }} />
 * ```
 *
 * The existing `useColorScheme() + colors[scheme]` pattern still works and is
 * not deprecated — this is the shorter path for new code and for files being
 * touched anyway, not a reason to rewrite three hundred call sites.
 */
export function useTheme() {
  const scheme = useColorScheme() ?? 'light';

  return useMemo(
    () => ({
      /** 'light' | 'dark' — for the few APIs that want the name itself. */
      scheme: scheme as ThemeName,
      /** Resolved core + semantic colours. Short because it is used constantly. */
      c: colors[scheme],
      /** A module's tint as a FILL — rings, dots, chart series, icons (3:1). */
      tint: (name: ModuleName) => moduleTint(name, scheme),
      /** A module's tint as TEXT on a card (4.5:1). */
      tintText: (name: ModuleName) => moduleTintText(name, scheme),
      /** Resolve any `TintPair` — Hub modules, content swatches, the ledger. */
      resolve: (pair: TintPair) => resolveTint(pair, scheme),
      /** Make a user-chosen colour legible on the current card. Memoised. */
      readable: (hex: string, minRatio?: number) => readableTint(hex, scheme, minRatio),
    }),
    [scheme],
  );
}
