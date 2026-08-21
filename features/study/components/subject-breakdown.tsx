import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ProgressBar } from '@/components/ui/progress-bar';
import { Text } from '@/components/ui/text';
import { moduleTints, resolveTint } from '@/constants/design-tokens';
import { useTheme } from '@/hooks/use-theme';
import { formatStudyDuration } from '@/features/study/services/study-stats';
import type { SubjectBreakdown as Breakdown } from '@/features/study/types/study.types';

/* The fallback bar for a subject with no colour of its own. Named NEUTRAL but
 * it is the Study tint — and it had been pinned to `#8b5cf6`, which is Study's
 * DARK value and Journal's LIGHT one, so on light theme these bars wore
 * Journal's violet. */
const NEUTRAL = moduleTints.study;

/** Proportional split of study time by subject over the window. Bars are
 * normalized to the largest subject so the leader always fills the track. */
export function SubjectBreakdownList({ breakdown }: { breakdown: Breakdown[] }) {
  const { t } = useTranslation();
  const { scheme } = useTheme();
  const max = breakdown.reduce((m, b) => Math.max(m, b.seconds), 0) || 1;

  return (
    <View className="gap-3">
      {breakdown.map((entry, index) => {
        // `colorToken` is the subject's own hex; only the fallback is a pair.
        const color = entry.subject?.colorToken ?? resolveTint(NEUTRAL, scheme);
        return (
          <View key={entry.subject?.id ?? `general-${index}`} className="gap-1.5">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                <Text className="font-sora-medium text-foreground">
                  {entry.subject?.name ?? t('study.general')}
                </Text>
              </View>
              <Text variant="caption">{formatStudyDuration(entry.seconds)}</Text>
            </View>
            <ProgressBar progress={entry.seconds / max} color={color} height={6} />
          </View>
        );
      })}
    </View>
  );
}
