import { fitFontSize, textWidth } from '@/components/ui/fitted-text';

describe('textWidth', () => {
  it('scales linearly with the font size', () => {
    expect(textWidth('12345', 20)).toBeCloseTo(textWidth('12345', 10) * 2);
  });

  it('charges separators less than digits', () => {
    // "1,234" and "12345" are both five characters. A flat per-character
    // estimate would call them the same width and then over-shrink every
    // grouped number on screen.
    expect(textWidth('1,234', 16)).toBeLessThan(textWidth('12345', 16));
  });

  it('over-estimates rather than under-estimates', () => {
    // The margin is the whole reason a fitted number does not clip: Sora's
    // bold digits are wider than its regular ones, and the estimate has to
    // cover the heaviest weight a caller might pass.
    expect(textWidth('0', 100)).toBeGreaterThan(64);
  });
});

describe('fitFontSize', () => {
  it('returns the maximum when the text already fits', () => {
    expect(fitFontSize('$12.00', 300, 16, 11)).toBe(16);
  });

  it('steps down to the largest size that fits', () => {
    const size = fitFontSize('$1,234,567.89', 100, 16, 8);
    expect(size).not.toBeNull();
    expect(size!).toBeLessThan(16);
    expect(textWidth('$1,234,567.89', size!)).toBeLessThanOrEqual(100);
    // ...and it is the largest such size, not merely *a* size that fits.
    expect(textWidth('$1,234,567.89', size! + 1)).toBeGreaterThan(100);
  });

  it('returns null rather than shrinking past the floor', () => {
    // The signal the caller needs in order to swap in a compact rendering.
    // Without it a nine-figure balance renders at 3px, which is not a smaller
    // problem than an overlapping one.
    expect(fitFontSize('$123,456,789.00', 60, 16, 11)).toBeNull();
  });

  it('assumes the full size before the first layout reports a width', () => {
    // Width 0 means "not measured yet", not "no room" — treating it as no room
    // would render every amount in the app at its floor for one frame.
    expect(fitFontSize('$1,234,567.89', 0, 16, 11)).toBe(16);
  });

  it('never returns a size outside the requested range', () => {
    for (const text of ['$1', '$1,000.00', '$999,999,999.99']) {
      const size = fitFontSize(text, 120, 16, 11);
      if (size !== null) {
        expect(size).toBeGreaterThanOrEqual(11);
        expect(size).toBeLessThanOrEqual(16);
      }
    }
  });
});
