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
