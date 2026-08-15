import { ShieldCheck } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { daysToNextShield } from '@/features/challenge/services/challenge-math';
import { useTheme } from '@/hooks/use-theme';

/**
 * The shield buffer, drawn as objects rather than a number.
 *
 * Three slots, filled or empty. The cap is what makes the mechanic work at all
 * — a buffer you cannot see the end of is a buffer nobody protects — so it is
 * shown as a fixed set of holes rather than a counter that could be anything.
 * Spending the last one should feel like something, and it only can if the
 * emptiness was visible beforehand.
 */

type Props = {
  shields: number;
  cap: number;
  perfectRun: number;
  shieldEarnDays: number;
};

export function ShieldSlots({ shields, cap, perfectRun, shieldEarnDays }: Props) {
  const { t } = useTranslation();
  const { c } = useTheme();

  const untilNext = daysToNextShield(perfectRun, shieldEarnDays, shields, cap);

  return (
    <View className={cardClass({ padding: 'md' }, 'gap-3')}>
      <View className="flex-row items-baseline justify-between">
        <Text variant="micro">{t('challenge.shieldsTitle')}</Text>
        <Text variant="caption">{t('challenge.shieldsHeld', { held: shields, cap })}</Text>
      </View>

      <View className="flex-row gap-2">
        {Array.from({ length: cap }, (_, index) => {
          const filled = index < shields;
          return (
            <View
              key={index}
              accessibilityLabel={t('challenge.shieldsTitle')}
              className="h-11 flex-1 items-center justify-center rounded-lg"
              style={{
                backgroundColor: filled ? `${c.accent}1f` : c.surface,
                borderWidth: filled ? 0 : 1,
                borderColor: c.border,
              }}
            >
              <ShieldCheck
                size={20}
                color={filled ? c.accent : c.subtleForeground}
                strokeWidth={filled ? 2.2 : 1.6}
              />
            </View>
          );
        })}
      </View>

      <Text variant="caption">
        {untilNext === null
          ? t('challenge.shieldsFull')
          : t('challenge.nextShieldIn', { days: untilNext })}
      </Text>
    </View>
  );
}
