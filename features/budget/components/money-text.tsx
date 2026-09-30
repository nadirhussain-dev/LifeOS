import { type StyleProp, type TextStyle } from 'react-native';

import { FittedText } from '@/components/ui/fitted-text';
import {
  formatMoney,
  formatMoneyCompact,
  formatMoneyWhole,
} from '@/features/budget/services/money';

type Props = {
  cents: number;
  currency: string;
  /** Font size when the slot has room for the exact figure. */
  size: number;
  /** Smallest size a rendering may shrink to before the next, shorter one
   * takes over. */
  minSize: number;
  /** Weight and colour classes only — no text-size class. */
  className?: string;
  style?: StyleProp<TextStyle>;
  align?: 'start' | 'center' | 'end';
  lineHeightRatio?: number;
  testID?: string;
};

/**
 * An amount in a slot that may be narrower than the amount.
 *
 * Three renderings in order of preference, each allowed to shrink as far as
 * `minSize` before the next is tried: the exact figure, the exact figure
 * without a zero fraction ("PKR 50,000" — nothing lost), then the compact form
 * ("PKR 1.2m"). Precision is only given up where the alternative is a number
 * that cannot be read at all, and the exact figure goes to screen readers
 * either way.
 */
export function MoneyText({ cents, currency, ...rest }: Props) {
  return (
    <FittedText
      text={formatMoney(cents, currency)}
      fallbacks={[formatMoneyWhole(cents, currency), formatMoneyCompact(cents, currency)]}
      {...rest}
    />
  );
}
