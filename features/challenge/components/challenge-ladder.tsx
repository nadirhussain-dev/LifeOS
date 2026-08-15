import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { ChallengeTier } from '@/features/challenge/types/challenge.types';
import { useTheme } from '@/hooks/use-theme';

/**
 * The rungs, with a rail running through them.
 *
 * The rail is not decoration — it is the one structural device that says these
 * are ordered and that you are somewhere along them. Climbed rungs light it;
 * the next one is filled and haloed; everything beyond is hollow.
 *
 * The label always quotes the *next* rung rather than the last one, because a
 * target a year away exerts no pull and the whole reason the ladder exists is
 * that there is always a nearer number to give somebody.
 */

type Props = {
  tiers: ChallengeTier[];
  qualifiedDays: number;
};

export function ChallengeLadder({ tiers, qualifiedDays }: Props) {
  const { t } = useTranslation();
  const { c } = useTheme();

  const ordered = [...tiers].sort((a, b) => a.dayThreshold - b.dayThreshold);
  const nextIndex = ordered.findIndex((tier) => tier.dayThreshold > qualifiedDays);

  return (
    <View className={cardClass({ padding: 'md' }, 'gap-1')}>
      <Text variant="micro" className="pb-2">
        {t('challenge.ladderTitle')}
      </Text>

      {ordered.map((tier, index) => {
        const climbed = tier.dayThreshold <= qualifiedDays;
        const isNext = index === nextIndex;
        const isLast = index === ordered.length - 1;

        return (
          <View key={tier.dayThreshold} className="flex-row gap-3">
            <Text
              className="w-10 pt-1 text-right font-sora-semibold"
              style={{ color: climbed ? c.accent : c.subtleForeground }}
            >
              {tier.dayThreshold}
            </Text>

            {/* The rail. Its colour is the progress bar — no separate one. */}
            <View className="w-3 items-center">
              <View
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  marginTop: 6,
                  backgroundColor: climbed || isNext ? c.accent : c.surface,
                  borderWidth: climbed || isNext ? 0 : 1.5,
                  borderColor: c.border,
                }}
              />
              {!isLast && (
                <View
                  className="w-0.5 flex-1"
                  style={{ backgroundColor: climbed ? c.accent : c.border }}
                />
              )}
            </View>

            <View className="flex-1 pb-4">
              <Text
                className="font-sora-semibold"
                style={{ color: climbed || isNext ? c.foreground : c.mutedForeground }}
              >
                {tier.name}
              </Text>
              {tier.rewardTitle ? <Text variant="caption">{tier.rewardTitle}</Text> : null}
              {isNext ? (
                <Text variant="caption" style={{ color: c.accent }}>
                  {t('challenge.toNextRung', {
                    count: tier.dayThreshold - qualifiedDays,
                    name: tier.name,
                  })}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}

      {nextIndex === -1 ? <Text variant="caption">{t('challenge.finalRung')}</Text> : null}
    </View>
  );
}
