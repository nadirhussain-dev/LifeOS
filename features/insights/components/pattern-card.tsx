import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import {
  INSIGHT_MODULE_ICON,
  INSIGHT_MODULE_TOKEN,
  INSIGHT_SENTENCE_KEY,
} from '@/features/insights/config/insight-copy';
import type { InsightCandidate } from '@/features/insights/types/insights.types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

type Props = {
  candidate: InsightCandidate;
};

/** A smaller, more specific observation than the hero — one row per candidate
 *  that cleared the engine's bar but wasn't the strongest. Left-striped in the
 *  first module's tint so a scroll down the list reads as "which two areas of
 *  your life is this about" before the sentence is even read. */
export function PatternCard({ candidate }: Props) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const [primaryModule] = candidate.modules;
  const Icon = INSIGHT_MODULE_ICON[primaryModule];
  const tint = moduleTint(INSIGHT_MODULE_TOKEN[primaryModule], scheme);

  return (
    <View
      className={cardClass({ padding: 'row' }, 'flex-row items-start gap-2.5')}
      style={{ borderLeftWidth: 3, borderLeftColor: tint }}
    >
      <View
        className="h-7 w-7 items-center justify-center rounded-lg"
        style={{ backgroundColor: alpha(tint, 0.15) }}
      >
        <Icon size={15} color={tint} strokeWidth={2.2} />
      </View>
      <Text className="flex-1 text-sm leading-5 text-foreground">
        {t(INSIGHT_SENTENCE_KEY[candidate.key], candidate.params)}
      </Text>
    </View>
  );
}
