import { type LucideIcon } from 'lucide-react-native';
import { type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { fontFamily, typography } from '@/constants/design-tokens';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';

type Props = {
  /** UPPERCASE micro label above the number — what is being measured. */
  eyebrow: string;
  /** The number itself. Kept short: "7", "2.1L", "4h 32m". */
  value: string;
  /** Optional trailing unit, set smaller and lighter so the number dominates. */
  unit?: string;
  /** One quiet line under the number giving the figure meaning. */
  caption?: string;
  /** Module tint. Colours the eyebrow and the hairline rule. */
  tint: string;
  icon?: LucideIcon;
  /** Secondary figures, shown as a quiet row beneath the rule. */
  aside?: ReactNode;
};

/**
 * A screen's subject, set as type rather than boxed in a card.
 *
 * The type scale has had `display` (40) and `stat` (34) since it was written
 * and nothing used either — every module opened on a 24px `heading` inside a
 * gradient card, so twelve screens about numbers had no number anywhere near
 * the size of their own headline. This spends that scale: the figure is the
 * largest thing on the screen, sitting on the ground with nothing drawn around
 * it, which is both quieter and far more emphatic than another tinted box.
 *
 * Numbers are tabular so a value that ticks (a running timer, a live total)
 * doesn't jitter its own width, and tracking is tight because the display
 * sizes open up badly at default spacing.
 */
export function StatHero({ eyebrow, value, unit, caption, tint, icon: Icon, aside }: Props) {
  const { c } = useTheme();
  const reducedMotion = useReducedMotion();

  return (
    <View className="gap-3 px-1 pb-1 pt-2">
      <Animated.View
        entering={reducedMotion ? undefined : FadeIn.duration(220)}
        className="flex-row items-center gap-2"
      >
        {Icon ? <Icon size={13} color={tint} strokeWidth={2.4} /> : null}
        <Text
          variant="micro"
          style={{ color: tint, letterSpacing: 1.1 }}
          className="font-sora-semibold"
        >
          {eyebrow}
        </Text>
      </Animated.View>

      <Animated.View
        entering={reducedMotion ? undefined : FadeInDown.duration(320)}
        className="flex-row items-baseline gap-2"
      >
        <Text
          style={{
            fontFamily: fontFamily.extrabold,
            fontSize: typography.display.size,
            lineHeight: typography.display.lineHeight,
            letterSpacing: typography.display.tracking,
            color: c.foreground,
            fontVariant: ['tabular-nums'],
          }}
        >
          {value}
        </Text>
        {unit ? (
          <Text
            style={{
              fontFamily: fontFamily.semibold,
              fontSize: typography.h3.size,
              color: c.mutedForeground,
            }}
          >
            {unit}
          </Text>
        ) : null}
      </Animated.View>

      {caption ? <Text variant="muted">{caption}</Text> : null}

      {aside ? (
        <View
          className="mt-1 gap-3 border-t pt-3"
          // A hairline in the module's own tint rather than the generic border:
          // it is the only chrome this hero has, so it may as well carry the
          // module's identity instead of a grey the whole app shares.
          style={{ borderTopColor: alpha(tint, 0.25) }}
        >
          {aside}
        </View>
      ) : null}
    </View>
  );
}
