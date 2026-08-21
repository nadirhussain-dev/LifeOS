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
  /**
   * Days left in this run, counting today. Null when the season has no end
   * configured, which must read as "no deadline" and not as zero.
   *
   * The ladder used to quote "60 days to Forge" without knowing whether sixty
   * days existed — under a calendar season a late joiner was being offered
   * rungs that could not be reached at any rate of effort. 0070 gives every run
   * its own full-length window, so the target is now always real; this says how
   * much of it is left, which is the part that creates urgency.
   */
  daysLeft?: number | null;
};

export function ChallengeLadder({ tiers, qualifiedDays, daysLeft }: Props) {
  const { t } = useTranslation();
  const { c } = useTheme();

  const ordered = [...tiers].sort((a, b) => a.dayThreshold - b.dayThreshold);
  const nextIndex = ordered.findIndex((tier) => tier.dayThreshold > qualifiedDays);

  return (
    <View className={cardClass({ padding: 'md' }, 'gap-1')}>
      <View className="flex-row items-baseline justify-between pb-2">
        <Text variant="micro">{t('challenge.ladderTitle')}</Text>
        {typeof daysLeft === 'number' ? (
          <Text variant="micro">{t('challenge.daysLeftInRun', { count: daysLeft })}</Text>
        ) : null}
      </View>

      {ordered.map((tier, index) => {
        const climbed = tier.dayThreshold <= qualifiedDays;
        const isNext = index === nextIndex;
        const isLast = index === ordered.length - 1;

        return (
          <View key={tier.dayThreshold} className="flex-row gap-3">
            <Text
              className="w-10 pt-1 text-right font-sora-semibold"
              // Muted rather than subtle for the unclimbed rungs: a ladder
              // exists to show what is still ahead, so those numbers are meant
              // to be read, not merely to look switched off.
              style={{ color: climbed ? c.accent : c.mutedForeground }}
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
