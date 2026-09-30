import { chooseFit } from '@/components/ui/fitted-text';
import {
  formatMoney,
  formatMoneyCompact,
  formatMoneyWhole,
} from '@/features/budget/services/money';

/**
 * The Budget hero as a PKR user sees it.
 *
 * Reported with a screenshot: `PKR 50,000....` and `PKR 20,000....` in the
 * income/expenses columns, ellipsised at full size. The fit had guessed the
 * width from a character count and guessed short. The fit now works from
 * measured widths; these pin the choice it makes for the reported figures,
 * using widths proportional to what Sora Bold draws (~0.6em a glyph).
 */
const HERO_COLUMN = 90; // 360 − 40 screen − 40 hero − 16 padding − 12 gaps, ÷ 3
const at16 = (text: string) => text.length * 0.6 * 16;

describe('formatMoneyWhole', () => {
  it('drops a zero fraction and nothing else', () => {
    expect(formatMoneyWhole(5_000_000, 'USD')).toBe('$50,000');
    expect(formatMoneyWhole(5_000_050, 'USD')).toBe(formatMoney(5_000_050, 'USD'));
    expect(formatMoneyWhole(-250_000, 'USD')).toBe('-$2,500');
  });

  it('matches formatMoney for a currency with no minor unit', () => {
    expect(formatMoneyWhole(100_000, 'JPY')).toBe(formatMoney(100_000, 'JPY'));
  });
});

describe('the reported hero row', () => {
  const renderings = (cents: number) => [
    'PKR 50,000.00', // what the phone drew; Node's ICU spells PKR differently
    formatMoneyWhole(cents, 'PKR'),
    formatMoneyCompact(cents, 'PKR'),
  ];

  it('drops the zero cents before it abbreviates', () => {
    const options = renderings(5_000_000);
    const fit = chooseFit(options.map(at16), HERO_COLUMN, 16, 12);
    expect(options[fit.index]).toMatch(/50,000$/);
    expect(fit.fontSize).toBeGreaterThanOrEqual(12);
  });

  it('keeps the exact figure wherever it fits', () => {
    const fit = chooseFit([at16('PKR 0.00')], HERO_COLUMN, 16, 12);
    expect(fit).toEqual({ index: 0, fontSize: 16 });
  });

  it('abbreviates a balance with real cents without rounding away the hundreds', () => {
    expect(formatMoneyCompact(-2_350_000, 'PKR')).toContain('23.5');
  });
});
