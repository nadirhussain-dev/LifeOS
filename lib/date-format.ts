import { getLocales } from 'expo-localization';

import { useLanguageStore, type Language } from '@/features/settings/store/language-store';

/**
 * User-facing dates and times, in the language the app is actually set to.
 *
 * Every date on screen used to come from `date-fns/format` with a hardcoded
 * pattern — `'MMM d, yyyy'`, `'h:mm a'`, `'EEEE'` — and no locale, which meant
 * they rendered in English on all four of the languages this app ships. An
 * Arabic reader got Arabic UI with "Mar 14, 2026" in it, and the weekday
 * initials down the habit heatmap read "M T W T F S S".
 *
 * ## Why Intl rather than a date-fns locale
 *
 * date-fns 4.4 has `ar`, `hi` and both English variants — and **no Urdu at
 * all**. Passing it a locale would have fixed three of the four languages and
 * left the fourth exactly as broken, which is not a fix so much as a smaller
 * bug. `Intl.DateTimeFormat` has all four, needs no locale bundles on a
 * codebase that just spent a release deleting 250 unused date-fns functions,
 * and is already how money is formatted (features/budget/services/money.ts).
 *
 * It also gets something a pattern cannot. `'MMM d, yyyy'` and `'d MMM yyyy'`
 * were both in use, and both are wrong somewhere: the first is wrong in
 * British English and Urdu, the second in American English. Asking for
 * `{ day, month, year }` and letting the locale order them is the only version
 * that is right in all of them.
 *
 * ## What is deliberately NOT here
 *
 * `'yyyy-MM-dd'` and `'yyyy-MM'`. Those are storage keys — row ids, query
 * keys, the `logDate` column — and localizing one would change what a row is
 * called. They stay on `date-fns/format`, which is the honest signal that they
 * are not text for anybody to read.
 */

/** Styles named for what they say, not for the pattern they replace. */
export type DateStyle =
  /** 14/03/2026 — dense contexts only. */
  | 'numeric'
  /** 14 Mar 2026 (or Mar 14, 2026 — the locale decides). */
  | 'medium'
  /** 14 March 2026. */
  | 'long'
  /** 14 Mar — within an obvious year. */
  | 'dayMonth'
  /** 14 March. */
  | 'dayMonthLong'
  /** Mar 2026. */
  | 'monthYear'
  /** March 2026. */
  | 'monthYearLong'
  /** Sat, 14 Mar. */
  | 'weekdayDayMonth'
  /** Saturday, 14 March. */
  | 'weekdayDayMonthLong'
  /** Saturday, 14 March 2026. */
  | 'full';

const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  numeric: { day: '2-digit', month: '2-digit', year: 'numeric' },
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  dayMonth: { day: 'numeric', month: 'short' },
  dayMonthLong: { day: 'numeric', month: 'long' },
  monthYear: { month: 'short', year: 'numeric' },
  monthYearLong: { month: 'long', year: 'numeric' },
  weekdayDayMonth: { weekday: 'short', day: 'numeric', month: 'short' },
  weekdayDayMonthLong: { weekday: 'long', day: 'numeric', month: 'long' },
  full: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
};

/**
 * The BCP-47 tag to format in.
 *
 * The app's own language wins, because it is the one the user picked on a
 * screen — the device language is a default they may well have overridden.
 * English is the exception: `en` alone would impose American ordering on a
 * British phone, so the device's own English variant is kept when it has one.
 * Nothing similar is needed for the others; `ur`, `hi` and `ar` each order the
 * same way across their regions.
 */
export function dateLocaleTag(language: Language = useLanguageStore.getState().language): string {
  if (language !== 'en') return language;
  try {
    const tag = getLocales()[0]?.languageTag;
    return tag && tag.toLowerCase().startsWith('en') ? tag : 'en';
  } catch {
    return 'en';
  }
}

/**
 * Constructing an `Intl.DateTimeFormat` is the expensive part, and these are
 * called per row of a list. Cached on the tag plus the options, and cleared
 * when the language changes so a switch does not keep serving the old one.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();
let cachedFor: string | null = null;

function formatter(
  tag: string,
  key: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  if (cachedFor !== tag) {
    formatters.clear();
    cachedFor = tag;
  }
  let existing = formatters.get(key);
  if (!existing) {
    try {
      existing = new Intl.DateTimeFormat(tag, options);
    } catch {
      // A runtime without data for this tag. English is wrong for the reader
      // but readable, which beats throwing inside a list row.
      existing = new Intl.DateTimeFormat('en', options);
    }
    formatters.set(key, existing);
  }
  return existing;
}

function run(value: Date | number, key: string, options: Intl.DateTimeFormatOptions): string {
  const tag = dateLocaleTag();
  return formatter(tag, key, options).format(value);
}

/** A date, in the app's language. */
export function formatDate(value: Date | number, style: DateStyle = 'medium'): string {
  return run(value, `d:${style}`, DATE_OPTIONS[style]);
}

/** A clock time. 12- or 24-hour is the locale's business, not ours. */
export function formatTime(value: Date | number): string {
  return run(value, 'time', { hour: 'numeric', minute: '2-digit' });
}

/** A date and the time on it, as one string. */
export function formatDateTime(value: Date | number, style: DateStyle = 'medium'): string {
  return run(value, `dt:${style}`, {
    ...DATE_OPTIONS[style],
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** A weekday name. `narrow` is the single letter used down a heatmap column. */
export function formatWeekday(
  value: Date | number,
  width: 'narrow' | 'short' | 'long' = 'short',
): string {
  return run(value, `wd:${width}`, { weekday: width });
}

/** A month name on its own, for chart axes and month pickers. */
export function formatMonth(value: Date | number, width: 'short' | 'long' = 'short'): string {
  return run(value, `m:${width}`, { month: width });
}

/** The day of the month as a bare numeral, for calendar cells. */
export function formatDayOfMonth(value: Date | number): string {
  return run(value, 'day', { day: 'numeric' });
}
