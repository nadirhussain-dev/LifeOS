import { type StyleProp, type TextStyle } from 'react-native';

import { FittedText } from '@/components/ui/fitted-text';
import { formatMoney, formatMoneyCompact } from '@/features/budget/services/money';

type Props = {
  cents: number;
  currency: string;
  /** Font size when the slot has room for the exact figure. */
  size: number;
  /** Smallest size the exact figure may shrink to before the compact form
   * ("$1.2m") takes over. */
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
 * Three answers in order of preference: the exact figure at full size, the
 * exact figure shrunk as far as `minSize`, then the compact form. Losing the
 * cents is a real cost, so it is paid last and only where the alternative is a
 * number that cannot be read at all — and the exact figure still goes to screen
 * readers either way.
 */
export function MoneyText({ cents, currency, ...rest }: Props) {
  return (
    <FittedText
      text={formatMoney(cents, currency)}
      fallback={formatMoneyCompact(cents, currency)}
      {...rest}
    />
  );
}
