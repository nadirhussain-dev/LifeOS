import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { FittedText, FittedTextGroup } from '@/components/ui/fitted-text';
import { MoneyText } from '@/features/budget/components/money-text';

/**
 * The wiring around `chooseFit`, driven through a real render: the slot width
 * and each candidate's measured width arrive as layout events, and the
 * assertions are about what is then drawn.
 *
 * `render` and `fireEvent` are both async in this version of the library; a
 * synchronous call returns a promise that resolves after the assertions and
 * the test passes no matter what the component does.
 */

/** Taken from `fireEvent` rather than imported from react-test-renderer, which
 * ships no types. */
type Element = Parameters<typeof fireEvent>[0];
type View = Awaited<ReturnType<typeof render>>;

const layout = (node: Element, width: number) =>
  fireEvent(node, 'layout', { nativeEvent: { layout: { width, height: 24 } } });

/** Lays out the slot, then reports each candidate's natural width. */
async function measure(view: View, id: string, slot: number, widths: number[]) {
  await layout(view.getByTestId(id), slot);
  for (const [index, width] of widths.entries()) {
    await layout(
      view.getByTestId(`${id}-measure-${index}`, { includeHiddenElements: true }),
      width,
    );
  }
}

const styleOf = (node: Element) =>
  ([node.props.style].flat(Infinity).filter(Boolean) as Record<string, unknown>[]).reduce<
    Record<string, unknown>
  >((merged, entry) => ({ ...merged, ...entry }), {});

describe('FittedText', () => {
  it('stays invisible until it has measured, so no frame shows an ellipsis', async () => {
    const view = await render(<FittedText testID="amount" text="$12.00" size={16} minSize={11} />);
    expect(styleOf(view.getByText('$12.00')).opacity).toBe(0);
    await measure(view, 'amount', 300, [50]);
    expect(styleOf(view.getByText('$12.00')).opacity).toBeUndefined();
    expect(styleOf(view.getByText('$12.00')).fontSize).toBe(16);
  });

  it('shrinks the exact figure when that is enough', async () => {
    const view = await render(
      <MoneyText testID="amount" cents={123456789} currency="USD" size={16} minSize={9} />,
    );
    // Real cents, so the whole-number form is the exact one and is deduplicated.
    await measure(view, 'amount', 95, [130, 50]);
    const size = styleOf(view.getByText('$1,234,567.89')).fontSize as number;
    expect(size).toBeLessThan(16);
    expect(size).toBeGreaterThanOrEqual(9);
  });

  it('drops a zero fraction before abbreviating', async () => {
    // The reported bug: `PKR 50,000....` in a hero column.
    const view = await render(
      <MoneyText testID="amount" cents={5_000_000} currency="USD" size={16} minSize={12} />,
    );
    await measure(view, 'amount', 80, [112, 86, 50]);
    expect(view.getByText('$50,000')).toBeTruthy();
    expect(view.getByLabelText('$50,000.00')).toBeTruthy();
  });

  it('abbreviates only once nothing longer fits, and keeps the exact figure for a screen reader', async () => {
    const view = await render(
      <MoneyText testID="amount" cents={12345678900} currency="USD" size={16} minSize={12} />,
    );
    await measure(view, 'amount', 70, [150, 150, 45]);
    expect(view.getByText('$123m')).toBeTruthy();
    expect(view.getByLabelText('$123,456,789.00')).toBeTruthy();
  });

  it('stays on one line and shrinks rather than truncating', async () => {
    const view = await render(
      <FittedText testID="amount" text="$123,456,789.00" size={16} minSize={16} />,
    );
    await measure(view, 'amount', 40, [150]);
    const text = view.getByText('$123,456,789.00');
    expect(text.props.numberOfLines).toBe(1);
    expect(text.props.adjustsFontSizeToFit).toBe(true);
  });
});

describe('FittedTextGroup', () => {
  it('draws every member at the size the tightest one needed', async () => {
    const view = await render(
      <FittedTextGroup>
        <FittedText testID="a" text="PKR 0.00" size={16} minSize={10} />
        <FittedText testID="b" text="PKR 50,000.00" size={16} minSize={10} />
      </FittedTextGroup>,
    );
    await measure(view, 'a', 80, [60]);
    await measure(view, 'b', 80, [110]);
    const a = styleOf(view.getByText('PKR 0.00')).fontSize as number;
    const b = styleOf(view.getByText('PKR 50,000.00')).fontSize as number;
    expect(b).toBeLessThan(16);
    expect(a).toBe(b);
  });
});
