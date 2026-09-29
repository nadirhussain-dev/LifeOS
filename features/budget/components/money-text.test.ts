import { fitFontSize, textWidth } from '@/components/ui/fitted-text';
import { formatMoneyCompact } from '@/features/budget/services/money';

/**
 * The Budget screens as a PKR user actually sees them.
 *
 * Reported with screenshots: the hero's income/expenses/savings row wrapping
 * onto two lines with the figures running together, and the account tiles doing
 * the same. `MoneyText` fixed that — but every measurement behind it was taken
 * against `$1,234.56`, and a three-letter currency code plus a space is four
 * more characters before a digit is drawn. This is the case that broke, pinned
 * at the widths it broke at.
 *
 * ## Why the strings are literals rather than `formatMoney(…, 'PKR')`
 *
 * They disagree. Node's ICU gives PKR **no** fraction digits here — `PKR
 * 54,000` — while the device in the screenshots renders `PKR 49,500.00`. ICU
 * currency data differs between Hermes on Android and whatever Node was built
 * against, and it moves between versions. Measuring against the Node spelling
 * would quietly test a string three characters shorter than the real one, which
 * is exactly the margin that decides whether this fits.
 *
 * So the literals are what the phone drew, and the assertions are about layout
 * rather than about formatting. `money.test.ts` owns the formatting.
 */

/** Slot widths on a 360px phone, which is what the screenshots were taken on. */
const HERO_COLUMN = 80; // 360 − 40 screen − 40 hero − 24 padding − 16 gaps, ÷ 3
const ACCOUNT_TILE = 84; // (360 − 40 screen − 20 gaps) ÷ 3, − 16 padding
const DONUT_HOLE = 110; // (180 − 2×26) × 0.86

const FROM_THE_SCREENSHOTS = [
  'PKR 54,000.00',
  'PKR 49,500.00',
  'PKR 4,000.00',
  '-PKR 23,500.00',
  'PKR 24,000.00',
];

describe('a long currency code in a narrow slot', () => {
  it('never needs a second line', () => {
    // The actual reported bug. Whatever size it lands on, and whether it is the
    // exact figure or the compact one, exactly one line is drawn — `FittedText`
    // is `numberOfLines={1}` unconditionally. A two-line render is therefore
    // impossible, which is also how a screenshot can be dated: the one in the
    // report wraps, so it predates this.
    for (const text of FROM_THE_SCREENSHOTS) {
      const fitted = fitFontSize(text, HERO_COLUMN, 15, 11);
      // Either it fits inside the slot, or the caller is told to use the
      // shorter rendering. There is no third outcome that overflows.
      if (fitted !== null) {
        expect(textWidth(text, fitted)).toBeLessThanOrEqual(HERO_COLUMN);
      }
    }
  });

  it('falls back to the compact form rather than shrinking past legibility', () => {
    // "PKR 54,000.00" at 15px is ~112px against an 80px column. Shrinking it to
    // fit would mean 10px, and 10px in a glance row is not a figure anybody
    // reads — "PKR 54k" at full size carries more.
    const tooWide = fitFontSize('PKR 54,000.00', HERO_COLUMN, 15, 11);
    expect(tooWide).toBeNull();

    const compact = formatMoneyCompact(5_400_000, 'PKR');
    const compactFit = fitFontSize(compact, HERO_COLUMN, 15, 11);
    expect(compactFit).not.toBeNull();
    expect(compactFit).toBe(15);
  });

  it('keeps the exact figure wherever there is room for it', () => {
    // Everything but the negative balance fits the account tile outright.
    for (const text of FROM_THE_SCREENSHOTS.filter((t) => !t.startsWith('-'))) {
      expect([text, fitFontSize(text, ACCOUNT_TILE, 15, 11)]).not.toEqual([text, null]);
    }
    // The donut hole has room for all of them.
    expect(fitFontSize('PKR 49,500.00', DONUT_HOLE, 20, 13)).not.toBeNull();
  });

  it('abbreviates a negative balance without rounding away the hundreds', () => {
    /*
     * "-PKR 23,500.00" is the Cash tile in the screenshot and the one figure
     * too wide for its slot even at the floor — a minus sign is a whole
     * character on top of an already-long currency code.
     *
     * The compact form used to round it to "-PKR 24k", which on a balance is a
     * number that reads as exact and is five hundred out. One decimal below a
     * hundred makes it "-PKR 23.5k", which costs two characters and still fits.
     */
    expect(fitFontSize('-PKR 23,500.00', ACCOUNT_TILE, 15, 11)).toBeNull();

    const compact = formatMoneyCompact(-2_350_000, 'PKR');
    expect(compact).toContain('23.5');
    const size = fitFontSize(compact, ACCOUNT_TILE, 15, 11);
    expect(size).not.toBeNull();
    expect(textWidth(compact, size!)).toBeLessThanOrEqual(ACCOUNT_TILE);
  });

  it('keeps the donut total off the ring it is summarising', () => {
    // The centre label used to lay out against the full 180px chart rather than
    // the hole, so a long total drew straight over the slices.
    const size = fitFontSize('PKR 49,500.00', DONUT_HOLE, 20, 13);
    expect(size).not.toBeNull();
    expect(textWidth('PKR 49,500.00', size!)).toBeLessThanOrEqual(DONUT_HOLE);
  });
});
