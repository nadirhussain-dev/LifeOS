import { formatMoney, formatMoneyCompact, parseAmountToCents } from './money';

describe('parseAmountToCents', () => {
  it('parses whole and fractional amounts to integer cents', () => {
    expect(parseAmountToCents('1250')).toBe(125000);
    expect(parseAmountToCents('1,250.5')).toBe(125050);
    expect(parseAmountToCents('0.99')).toBe(99);
  });

  it('returns 0 for empty or non-numeric input', () => {
    expect(parseAmountToCents('')).toBe(0);
    expect(parseAmountToCents('abc')).toBe(0);
    expect(parseAmountToCents('$')).toBe(0);
  });

  it('rounds to the nearest cent', () => {
    expect(parseAmountToCents('1.005')).toBe(101); // 100.5 → 101
  });
});

describe('formatMoney', () => {
  it('formats USD with 2 decimals and grouping', () => {
    // Intl (en-US fallback locale in tests) → "$1,200.50".
    expect(formatMoney(120050, 'USD')).toBe('$1,200.50');
    expect(formatMoney(120000, 'USD')).toBe('$1,200.00');
  });

  it('uses the correct fraction digits per currency (the core bug fix)', () => {
    // JPY has 0 decimal places — must NOT show cents. 100000 minor-units = ¥1,000.
    expect(formatMoney(100000, 'JPY')).toBe('¥1,000');
    // KRW is also zero-decimal.
    expect(formatMoney(500000, 'KRW')).toBe('₩5,000');
  });

  it('renders negatives', () => {
    expect(formatMoney(-2500, 'USD')).toBe('-$25.00');
  });

  it('falls back gracefully for a raw-symbol (non-ISO) currency', () => {
    // Unknown code → manual path: symbol + grouped value.
    expect(formatMoney(120050, '$')).toBe('$1,200.50');
  });
});

describe('formatMoneyCompact', () => {
  it('abbreviates thousands', () => {
    expect(formatMoneyCompact(120000, 'USD')).toBe('$1.2k');
    expect(formatMoneyCompact(95000, 'USD')).toBe('$950');
  });

  it('abbreviates millions and billions', () => {
    // The k step on its own turned a nine-figure balance into "$10000k" —
    // longer than the amounts this is meant to shorten.
    expect(formatMoneyCompact(340_000_000, 'USD')).toBe('$3.4m');
    expect(formatMoneyCompact(123_456_789_00, 'USD')).toBe('$123m');
    expect(formatMoneyCompact(250_000_000_000, 'USD')).toBe('$2.5b');
  });

  it('rounds before choosing how many decimals to show', () => {
    // 9.99m formats to "10.0" at one decimal, and every other value of ten and
    // over drops the decimal — so this one must too.
    expect(formatMoneyCompact(999_900_000, 'USD')).toBe('$10m');
  });

  it('keeps the sign', () => {
    expect(formatMoneyCompact(-340_000_000, 'USD')).toBe('-$3.4m');
  });

  it('never gets longer than the figure it stands in for', () => {
    // The property that matters at the call site: this is only ever reached
    // because the full string did not fit.
    for (const cents of [95_000, 120_000, 340_000_000, 999_900_000, 250_000_000_000]) {
      expect(formatMoneyCompact(cents, 'USD').length).toBeLessThanOrEqual(
        formatMoney(cents, 'USD').length,
      );
    }
  });
});
