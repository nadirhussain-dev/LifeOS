import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { CalendarRange, Clock, Flame, Sigma } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { formatStudyDuration } from '@/features/study/services/study-stats';
import type { StudyStats } from '@/features/study/types/study.types';
import { useTheme } from '@/hooks/use-theme';

export function StudyStatsRow({ stats }: { stats: StudyStats }) {
  const { tint } = useTheme();
  const { t } = useTranslation();
  const tiles = [
    {
      icon: CalendarRange,
      label: t('study.thisWeek'),
      value: formatStudyDuration(stats.weekSeconds),
      tint: tint('study'),
    },
    {
      icon: Flame,
      label: t('study.streak'),
      value: t('study.streakDays', { count: stats.currentStreak }),
      tint: '#f97316',
    },
    { icon: Clock, label: t('study.sessions'), value: `${stats.sessionCount}`, tint: '#0ea5e9' },
    {
      icon: Sigma,
      label: t('study.allTime'),
      value: formatStudyDuration(stats.totalSeconds),
      tint: '#22c55e',
    },
  ];

  return (
    <View className="flex-row gap-2.5">
      {tiles.map((tile, index) => (
        <StatTile
          key={tile.label}
          icon={tile.icon}
          value={tile.value}
          label={tile.label}
          tint={tile.tint}
          index={index}
        />
      ))}
    </View>
  );
}
