import { type ReactNode } from 'react';
import { Pressable, type PressableProps } from 'react-native';

import { Text } from '@/components/ui/text';
import { type TintPair } from '@/constants/design-tokens';
import { useTheme } from '@/hooks/use-theme';
import { inkSafeFill } from '@/lib/color';
import { cn } from '@/lib/utils';

type Props = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  selected?: boolean;
  /**
   * Fill when selected. A `TintPair` (resolved per theme) or a bare hex for a
   * colour the user chose, which has no pair.
   */
  tint?: TintPair | string;
  /** Leading icon or dot. */
  leading?: ReactNode;
  className?: string;
};

/**
 * A selectable pill — filter rows, quick-value pickers, category pickers.
 *
 * This was the same control hand-drawn in seven places (goals/index,
 * study/log, sleep/log, budget/transaction, budget/debts/new,
 * split/[id]/expense, gallery/album/new), and all seven shared one bug: they
 * filled with `resolveTint(tint, scheme)` and hardcoded `text-white` on top.
 * Correct on light, where the tints are dark. On dark, `resolveTint` returns the
 * *bright* variant by design, and white on music's lime ran at 1.3:1.
 *
 * The fill goes through `inkSafeFill`, which is the answer the gradients already
 * give — darken the surface until white reads, never move the hue — so a chip,
 * a hero wash and a gradient button all speak one white-on-colour language.
 *
 * Unselected carries a border and muted text: selection is never colour alone,
 * and `accessibilityState.selected` says so to a screen reader.
 */
export function Chip({ label, selected, tint, leading, className, ...props }: Props) {
  const { c, resolve } = useTheme();
  const raw = typeof tint === 'string' ? tint : tint ? resolve(tint) : c.accent;
  const fill = inkSafeFill(raw);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      className={cn(
        'flex-row items-center gap-1.5 rounded-full border px-3.5 py-1.5',
        !selected && 'border-border',
        className,
      )}
      style={selected ? { backgroundColor: fill, borderColor: fill } : undefined}
      {...props}
    >
      {leading}
      <Text
        className={cn(
          'text-sm',
          selected ? 'font-sora-semibold text-white' : 'text-muted-foreground',
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}
