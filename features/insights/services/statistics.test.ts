import {
  benjaminiHochberg,
  incompleteBeta,
  mean,
  tTestPValue,
  variance,
  welchT,
} from '@/features/insights/services/statistics';

const near = (actual: number, expected: number, tolerance = 1e-4) =>
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance);

describe('mean and variance', () => {
  it('averages', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });

  it('returns 0 for an empty set rather than NaN', () => {
    expect(mean([])).toBe(0);
  });

  it('uses the Bessel-corrected sample variance', () => {
    // Population variance of [2,4,4,4,5,5,7,9] is 4; the sample variance,
    // dividing by n-1, is 32/7.
    near(variance([2, 4, 4, 4, 5, 5, 7, 9]), 32 / 7);
  });

  it('has no variance with fewer than two values', () => {
    expect(variance([5])).toBe(0);
    expect(variance([])).toBe(0);
  });
});

describe('incompleteBeta', () => {
  // Published values for the regularized incomplete beta function.
  it('matches known values', () => {
    near(incompleteBeta(0.5, 1, 1), 0.5);
    near(incompleteBeta(0.5, 2, 3), 0.6875);
    near(incompleteBeta(0.2, 3, 2), 0.0272);
  });

  it('is clamped outside [0,1]', () => {
    expect(incompleteBeta(0, 2, 2)).toBe(0);
    expect(incompleteBeta(1, 2, 2)).toBe(1);
    expect(incompleteBeta(-1, 2, 2)).toBe(0);
  });
});

describe('tTestPValue', () => {
  // Against a standard two-tailed t table. These are the numbers that make the
  // whole guard trustworthy, so they are checked rather than assumed.
  it('matches the t table at df=10', () => {
    near(tTestPValue(2.228, 10), 0.05, 1e-3);
    near(tTestPValue(3.169, 10), 0.01, 1e-3);
    near(tTestPValue(2.0, 10), 0.0734, 1e-3);
  });

  it('matches the t table at df=5', () => {
    near(tTestPValue(2.571, 5), 0.05, 1e-3);
    near(tTestPValue(4.032, 5), 0.01, 1e-3);
  });

  it('approaches the normal at large df', () => {
    near(tTestPValue(1.96, 1e6), 0.05, 1e-3);
  });

  it('is 1 for no difference at all', () => {
    near(tTestPValue(0, 10), 1);
  });

  it('is symmetric in the sign of t', () => {
    near(tTestPValue(-2.228, 10), tTestPValue(2.228, 10));
  });

  it('refuses nonsense inputs rather than returning a tiny p', () => {
    expect(tTestPValue(Number.NaN, 10)).toBe(1);
    expect(tTestPValue(2, 0)).toBe(1);
    expect(tTestPValue(2, Number.NaN)).toBe(1);
  });

  it('is stricter than the normal approximation at small samples', () => {
    // The reason the real distribution is used. A normal approximation puts
    // t=2.0 at p≈0.0455 — under the 0.05 line — while the truth at df=10 is
    // 0.073, which is over it.
    expect(tTestPValue(2.0, 10)).toBeGreaterThan(0.05);
  });
});

describe('welchT', () => {
  it('needs two values in each group', () => {
    expect(welchT([1], [1, 2, 3])).toBeNull();
    expect(welchT([1, 2, 3], [2])).toBeNull();
  });

  it('returns null when neither group varies at all', () => {
    // No spread means no basis for inference, however different the means look.
    expect(welchT([5, 5, 5], [9, 9, 9])).toBeNull();
  });

  it('computes a known Welch result', () => {
    // Unequal sizes and unequal spread — the case Student's t gets wrong.
    const result = welchT([27, 31, 29, 33, 30], [21, 19, 24, 22]);
    expect(result).not.toBeNull();
    // Group A: mean 30, sample variance 5.     Group B: mean 21.5, variance 13/3.
    // t = 8.5 / sqrt(5/5 + (13/3)/4) = 8.5 / sqrt(2.08333) = 5.8889
    near(result!.t, 5.8889, 1e-3);
    near(result!.df, 6.769, 1e-2);
  });

  it('is zero when the means match', () => {
    const result = welchT([1, 2, 3, 4], [2, 3, 1, 4]);
    near(result!.t, 0);
  });
});

describe('benjaminiHochberg', () => {
  it('returns nothing for no tests', () => {
    expect(benjaminiHochberg([])).toEqual([]);
  });

  it('keeps a clearly significant result', () => {
    expect(benjaminiHochberg([0.001, 0.9, 0.8, 0.7], 0.1)).toEqual([true, false, false, false]);
  });

  it('rejects a lone borderline result once many pairs were tested', () => {
    // The point of the correction. One p=0.04 among twenty tested pairs is what
    // chance produces, and reporting it as a finding is how this feature would
    // become a horoscope.
    const pValues = [0.04, ...Array.from({ length: 19 }, () => 0.6)];
    expect(benjaminiHochberg(pValues, 0.1)[0]).toBe(false);
  });

  it('keeps a step-up run rather than stopping at the first failure', () => {
    // BH is a step-up procedure: p=0.03 at rank 3 of 4 passes (0.03 <= 0.075),
    // which rescues the ranks below it even though rank 2 alone would fail
    // its own threshold.
    const result = benjaminiHochberg([0.01, 0.04, 0.03, 0.9], 0.1);
    expect(result.slice(0, 3)).toEqual([true, true, true]);
    expect(result[3]).toBe(false);
  });

  it('respects the false-discovery rate it is given', () => {
    expect(benjaminiHochberg([0.04], 0.01)).toEqual([false]);
    expect(benjaminiHochberg([0.04], 0.1)).toEqual([true]);
  });
});
