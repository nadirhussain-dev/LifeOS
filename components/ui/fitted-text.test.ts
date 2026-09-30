import { chooseFit } from '@/components/ui/fitted-text';

/** Widths are what the measuring pass reports for each candidate at `size`. */
describe('chooseFit', () => {
  it('keeps the full size when the first rendering already fits', () => {
    expect(chooseFit([60], 300, 16, 11)).toEqual({ index: 0, fontSize: 16 });
  });

  it('shrinks by the measured ratio, not by a guess', () => {
    // 200px wide at 16px into a 150px slot: 16 × 150 / 200 = 12, less headroom.
    const fit = chooseFit([200], 150, 16, 9);
    expect(fit.index).toBe(0);
    expect(fit.fontSize).toBe(11);
    // Whatever it picks, the line it draws is inside the slot.
    expect((200 * fit.fontSize) / 16).toBeLessThanOrEqual(150);
  });

  it('moves to the next rendering rather than shrinking past the floor', () => {
    // "PKR 50,000.00" measured 112px at 16px against an 80px column: it would
    // need 11px, below the 12px floor. "PKR 50,000" at 86px needs 14px.
    expect(chooseFit([112, 86, 58], 80, 16, 12)).toEqual({ index: 1, fontSize: 14 });
  });

  it('reaches the shortest rendering only when nothing longer fits', () => {
    expect(chooseFit([300, 280, 60], 80, 16, 12)).toEqual({ index: 2, fontSize: 16 });
  });

  it('shrinks the last rendering below the floor rather than truncating it', () => {
    // A truncated figure is the one outcome this exists to prevent; a small
    // one is still a number.
    const fit = chooseFit([300, 200], 80, 16, 12);
    expect(fit.index).toBe(1);
    expect(fit.fontSize).toBeLessThan(12);
    expect(fit.fontSize).toBeGreaterThanOrEqual(8);
  });

  it('never goes above the requested size', () => {
    expect(chooseFit([10], 1000, 16, 11).fontSize).toBe(16);
  });

  it('assumes the full size before the slot has been measured', () => {
    expect(chooseFit([500], 0, 16, 11)).toEqual({ index: 0, fontSize: 16 });
  });
});
