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
import type { InsightCandidate, InsightsStatus } from '@/features/insights/types/insights.types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

type Props = {
  status: InsightsStatus;
  headline: InsightCandidate | null;
  rangeDays: number;
};

/** The screen's single strongest claim, stated as a plain sentence rather
 *  than a chart the reader has to interpret — see insight-engine.ts for how
 *  it's chosen. Falls back to an honest "not yet" state instead of a fake
 *  claim when the data doesn't clear the engine's bar yet. */
export function InsightHeroCard({ status, headline, rangeDays }: Props) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';

  if (status !== 'ready' || !headline) {
    return (
      <View className={cardClass({ padding: 'lg', elevation: 'e2' }, 'gap-1.5')}>
        <Text variant="subheading">
          {status === 'no_pattern_yet'
            ? t('insights.noPatternTitle')
            : t('insights.insufficientTitle')}
        </Text>
        <Text variant="muted">
          {status === 'no_pattern_yet'
            ? t('insights.noPatternBody')
            : t('insights.insufficientBody')}
        </Text>
      </View>
    );
  }

  const [primaryModule, secondaryModule] = headline.modules;
  const PrimaryIcon = INSIGHT_MODULE_ICON[primaryModule];
  const SecondaryIcon = INSIGHT_MODULE_ICON[secondaryModule];
  const primaryTint = moduleTint(INSIGHT_MODULE_TOKEN[primaryModule], scheme);
  const secondaryTint = moduleTint(INSIGHT_MODULE_TOKEN[secondaryModule], scheme);

  return (
    <View className={cardClass({ padding: 'lg', elevation: 'e2' }, 'gap-3')}>
      <View className="flex-row">
        <View
          className="h-9 w-9 items-center justify-center rounded-full border-2 border-card"
          style={{ backgroundColor: alpha(primaryTint, 0.15) }}
        >
          <PrimaryIcon size={17} color={primaryTint} strokeWidth={2.2} />
        </View>
        <View
          className="-ml-2.5 h-9 w-9 items-center justify-center rounded-full border-2 border-card"
          style={{ backgroundColor: alpha(secondaryTint, 0.15) }}
        >
          <SecondaryIcon size={17} color={secondaryTint} strokeWidth={2.2} />
        </View>
      </View>

      <Text className="font-sora-bold text-lg leading-6 text-foreground">
        {t(INSIGHT_SENTENCE_KEY[headline.key], headline.params)}
      </Text>

      <Text variant="caption">{t('insights.basedOnDays', { count: rangeDays })}</Text>
    </View>
  );
}
