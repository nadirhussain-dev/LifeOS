import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Flame } from '@/components/ui/icons';
import { ProgressRing } from '@/components/ui/progress-ring';
import { Text } from '@/components/ui/text';
import { useMilestonePulse } from '@/features/private/hooks/use-milestone-pulse';
import { alpha } from '@/lib/color';

const MILESTONES = [
  { days: 1, labelKey: 'private.milestone24h' },
  { days: 3, labelKey: 'private.milestone3d' },
  { days: 7, labelKey: 'private.milestone1w' },
  { days: 30, labelKey: 'private.milestone1m' },
  { days: 90, labelKey: 'private.milestone3m' },
  { days: 365, labelKey: 'private.milestone1y' },
] as const;

const MILESTONE_DAYS = MILESTONES.map((m) => m.days);

type Props = {
  /** Days clean, or null when there has never been a logged relapse — see
   *  recovery-math.ts's RecoveryStats.currentStreak. */
  currentStreak: number | null;
  longestStreak: number;
  tint: string;
};

/**
 * Recovery's hero: the streak as a ring sweeping toward the next milestone,
 * with the milestone ladder underneath so progress reads as a path rather
 * than a lone number. A relapse still logs as data, not a verdict — the
 * ring only ever grows, it never renders red or "reset".
 */
export function RecoveryHero({ currentStreak, longestStreak, tint }: Props) {
  const { t } = useTranslation();
  const days = currentStreak ?? longestStreak;
  const nextMilestone = MILESTONES.find((m) => m.days > days) ?? null;
  const progress = nextMilestone ? days / nextMilestone.days : 1;

  const { style: pulseStyle } = useMilestonePulse(days, MILESTONE_DAYS);

  return (
    <View className="items-center gap-4 py-2">
      <Animated.View style={pulseStyle}>
        <ProgressRing progress={progress} size={168} strokeWidth={14} color={tint} gradient>
          <View className="items-center gap-0.5">
            <Flame size={18} color={tint} strokeWidth={2} />
            <Text className="font-sora-extrabold text-4xl" style={{ color: tint }}>
              {days}
            </Text>
            <Text variant="caption">{t('private.days', { count: days })}</Text>
          </View>
        </ProgressRing>
      </Animated.View>

      <View className="flex-row gap-1.5">
        {MILESTONES.map((m) => {
          const reached = days >= m.days;
          return (
            <View
              key={m.days}
              className="items-center gap-1 rounded-xl px-2 py-1.5"
              style={{ backgroundColor: reached ? alpha(tint, 0.14) : 'transparent' }}
            >
              <Text
                variant="caption"
                className="font-sora-semibold"
                style={{ color: reached ? tint : undefined }}
              >
                {t(m.labelKey)}
              </Text>
            </View>
          );
        })}
      </View>

      {longestStreak > days ? (
        <Text variant="caption">{t('private.longestStreakNote', { count: longestStreak })}</Text>
      ) : null}
    </View>
  );
}
