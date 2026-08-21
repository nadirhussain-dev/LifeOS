import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Trophy, CalendarCheck } from 'lucide-react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { ChallengeTier, FinishedRun } from '@/features/challenge/types/challenge.types';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';

/**
 * What a finished run came to.
 *
 * The programme had no such screen. `challenge_today()` returned
 * `{enrolled:false}` for anything not active, so reaching the top rung and
 * never having played produced the same card — "Start a run" — and the events
 * timeline went with it, because the client keys that query off the season id
 * the same call returns. Finishing a months-long streak read as a bug.
 *
 * Two headlines, not one. Reaching the top rung and running out of calendar are
 * different things that happen to a person, and a single "your season is over"
 * would flatten the one moment the whole ladder was built to produce.
 *
 * The rung is named, not numbered. `highestTierDay` is a day threshold, which
 * is the ledger's way of saying it; "Ember" is the user's. Falls back to the
 * number only when the ladder is not loaded, since a name is not worth blocking
 * the card for.
 */
type Props = {
  run: FinishedRun;
  tiers: ChallengeTier[];
};

export function SeasonSummary({ run, tiers }: Props) {
  const { t } = useTranslation();
  const { c } = useTheme();

  const completed = run.status === 'completed';
  const Icon = completed ? Trophy : CalendarCheck;

  /**
   * The furthest rung ever stood on, not the one it finished on.
   *
   * `highest_tier_day` never decreases — 0048 is explicit that a rung once
   * reached is never taken back — so it stays the honest answer for a run that
   * fell down the ladder in its last week. Quoting `tierDay` instead would
   * describe somebody's season by its worst fortnight.
   */
  const reached = tiers.find((tier) => tier.dayThreshold === run.highestTierDay);
  const rung = reached?.name ?? (run.highestTierDay > 0 ? String(run.highestTierDay) : null);

  return (
    <View className={cardClass({ padding: 'md' }, 'gap-3')}>
      <View className="flex-row items-center gap-3">
        <View
          className="h-11 w-11 items-center justify-center"
          style={{ borderRadius: 16, backgroundColor: alpha(c.accent, 0.14) }}
        >
          <Icon size={20} color={c.accent} />
        </View>
        <View className="flex-1">
          <Text variant="subheading">
            {completed
              ? t('challenge.summaryWonTitle', { name: run.seasonName ?? '' })
              : t('challenge.summaryEndedTitle', { name: run.seasonName ?? '' })}
          </Text>
          <Text variant="caption">
            {rung ? t('challenge.summaryReached', { name: rung }) : t('challenge.summaryNoRung')}
          </Text>
        </View>
      </View>

      <View className="flex-row gap-3">
        <Stat label={t('challenge.summaryDaysLabel')} value={String(run.qualifiedDays)} />
        <Stat label={t('challenge.summaryShieldsLabel')} value={String(run.shieldsEarned)} />
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  return (
    <View className="flex-1 gap-0.5">
      <Text className="font-sora-semibold text-2xl" style={{ color: c.foreground }}>
        {value}
      </Text>
      <Text variant="micro">{label}</Text>
    </View>
  );
}
