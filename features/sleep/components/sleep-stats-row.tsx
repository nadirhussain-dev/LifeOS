import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Flame, Moon, Trophy, Waves } from '@/components/ui/icons';
import { StatTile } from '@/components/ui/stat-tile';
import { formatDuration } from '@/features/sleep/services/sleep-stats';
import type { SleepStats } from '@/features/sleep/types/sleep.types';
import { contentTints } from '@/constants/design-tokens';
import { useTheme } from '@/hooks/use-theme';

export function SleepStatsRow({ stats }: { stats: SleepStats }) {
  const { tint, resolve } = useTheme();
  const { t } = useTranslation();
  const tiles = [
    {
      icon: Moon,
      label: t('sleep.avgPerNight'),
      value: formatDuration(stats.avgDurationMinutes),
      tint: tint('sleep'),
    },
    {
      icon: Flame,
      label: t('sleep.streak'),
      value: `${stats.currentStreak}`,
      tint: resolve(contentTints.orange),
    },
    {
      icon: Trophy,
      label: t('sleep.best'),
      value: `${stats.bestStreak}`,
      tint: resolve(contentTints.yellow),
    },
    {
      icon: Waves,
      label: t('sleep.consistency'),
      value: `${Math.round(stats.consistency * 100)}%`,
      tint: resolve(contentTints.green),
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
