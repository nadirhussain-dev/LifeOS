import { getLocales } from 'expo-localization';

let cached: string | null = null;

/** The device's primary BCP-47 locale tag (e.g. "en-US", "de-DE"), for
 * Intl-based number/currency/date formatting. Cached after first read. */
export function deviceLocale(): string {
  if (cached === null) {
    try {
      cached = getLocales()[0]?.languageTag ?? 'en-US';
    } catch {
      cached = 'en-US';
    }
  }
  return cached;
}

/**
 * The ISO 4217 currency of the device's region, when the OS knows it.
 *
 * Used to preselect the budget currency during onboarding instead of asking, or
 * worse, defaulting everybody to dollars — a currency picker with 90 entries is
 * a poor first impression for the ~95% of people whose answer the phone already
 * knows. Returns null rather than a guess when the OS declines to say, so the
 * caller can fall back explicitly.
 */
export function deviceCurrencyCode(): string | null {
  try {
    const code = getLocales()[0]?.currencyCode;
    return code && /^[A-Z]{3}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}
