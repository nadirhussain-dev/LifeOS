/**
 * The statistics the insight engine needs to be trustworthy.
 *
 * Kept separate and tested against published values, because these functions
 * are the difference between "we found a pattern" and "we found noise and told
 * you it was a pattern". Once the engine can test dozens of metric pairs
 * cheaply (see correlation-specs.ts), false positives stop being a risk and
 * become an arithmetic certainty — roughly one in twenty pairs will look
 * significant at p<0.05 by chance alone. Everything here exists to stop the app
 * reporting those with a straight face.
 *
 * Deliberately not a stats library dependency: this is four functions, they
 * need to run on-device inside a memo, and a wrong answer here is invisible
 * rather than loud — which is exactly the case for owning the code and testing
 * it against numbers someone else published.
 */

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Sample variance (Bessel-corrected). Zero for fewer than two values. */
export function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
}

/**
 * Welch's t statistic and its degrees of freedom.
 *
 * Welch rather than Student's because the two groups here are never balanced:
 * "nights under six hours" and "nights over six hours" have different sizes and
 * different spreads, and Student's t assumes equal variance. Assuming it when
 * it does not hold inflates significance in exactly the direction that produces
 * confident nonsense.
 */
export function welchT(a: number[], b: number[]): { t: number; df: number } | null {
  if (a.length < 2 || b.length < 2) return null;
  const va = variance(a);
  const vb = variance(b);
  const sa = va / a.length;
  const sb = vb / b.length;
  const denominator = sa + sb;
  // Both groups constant: the difference is either zero or absolute, and no
  // amount of arithmetic makes a spread-free sample informative.
  if (denominator <= 0) return null;

  const t = (mean(a) - mean(b)) / Math.sqrt(denominator);
  const df = denominator ** 2 / (sa ** 2 / (a.length - 1) + sb ** 2 / (b.length - 1));
  return { t, df };
}

/** Continued-fraction expansion of the incomplete beta function (Lentz). */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const TINY = 1e-30;
  const EPS = 3e-16;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;

  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** log Γ(x), Lanczos approximation. */
function logGamma(x: number): number {
  const coefficients = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let series = 1.000000000190015;
  for (const c of coefficients) {
    y += 1;
    series += c / y;
  }
  return -tmp + Math.log((2.5066282746310005 * series) / x);
}

/** Regularized incomplete beta function I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(x, a, b)) / a
    : 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

/**
 * Two-tailed p-value for a t statistic on `df` degrees of freedom.
 *
 * The real thing rather than a normal approximation. At the sample sizes one
 * person's logs produce — often eight or ten days per group — the normal
 * approximation is anti-conservative by enough to matter: it would report
 * p≈0.046 where the honest answer is p≈0.073, and that gap is the whole
 * difference between publishing a pattern and not.
 */
export function tTestPValue(t: number, df: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return 1;
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

/**
 * Benjamini–Hochberg: which of a set of p-values survive testing many
 * hypotheses at once.
 *
 * Returns a boolean per input, in the input's order. BH rather than Bonferroni
 * because Bonferroni over twenty specs demands p<0.0025 of every one of them,
 * which at these sample sizes means nothing is ever reported and the feature is
 * dead. BH controls the *proportion* of reported patterns that are false rather
 * than the chance of any error at all, which is the right trade for a screen
 * that shows several findings and describes them as things that move together.
 */
export function benjaminiHochberg(pValues: number[], fdr = 0.1): boolean[] {
  const n = pValues.length;
  if (n === 0) return [];

  const ordered = pValues.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p);

  // Largest rank k where p_(k) <= (k/n) * fdr; everything up to it survives.
  let cutoffRank = 0;
  ordered.forEach((entry, i) => {
    if (entry.p <= ((i + 1) / n) * fdr) cutoffRank = i + 1;
  });

  const survives = new Array<boolean>(n).fill(false);
  for (let i = 0; i < cutoffRank; i += 1) {
    survives[ordered[i].index] = true;
  }
  return survives;
}
