import { cva, type VariantProps } from 'class-variance-authority';
import { View, type ViewProps } from 'react-native';

import { cn } from '@/lib/utils';

/**
 * The card contract — the app's resting surface in the spatial stack.
 *
 * This module exports the contract twice on purpose, because a card is not
 * always a `<View>`. Of the surfaces already in the app, most are plain views
 * but a good number are `Pressable` (tappable rows), a few are `Animated.View`
 * (entrance animations) and a few are `TextInput` (fields drawn as cards).
 * A wrapper component alone can't reach those, and the previous `Card` — which
 * was a wrapper and nothing else — ended up with **zero imports** while every
 * screen hand-rolled `rounded-2xl border border-border bg-card` instead. That
 * is how the app came to have three different card radii at once.
 *
 *   • `<Card>`      — the common case, a plain view.
 *   • `cardClass()` — the same classes as a string, for any element that has
 *                     to be something other than a view.
 *
 * Either way the base comes from one place, so retuning the surface is one
 * edit rather than a hundred and fifty.
 */
export const cardVariants = cva('rounded-2xl border border-border bg-card', {
  variants: {
    padding: {
      none: '',
      /** Compact content card. */
      sm: 'p-3.5',
      /** The default content card. */
      md: 'p-4',
      /** Hero / feature card. */
      lg: 'p-5',
      /** A single-line list row — tighter vertically than a content card. */
      row: 'px-4 py-3',
      /** A list row with two lines of text. */
      rowLg: 'px-4 py-3.5',
    },
    elevation: {
      flat: '',
      e1: 'shadow-e1',
      e2: 'shadow-e2',
    },
  },
  defaultVariants: {
    padding: 'md',
    elevation: 'flat',
  },
});

export type CardVariants = VariantProps<typeof cardVariants>;

/**
 * The card classes as a string, for surfaces that can't be a `<Card>`.
 *
 * ```tsx
 * <Pressable className={cardClass({ padding: 'row' }, 'flex-row items-center gap-3')}>
 * ```
 */
export function cardClass(variants?: CardVariants, className?: string): string {
  return cn(cardVariants(variants), className);
}

type Props = ViewProps & CardVariants & { className?: string };

export function Card({ className, padding, elevation, ...props }: Props) {
  return <View className={cardClass({ padding, elevation }, className)} {...props} />;
}
