import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { formatDate } from '@/lib/date-format';
import { HeroCard } from '@/components/ui/hero-card';
import { CalendarClock, CheckCircle2, Target } from '@/components/ui/icons';
import { ProgressRing } from '@/components/ui/progress-ring';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { formatProgressPercent } from '@/features/goals/services/goal-format';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

type Props = {
  activeCount: number;
  completedCount: number;
  avgProgress: number;
  nextDue: number | null;
};

const WHITE = '#ffffff';

export function GoalsStatsHeader({ activeCount, completedCount, avgProgress, nextDue }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const rows = [
    { icon: Target, text: t('goals.activeGoals', { count: activeCount }) },
    { icon: CheckCircle2, text: t('goals.completedCount', { count: completedCount }) },
    {
      icon: CalendarClock,
      text: nextDue
        ? t('goals.nextDue', { date: formatDate(nextDue, 'dayMonth') })
        : t('goals.noDeadlines'),
    },
  ];

  return (
    <HeroCard tint={moduleTint('goals', scheme)}>
      <View className="flex-row items-center gap-5">
        <ProgressRing
          progress={avgProgress}
          size={104}
          strokeWidth={10}
          color={WHITE}
          trackColor={alpha(WHITE, 0.25)}
        >
          <View className="items-center">
            <Text
              className="font-sora-extrabold text-xl"
              style={{ color: WHITE, fontVariant: ['tabular-nums'] }}
            >
              {formatProgressPercent(avgProgress)}
            </Text>
            <Text style={{ color: alpha(WHITE, 0.8), fontSize: 11 }}>{t('goals.avg')}</Text>
          </View>
        </ProgressRing>

        <View className="flex-1 gap-2.5">
          {rows.map((row) => {
            const Icon = row.icon;
            return (
              <View key={row.text} className="flex-row items-center gap-2">
                <Icon size={15} color={WHITE} />
                <Text className="font-sora-medium" style={{ color: WHITE }}>
                  {row.text}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </HeroCard>
  );
}
