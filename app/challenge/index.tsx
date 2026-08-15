import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { ProgressRing } from '@/components/ui/progress-ring';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { ChallengeLadder } from '@/features/challenge/components/challenge-ladder';
import { DayChain } from '@/features/challenge/components/day-chain';
import { DemotionSheet } from '@/features/challenge/components/demotion-sheet';
import { ModuleChains } from '@/features/challenge/components/module-chains';
import { ShareButton, ShareCard } from '@/features/challenge/components/share-card';
import { ShieldSlots } from '@/features/challenge/components/shield-slots';
import { TodayChecklist } from '@/features/challenge/components/today-checklist';
import {
  useChallengeChain,
  useChallengeChecklist,
  useChallengeEvents,
  useChallengeRank,
  useChallengeToday,
  useOpenSeason,
} from '@/features/challenge/hooks/use-challenge';
import { nextTier } from '@/features/challenge/services/challenge-math';
import { useChallengeStore } from '@/features/challenge/store/challenge-store';
import { useTheme } from '@/hooks/use-theme';

/**
 * The challenge, on one screen.
 *
 * Order is the design here, and it is the order to cut from the bottom if this
 * ever has to be trimmed: the checklist is what people come back for daily, the
 * shields are what they protect, the ring and ladder are what they are climbing
 * toward, and the chains are the record. The rank line sits with the ring
 * because it is the same kind of fact — where you are — and it is the only one
 * that reframes a long solitary climb as a contest somebody is winning.
 *
 * **No `AdSlot` here, deliberately, and never.** Ads live on the ordinary
 * module screens. An ad rendered beside a streak is what creates the appearance
 * that the reward is paid for by impressions, which is precisely the thing that
 * would put the ad account at risk — see the header of
 * supabase/migrations/0048_streak_challenge.sql.
 */
export default function ChallengeScreen() {
  const { t } = useTranslation();
  const { c, tint } = useTheme();
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const shareTarget = useRef<View>(null);

  const today = useChallengeToday();
  const season = useOpenSeason();
  const checklist = useChallengeChecklist();
  const chain = useChallengeChain(today.data?.seasonId);
  const rank = useChallengeRank();
  const events = useChallengeEvents(today.data?.seasonId);

  const lastSeenEventId = useChallengeStore((s) => s.lastSeenEventId);
  const markEventsSeen = useChallengeStore((s) => s.markEventsSeen);
  const [dismissed, setDismissed] = useState(false);

  const enrolled = today.data?.enrolled === true;
  const qualifiedDays = today.data?.qualifiedDays ?? 0;
  const tiers = season.data?.tiers ?? [];
  const next = nextTier(tiers, qualifiedDays);

  /**
   * The most recent fall the user has not been shown.
   *
   * Found by walking the event log rather than by comparing counters, because
   * the counters only say where somebody is now — the log is the only thing
   * that says they used to be somewhere else, and by how much.
   */
  const unseenDemotion = (events.data ?? []).find(
    (event) => event.kind === 'demoted' && event.id > lastSeenEventId,
  );

  const acknowledge = () => {
    if (unseenDemotion) markEventsSeen(unseenDemotion.id);
    setDismissed(true);
  };

  const body = () => {
    if (today.isError || season.isError) {
      return (
        <QueryError
          onRetry={() => {
            void today.refetch();
            void season.refetch();
          }}
        />
      );
    }

    if (today.isLoading || season.isLoading) {
      return (
        <View className="gap-3">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </View>
      );
    }

    if (!enrolled) {
      return (
        <View className={cardClass({ padding: 'md' }, 'gap-3')}>
          <Text variant="subheading">{t('challenge.notEnrolledTitle')}</Text>
          <Text variant="muted">{t('challenge.notEnrolledBody')}</Text>
          {!session ? (
            <Text variant="caption">{t('challenge.signInBody')}</Text>
          ) : season.data === null ? (
            <Text variant="caption">{t('challenge.noSeasonBody')}</Text>
          ) : (
            <Button
              label={t('challenge.startRun')}
              onPress={() => router.push('/challenge/join')}
            />
          )}
        </View>
      );
    }

    return (
      <View className="gap-3">
        <TodayChecklist
          items={checklist.items}
          qualified={checklist.qualified}
          awaitingServer={checklist.awaitingServer}
          dayNumber={qualifiedDays}
        />

        <ShieldSlots
          shields={today.data?.shields ?? 0}
          cap={season.data?.shieldCap ?? 3}
          perfectRun={today.data?.perfectRun ?? 0}
          shieldEarnDays={today.data?.shieldEarnDays ?? 30}
        />

        {/* Where they are. The ring fills toward the NEXT rung rather than the
            final one — a bar that barely moves for a year is a bar that says
            "give up" once a week. */}
        <View className={cardClass({ padding: 'md' }, 'flex-row items-center gap-4')}>
          <ProgressRing
            progress={next ? Math.min(qualifiedDays / next.dayThreshold, 1) : 1}
            size={78}
            color={tint('habit')}
          >
            <Text className="font-sora-semibold text-foreground">{qualifiedDays}</Text>
          </ProgressRing>

          <View className="flex-1 gap-1">
            <Text className="font-sora-semibold text-foreground">
              {next
                ? t('challenge.toNextRung', {
                    count: next.dayThreshold - qualifiedDays,
                    name: next.name,
                  })
                : t('challenge.finalRung')}
            </Text>
            <Text variant="caption">
              {t('challenge.perfectRun', { count: today.data?.perfectRun ?? 0 })}
            </Text>
            {rank.data?.ranked && rank.data.topPercent !== undefined ? (
              <Text variant="caption" style={{ color: tint('habit') }}>
                {t('challenge.rankLine', { percent: rank.data.topPercent })}
              </Text>
            ) : null}
          </View>
        </View>

        <ChallengeLadder tiers={tiers} qualifiedDays={qualifiedDays} />

        <DayChain days={chain.data ?? []} />

        <ModuleChains days={chain.data ?? []} modules={today.data?.required ?? []} />

        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button
              label={t('challenge.timelineOpen')}
              variant="secondary"
              onPress={() => router.push('/challenge/timeline')}
            />
          </View>
          <View className="flex-1">
            <ShareButton target={shareTarget} />
          </View>
        </View>

        <Pressable accessibilityRole="button" onPress={() => router.push('/challenge/swap')}>
          <Text variant="caption" style={{ color: c.accent }}>
            {t('challenge.swapOpen')}
          </Text>
        </Pressable>

        <Text variant="caption" style={{ color: c.subtleForeground }}>
          {t('challenge.shieldsBody')}
        </Text>

        {/* Off-layout, purely to be captured. `position: absolute` with a large
            negative offset rather than `display: none`, which would render
            nothing for view-shot to photograph. */}
        <View className="absolute" style={{ left: -10000, top: 0 }} pointerEvents="none">
          <ShareCard ref={shareTarget} days={chain.data ?? []} qualifiedDays={qualifiedDays} />
        </View>
      </View>
    );
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('challenge.title')}
        eyebrow={t('challenge.eyebrow')}
        tint={tint('habit')}
      />
      <ScrollView
        contentContainerClassName="gap-3 px-5 pt-3 pb-10"
        showsVerticalScrollIndicator={false}
      >
        {body()}
      </ScrollView>

      <DemotionSheet
        visible={Boolean(unseenDemotion) && !dismissed}
        fromDays={Number(unseenDemotion?.detail.fromDays ?? 0)}
        toDays={Number(unseenDemotion?.detail.toDays ?? 0)}
        tiers={tiers}
        onDismiss={acknowledge}
      />
    </View>
  );
}
