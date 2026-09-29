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
const COMPACT_STEPS = [
  { at: 1e9, suffix: 'b' },
  { at: 1e6, suffix: 'm' },
  { at: 1e3, suffix: 'k' },
] as const;

/** Compact format for chart axes and slots too narrow for the real figure:
 * "$1.2k", "$3.4m", "$950". One decimal below ten, none above — "$12.3m" and
 * "$12m" carry the same information at a glance and the shorter one is the
 * point. */
export function formatMoneyCompact(cents: number, currency = 'USD'): string {
  const symbol = currencySymbol(currency);
  const abs = Math.abs(Math.round(cents));
  const dollars = abs / 100;
  const sign = cents < 0 ? '-' : '';
  for (const step of COMPACT_STEPS) {
    if (dollars >= step.at) {
      const scaled = dollars / step.at;
      // Rounded first, then compared: 9.99 formats to "10.0", and "$10.0m"
      // should be "$10m" like every other value of ten and over.
      const oneDecimal = Math.round(scaled * 10) / 10;
      const body = oneDecimal >= 10 ? String(Math.round(scaled)) : oneDecimal.toFixed(1);
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
