import { currencySymbol, findCurrency } from '@/features/budget/config/currencies';
import { deviceLocale } from '@/lib/locale';

/**
 * Money helpers. All amounts are integer minor units (cents) end-to-end —
 * floats never touch a balance — and only get formatted to a decimal string
 * at the display edge. The `currency` arg may be an ISO code ("USD") or a raw
 * symbol ("$"); both resolve to the right display.
 */

/** Formats minor-units as a localized currency string. When the currency is a
 * known ISO code, uses `Intl.NumberFormat` with the device locale — which gets
 * grouping, symbol placement, and (critically) the currency's own fraction
 * digits right: 0 for JPY/KRW, 2 for USD/EUR, 3 for KWD/BHD. This replaces the
 * old hand-rolled formatter that always assumed 2 decimals + a leading symbol,
 * which mis-rendered zero-decimal currencies and non-US locales. Falls back to
 * the manual path for raw-symbol storage or if Hermes lacks Intl currency. */
export function formatMoney(cents: number, currency = 'USD'): string {
  const iso = findCurrency(currency)?.code;
  if (iso) {
    try {
      return new Intl.NumberFormat(deviceLocale(), { style: 'currency', currency: iso }).format(
        Math.round(cents) / 100,
      );
    } catch {
      // Hermes build without full Intl currency support — use the manual path.
    }
  }
  return formatMoneyManual(cents, currency);
}

function formatMoneyManual(cents: number, currency: string): string {
  const symbol = currencySymbol(currency);
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const grouped = whole.toLocaleString(deviceLocale());
  const body = frac === 0 ? grouped : `${grouped}.${String(frac).padStart(2, '0')}`;
  return `${negative ? '-' : ''}${symbol}${body}`;
}

/** Thousands, millions, billions. The k step existed alone, which was fine
 * while this only labelled chart axes and stopped being fine the moment it
 * became the fallback for a slot too narrow for the full amount: a nine-figure
 * balance came out as "$10000k", longer than several of the strings it was
 * supposed to be rescuing and unreadable besides. */
/**
 * The currency marker `formatMoney` would have used.
 *
 * These two must agree, and until this existed they did not. `formatMoney` goes
 * through `Intl.NumberFormat`, which renders PKR as "PKR"; `formatMoneyCompact`
 * used the local `currencySymbol` table, which renders it as "Rs". Both are
 * correct spellings and both were on screen at once — a Budget hero reading
 * "Rs5.6m · PKR 0.00 · PKR 6,500" across three columns of one row, and an
 * account strip reading "Rs500k · PKR 50,000.00 · Rs5m". Three tiles, two
 * currencies, one wallet.
 *
 * It only became visible when the compact form stopped being a chart-axis label
 * and became the fallback a money figure falls back *to*, which put the two
 * spellings side by side for the first time.
 *
 * Derived from `Intl` rather than hardcoded, by formatting zero and stripping
 * the digits: whatever marker the full figure will carry on this device is the
 * one taken, including the trailing space ICU puts after an alphabetic code.
 * Falls back to the local table when Intl has no opinion, which is the same
 * path `formatMoney` takes.
 */
function displaySymbol(currency: string): string {
  const iso = findCurrency(currency)?.code;
  if (iso) {
    try {
      const zero = new Intl.NumberFormat(deviceLocale(), {
        style: 'currency',
        currency: iso,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(0);
      // Strip the number and keep everything else exactly as ICU wrote it —
      // including the space it puts after an alphabetic code ("PKR ") and the
      // absence of one after a glyph ("$"). Trimming here is what produced
      // "$ 1.2k": the space belongs to PKR and not to the dollar.
      const digits = /[\d\u0660-\u0669\u06F0-\u06F9.,]+/;
      const prefix = zero.replace(new RegExp(`${digits.source}.*$`), '');
      if (prefix) return prefix;
      // Suffix-position currencies ("0 €") — take what follows the number.
      const suffix = zero.replace(new RegExp(`^.*${digits.source}`), '');
      if (suffix) return suffix;
    } catch {
      // Hermes without full Intl currency data — use the manual table.
    }
  }
  return currencySymbol(currency);
}

const COMPACT_STEPS = [
  { at: 1e9, suffix: 'b' },
  { at: 1e6, suffix: 'm' },
  { at: 1e3, suffix: 'k' },
] as const;

/** Compact format for chart axes and slots too narrow for the real figure:
 * "$1.2k", "$23.5k", "$3.4m", "$950".
 *
 * One decimal below a hundred, none above. It was below *ten*, which rounded
 * `23,500` to "24k" — and this is the fallback a Budget screen reaches for
 * when an account balance will not fit, so a figure the user can read as
 * precise while being five hundred out is the wrong trade. "23.5k" costs two
 * characters and is right to three significant figures either side of the
 * separator.
 *
 * A trailing ".0" is trimmed, so 9.99m still comes out as "10m" rather than
 * "10.0m" — the rounding has to happen before the decision, not after. */
export function formatMoneyCompact(cents: number, currency = 'USD'): string {
  const symbol = displaySymbol(currency);
  const abs = Math.abs(Math.round(cents));
  const dollars = abs / 100;
  const sign = cents < 0 ? '-' : '';
  for (const step of COMPACT_STEPS) {
    if (dollars >= step.at) {
      const scaled = dollars / step.at;
      // Rounded first, then compared: 9.99 formats to "10.0", and a trailing
      // ".0" is noise rather than precision.
      const oneDecimal = Math.round(scaled * 10) / 10;
      const body =
        oneDecimal >= 100
          ? String(Math.round(scaled))
          : Number.isInteger(oneDecimal)
            ? String(oneDecimal)
            : oneDecimal.toFixed(1);
      return `${sign}${symbol}${body}${step.suffix}`;
    }
  }
  return `${sign}${symbol}${Math.round(dollars)}`;
}

/** Parses a user-typed amount ("1,250.5", "1250") into integer cents. Returns
 * 0 for empty/invalid input. Rounds to the nearest cent. */
export function parseAmountToCents(text: string): number {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const value = parseFloat(cleaned);
  if (!Number.isFinite(value)) return 0;
  // + EPSILON so exact half-cents round up (e.g. 1.005 → 101, not 100): plain
  // value*100 lands on 100.4999… in float and would truncate down.
  return Math.round((value + Number.EPSILON) * 100);
}
