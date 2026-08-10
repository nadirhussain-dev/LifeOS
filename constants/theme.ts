/**
 * Raw color values for the places a NativeWind className can't reach — native
 * components (StatusBar, RefreshControl), navigation theme objects, SVG charts,
 * Reanimated worklets, gradient stops. Everywhere else, prefer the Tailwind
 * tokens (bg-background, text-foreground, …).
 *
 * These are now DERIVED from constants/design-tokens.ts rather than being a
 * second, hand-maintained copy of the palette. They had drifted: this file said
 * the light background was #ffffff and the dark one #121212, while
 * design-tokens (and global.css, which the classNames actually resolve from)
 * said #f8fbf9 and #0e1210. 137 files import this one and 65 import the other,
 * so most screens were drawing native chrome from one palette and Tailwind
 * chrome from the other — a mismatch that shows up as a faint seam wherever a
 * hand-colored icon or sheet backdrop sits on a class-colored surface.
 *
 * Keeping the old key names means nothing had to be rewritten to fix it. New
 * code should import from design-tokens directly; this shape is the bridge, not
 * a second system.
 */

import { colors as tokens, contentPalette } from '@/constants/design-tokens';

export const colors = {
  light: {
    background: tokens.light.background,
    foreground: tokens.light.foreground,
    card: tokens.light.card,
    primary: tokens.light.primary,
    primaryForeground: tokens.light.primaryForeground,
    /** The sunken/grouped surface — `surface` in the design tokens. */
    muted: tokens.light.surface,
    mutedForeground: tokens.light.mutedForeground,
    border: tokens.light.border,
    destructive: tokens.light.error,
    success: tokens.light.success,
    successForeground: tokens.light.successForeground,
    // `warning` and `info` were missing from this bridge entirely, so the two
    // semantics with no key here were the two that screens kept re-typing as
    // raw hex (#f59e0b, #0ea5e9). A token nobody can reach is a token nobody
    // uses.
    warning: tokens.light.warning,
    warningForeground: tokens.light.warningForeground,
    info: tokens.light.info,
    infoForeground: tokens.light.infoForeground,
    accent: tokens.light.accent,
    accentForeground: tokens.light.accentForeground,
  },
  dark: {
    background: tokens.dark.background,
    foreground: tokens.dark.foreground,
    card: tokens.dark.card,
    primary: tokens.dark.primary,
    primaryForeground: tokens.dark.primaryForeground,
    muted: tokens.dark.surface,
    mutedForeground: tokens.dark.mutedForeground,
    border: tokens.dark.border,
    destructive: tokens.dark.error,
    success: tokens.dark.success,
    successForeground: tokens.dark.successForeground,
    warning: tokens.dark.warning,
    warningForeground: tokens.dark.warningForeground,
    info: tokens.dark.info,
    infoForeground: tokens.dark.infoForeground,
    accent: tokens.dark.accent,
    accentForeground: tokens.dark.accentForeground,
  },
} as const;

export type ThemeName = keyof typeof colors;

/**
 * Small curated palette for user-created content color-coding (task
 * categories, note folders, calendar colors) — a deliberate, scoped exception
 * to the app's own grayscale chrome, not a general accent palette.
 *
 * These are SWATCHES: chosen to be told apart as fills at swatch size. Several
 * are far too light to read as text on a white card (yellow is 1.92:1), so any
 * screen rendering a category name in its color must pass it through
 * `readableTint()` from design-tokens first.
 */
export const categoryColorPalette = contentPalette.map((pair) => pair.light);

/** The same six, per theme — prefer this in new code. */
export const categoryColorPairs = contentPalette;

/**
 * Task priority as a traffic-light ladder (calm blue → amber caution → red
 * urgent) rather than a single accent — priority is its own semantic system,
 * deliberately distinct from the brand accent so "urgent" always reads as
 * urgent regardless of theme. High reuses the app's existing destructive
 * red so "urgent" and "destructive" share one consistent red language.
 *
 * As with the palette above: fills as-is, text via `readableTint()`.
 */
export const priorityColors = {
  low: '#0ea5e9',
  medium: '#f59e0b',
  high: '#dc2828',
} as const;

/**
 * "Done today" for habits, deliberately not the brand accent — the accent is
 * already the app's generic CTA color (buttons, FAB, pin), so reusing it here
 * would make a completed habit read as "tap me" instead of "already done."
 */
export const habitDoneColor = '#22c55e';

/**
 * The streak flame. Amber reads as warmth and momentum, but at 2.06:1 on the
 * light ground it was the least legible text in the app — so the fill keeps the
 * amber and the label gets a darkened form of it.
 */
export const streakColor = { light: '#b45309', dark: '#fbbf24' } as const;
