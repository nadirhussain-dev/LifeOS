import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { FittedText } from '@/components/ui/fitted-text';
import { MoneyText } from '@/features/budget/components/money-text';

/**
 * The three answers in order, driven through a real render.
 *
 * `fitted-text.test.ts` covers the sizing arithmetic; this covers the wiring
 * around it, which is where the component can be wrong while the maths is
 * right — a slot width that never reaches the fit, a fallback that is computed
 * but never drawn, an exact figure that vanishes from the accessibility tree
 * the moment it is abbreviated.
 *
 * `render` and `fireEvent` are both async in this version of the library; a
 * synchronous call returns a promise that resolves after the assertions and
 * the test passes no matter what the component does.
 */

/** Taken from `fireEvent` rather than imported from react-test-renderer, which
 * ships no types. */
type Element = Parameters<typeof fireEvent>[0];

/** The measurement the component would get from the layout pass. */
const layout = (node: Element, width: number) =>
  fireEvent(node, 'layout', { nativeEvent: { layout: { width, height: 24 } } });

const fontSizeOf = (node: Element): number | undefined =>
  ([node.props.style].flat(Infinity).filter(Boolean) as Record<string, unknown>[]).reduce<
    number | undefined
  >((found, entry) => (typeof entry.fontSize === 'number' ? entry.fontSize : found), undefined);

describe('FittedText', () => {
  it('renders at the full size in a slot with room', async () => {
    const view = await render(<FittedText testID="amount" text="$12.00" size={16} minSize={11} />);
    await layout(view.getByTestId('amount'), 300);
    expect(fontSizeOf(view.getByText('$12.00'))).toBe(16);
  });

  it('shrinks the exact figure rather than abbreviating it', async () => {
    const view = await render(
      <MoneyText testID="amount" cents={123456789} currency="USD" size={16} minSize={9} />,
    );
    await layout(view.getByTestId('amount'), 95);

    // Still the real number — losing the cents is the last resort, not the first.
    const text = view.getByText('$1,234,567.89');
    expect(fontSizeOf(text)).toBeLessThan(16);
    expect(fontSizeOf(text)).toBeGreaterThanOrEqual(9);
  });

  it('abbreviates only once the floor cannot fit either', async () => {
    const view = await render(
      <MoneyText testID="amount" cents={12345678900} currency="USD" size={16} minSize={12} />,
    );
    await layout(view.getByTestId('amount'), 70);

    // The case the component exists for: at a fixed 16px this string is twice
    // the width of its slot, which is what put one figure on top of the next.
    expect(view.getByText('$123m')).toBeTruthy();
    expect(view.queryByText('$123,456,789.00')).toBeNull();
  });

  it('still gives a screen reader the exact figure it abbreviated', async () => {
    const view = await render(
      <MoneyText testID="amount" cents={12345678900} currency="USD" size={16} minSize={12} />,
    );
    await layout(view.getByTestId('amount'), 70);
    expect(view.getByLabelText('$123,456,789.00')).toBeTruthy();
  });

  it('stays on one line whatever it ends up showing', async () => {
    // The guarantee that turns an overflow into a truncation. Without it the
    // text wraps into whatever is drawn beneath it, which is the reported bug.
    const view = await render(
      <FittedText testID="amount" text="$123,456,789.00" size={16} minSize={16} />,
    );
    await layout(view.getByTestId('amount'), 40);
    expect(view.getByText('$123,456,789.00').props.numberOfLines).toBe(1);
  });
});

describe('when the estimate is wrong', () => {
  /**
   * The shipped bug: `PKR 5,550,000....` in the Budget hero, ellipsised, at
   * full size.
   *
   * `textWidth` multiplies a character count by an advance read off Sora's
   * metrics. It was close enough for `$1,234.56` and out by enough for a
   * three-letter currency code that the estimate said "fits" while the text
   * engine truncated. `numberOfLines={1}` then did the only thing left to it.
   *
   * The correction is measurement rather than a better guess: `onTextLayout`
   * reports what the line really was, and the ratio feeds the next fit.
   */
  const layoutText = (node: Element, width: number) =>
    fireEvent(node, 'textLayout', { nativeEvent: { lines: [{ width }] } });

  it('shrinks once the text reports itself wider than predicted', async () => {
    const view = await render(
      <FittedText testID="amount" text="PKR 5,550,000.00" size={36} minSize={22} />,
    );
    // Wide enough that the estimate starts well above the floor, so a shrink
    // is observable. (The OS font-scale divisor applies here too, which is
    // itself part of why this shipped: a phone with type scaled up reaches the
    // floor on a string a default phone renders comfortably.)
    await layout(view.getByTestId('amount'), 600);
    const before = fontSizeOf(view.getByText('PKR 5,550,000.00'));

    // The engine reports the line far wider than the estimate claimed.
    await layoutText(view.getByText('PKR 5,550,000.00'), 900);

    const after = fontSizeOf(view.getByText('PKR 5,550,000.00'));
    expect(after).toBeLessThan(before!);
  });

  it('reaches the compact form rather than ellipsising', async () => {
    // The outcome that matters. Once the real width is known, the exact figure
    // cannot fit above the floor, so the fallback is what gets drawn — which is
    // the whole reason the fallback exists.
    const view = await render(
      <MoneyText testID="amount" cents={555_000_000} currency="PKR" size={36} minSize={22} />,
    );
    await layout(view.getByTestId('amount'), 600);
    const exact = view.queryByText(/5,550,000/);
    if (exact) await layoutText(exact, 1400);

    expect(view.queryByText(/5,550,000/)).toBeNull();
    expect(view.getByText(/5\.5m|5\.6m/)).toBeTruthy();
  });

  it('ignores a line reported narrower than predicted', async () => {
    // A short line is usually one the engine already truncated. Trusting it
    // would relax the correction on exactly the render that proves it needed.
    const view = await render(
      <FittedText testID="amount" text="PKR 5,550,000.00" size={36} minSize={22} />,
    );
    await layout(view.getByTestId('amount'), 600);
    const before = fontSizeOf(view.getByText('PKR 5,550,000.00'));
    await layoutText(view.getByText('PKR 5,550,000.00'), 10);
    expect(fontSizeOf(view.getByText('PKR 5,550,000.00'))).toBe(before);
  });
});
