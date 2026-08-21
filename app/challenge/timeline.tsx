import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import {
  useChallengeEvents,
  useChallengeToday,
  type ChallengeEvent,
} from '@/features/challenge/hooks/use-challenge';
import { useTheme } from '@/hooks/use-theme';

/**
 * Every rung, shield and fall, dated.
 *
 * This is the screen that stops support arguments before they start. "Why is my
 * count lower than last week" has exactly one good answer — the row that says
 * what happened and when — and without it the only answers available are a
 * guess and an apology.
 *
 * Rendered straight from `challenge_events`, which the server writes as it goes.
 * Nothing here is derived on the client, deliberately: a timeline reconstructed
 * from counters would agree with the counters by construction, which is precisely
 * the disagreement somebody would be here to investigate.
 */
export default function ChallengeTimelineScreen() {
  const { t } = useTranslation();
  const { c, tint } = useTheme();

  const today = useChallengeToday();
  const events = useChallengeEvents(today.data?.seasonId);

  const describe = (event: ChallengeEvent): string => {
    const detail = event.detail;
    switch (event.kind) {
      case 'enrolled':
        return t('challenge.eventEnrolled');
      case 'tier_reached':
        return t('challenge.eventTierReached', { name: String(detail.dayThreshold ?? '') });
      case 'shield_earned':
        return t('challenge.eventShieldEarned');
      case 'shield_spent':
        return t('challenge.eventShieldSpent');
      case 'demoted':
        return t('challenge.eventDemoted', {
          from: String(detail.fromDays ?? ''),
          to: String(detail.toDays ?? ''),
        });
      case 'module_swapped':
        return t('challenge.eventModuleSwapped', {
          out: t(`syncModule.${String(detail.out ?? '')}`),
          in: t(`syncModule.${String(detail.in ?? '')}`),
        });
      case 'completed':
        return t('challenge.eventCompleted');
      // Written by the maintenance cron rather than by anything the user did
      // (0069). Without a case it fell to the default and rendered the raw
      // `season_ended` string.
      case 'season_ended':
        return t('challenge.eventSeasonEnded');
      case 'admin_shield_granted':
        return t('challenge.eventAdminShield');
      case 'admin_days_restored':
        return t('challenge.eventAdminDays');
      default:
        return event.kind;
    }
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('challenge.timelineTitle')}
        eyebrow={t('challenge.eyebrow')}
        tint={tint('habit')}
      />

      <ScrollView
        contentContainerClassName="gap-3 px-5 pt-3 pb-10"
        showsVerticalScrollIndicator={false}
      >
        {events.isError ? (
          <QueryError onRetry={() => void events.refetch()} />
        ) : (events.data ?? []).length === 0 ? (
          <Text variant="muted">{t('challenge.timelineEmpty')}</Text>
        ) : (
          <View className={cardClass({ padding: 'none' }, 'px-4')}>
            {(events.data ?? []).map((event, index) => (
              <View
                key={event.id}
                className="gap-0.5 py-3"
                style={index > 0 ? { borderTopWidth: 1, borderTopColor: c.border } : undefined}
              >
                <Text
                  className="font-sora-medium"
                  style={{
                    color: event.kind === 'demoted' ? c.warning : c.foreground,
                  }}
                >
                  {describe(event)}
                </Text>
                <Text variant="caption">{format(new Date(event.createdAt), 'd MMM yyyy')}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
