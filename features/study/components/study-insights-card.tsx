import { Clock, Star, Sunrise, TrendingDown, TrendingUp } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { formatStudyDuration, timeOfDayLabelKey } from '@/features/study/services/study-stats';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import type { StudyInsights } from '@/features/study/types/study.types';

const STUDY_TINT = '#8b5cf6';

/** A 2×2 grid of "how to improve" signals: when you focus best, typical
 * session length, focus quality, and momentum vs last week. */
export function StudyInsightsCard({ insights }: { insights: StudyInsights }) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const wow = insights.weekOverWeek;
  const wowUp = wow != null && wow >= 0;

  const tiles = [
    {
      key: 'best',
      icon: Sunrise,
      tint: '#f59e0b',
      label: t('study.youFocusBestIn'),
      value: insights.bestTimeOfDay ? t(timeOfDayLabelKey(insights.bestTimeOfDay)) : '—',
    },
    {
      key: 'avg',
      icon: Clock,
      tint: STUDY_TINT,
      label: t('study.typicalSession'),
      value: insights.avgSessionSeconds > 0 ? formatStudyDuration(insights.avgSessionSeconds) : '—',
    },
    {
      key: 'focus',
      icon: Star,
      tint: '#eab308',
      label: t('study.avgFocus'),
      value:
        insights.avgFocusRating != null
          ? `${insights.avgFocusRating.toFixed(1)}★`
          : t('study.rateSessions'),
    },
    {
      key: 'wow',
      icon: wowUp ? TrendingUp : TrendingDown,
      tint:
        wow == null
          ? colors[scheme].mutedForeground
          : wowUp
            ? colors[scheme].success
            : colors[scheme].destructive,
      label: t('study.vsLastWeek'),
      value: wow == null ? t('study.new') : `${wowUp ? '+' : ''}${Math.round(wow * 100)}%`,
    },
  ];

  return (
    <View className={cardClass({ padding: 'md' }, 'gap-3')}>
      <Text variant="subheading">{t('study.insights')}</Text>
      <View className="flex-row flex-wrap gap-2.5">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <View
              key={tile.key}
              className="gap-1.5 rounded-2xl bg-muted p-3"
              style={{ width: '48%' }}
            >
              <View
                className="h-8 w-8 items-center justify-center rounded-lg"
                style={{ backgroundColor: alpha(tile.tint, 0.16) }}
              >
                <Icon size={16} color={tile.tint} />
              </View>
              <Text className="font-sora-bold text-foreground" numberOfLines={1}>
                {tile.value}
              </Text>
              <Text variant="caption" numberOfLines={1}>
                {tile.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
