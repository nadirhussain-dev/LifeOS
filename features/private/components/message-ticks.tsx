import { Check, CheckCheck, Clock } from 'lucide-react-native';
import { View } from 'react-native';

import type { MessageReceipt } from '@/features/private/hooks/use-shared-albums';
import { alpha } from '@/lib/color';

/**
 * The one/two/blue tick beside your own message.
 *
 * Drawn only on your own messages: a tick on somebody else's would be telling
 * them what you already know by looking at it.
 *
 * Colour, not shape, carries "read" — two grey ticks and two blue ticks are the
 * same glyph — so the `accessibilityLabel` is what actually distinguishes them
 * for anybody not reading colour, and it is not optional decoration here.
 */
export function MessageTicks({
  receipt,
  label,
  onLight,
}: {
  receipt: MessageReceipt;
  /** Already-translated description, e.g. "Read". */
  label: string;
  /** True inside your own tinted bubble, where white reads and grey does not. */
  onLight: boolean;
}) {
  const base = onLight ? '#ffffff' : '#64748b';
  // Blue stays blue on both grounds: it is the only state distinguished by
  // colour alone, so tinting it to match the bubble would erase the
  // distinction entirely.
  const color = receipt === 'read' ? '#38bdf8' : alpha(base, 0.75);

  return (
    <View accessibilityRole="image" accessibilityLabel={label} className="ml-1">
      {receipt === 'sending' ? (
        <Clock size={13} color={color} />
      ) : receipt === 'sent' ? (
        <Check size={13} color={color} />
      ) : (
        <CheckCheck size={13} color={color} />
      )}
    </View>
  );
}
