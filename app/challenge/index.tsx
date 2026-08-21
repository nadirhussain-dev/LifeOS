import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { Braid } from '@/features/challenge/components/braid';
import { DemotionSheet } from '@/features/challenge/components/demotion-sheet';
import { scheduleWinBack } from '@/features/challenge/services/challenge-reminders';
import { ShareButton, ShareCard } from '@/features/challenge/components/share-card';
import { ShieldSlots } from '@/features/challenge/components/shield-slots';
import { TodayChecklist } from '@/features/challenge/components/today-checklist';
import { SeasonNotice } from '@/features/challenge/components/season-notice';
import { SeasonSummary } from '@/features/challenge/components/season-summary';
import {
  useChallengeChain,
  useChallengeChecklist,
  useChallengeEvents,
  useChallengeRank,
  useChallengeTiers,
  useChallengeToday,
  useSeasonStatus,
} from '@/features/challenge/hooks/use-challenge';
import { celebrationsFor } from '@/features/challenge/services/celebrations';
import { nextTier } from '@/features/challenge/services/challenge-math';
import { canJoin } from '@/features/challenge/services/season-state';
import { currentDay, useChallengeStore } from '@/features/challenge/store/challenge-store';
import { useTheme } from '@/hooks/use-theme';
import { toast } from '@/lib/toast-store';

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
  const season = useSeasonStatus();
  const checklist = useChallengeChecklist();
  const chain = useChallengeChain(today.data?.seasonId);
  const rank = useChallengeRank();
  const finishedRun = today.data?.finishedRun ?? null;
  /*
   * The live run's season, or the finished one's when there is no live run.
   * Keyed off `seasonId` alone, this query switched itself off the moment a run
   * ended — taking the whole timeline with it, and the demotion sheet and the
   * celebrations below, which all read from it.
   */
  const events = useChallengeEvents(today.data?.seasonId ?? finishedRun?.seasonId);

  const lastSeenEventId = useChallengeStore((s) => s.lastSeenEventId);
  const lastClosedDay = useChallengeStore((s) => s.lastClosedDay);
  const markEventsSeen = useChallengeStore((s) => s.markEventsSeen);
  const [dismissed, setDismissed] = useState(false);

  const enrolled = today.data?.enrolled === true;
  const qualifiedDays = today.data?.qualifiedDays ?? 0;
  const status = season.data ?? { state: 'none' as const };
  // The ladder of the run being drawn, which is not necessarily the season on
  // offer — see `useChallengeTiers`. Falls back to the joinable season's ladder
  // for the not-enrolled case, where there is no run yet to belong to.
  const runSeasonId = today.data?.seasonId ?? finishedRun?.seasonId ?? status.seasonId;
  const seasonTiers = useChallengeTiers(runSeasonId);
  // Memoised because the `??` chain builds a fresh array on every render, and
  // the win-back effect below depends on it — without this it would re-arm the
  // notification on every re-render rather than once per demotion.
  const tiers = useMemo(
    () => seasonTiers.data ?? status.tiers ?? [],
    [seasonTiers.data, status.tiers],
  );
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

  /**
   * Queues the win-back when a fall is first seen.
   *
   * Keyed off the same unseen event the sheet is, so it is armed exactly once
   * per demotion — `markEventsSeen` moves the watermark on acknowledgement, and
   * the effect does not run again for that event. Scheduled on sight rather
   * than on dismissal, because closing the sheet is not the moment that matters
   * and somebody who force-quits on it should still hear from us.
   *
   * It cancels itself the moment another day completes
   * (`syncChallengeReminder`), so carrying straight on means never receiving
   * it.
   */
  useEffect(() => {
    if (!unseenDemotion) return;
    const toDays = Number(unseenDemotion.detail.toDays ?? 0);
    const next = nextTier(tiers, toDays);
    void scheduleWinBack(toDays, next ? next.dayThreshold - toDays : null);
  }, [unseenDemotion, tiers]);

  /**
   * Says the things the engine has always recorded and the app has never read.
   *
   * `challenge_credit_day` writes `tier_reached`, `shield_earned` and
   * `completed` on the very call that earns them, and until now progress simply
   * appeared in a number on the next refetch — earning a rung after ninety days
   * was silent. `celebrationsFor` stops the walk at an unseen fall so the sheet
   * below still finds it; see the note there for why the watermark is shared.
   *
   * Toasts rather than a sheet: a rung is worth marking, and a modal in front
   * of somebody who opened this screen to tick today's boxes is worth less than
   * the tick.
   */
  const celebrations = useMemo(
    () => celebrationsFor(events.data ?? [], lastSeenEventId),
    [events.data, lastSeenEventId],
  );

  useEffect(() => {
    if (celebrations.show.length === 0) return;
    for (const event of celebrations.show) {
      const rung = tiers.find((tier) => tier.dayThreshold === Number(event.detail.dayThreshold));
      switch (event.kind) {
        case 'tier_reached':
          toast.success(
            t('challenge.celebrateTier', {
              name: rung?.name ?? String(event.detail.dayThreshold ?? ''),
            }),
          );
          break;
        case 'shield_earned':
          toast.success(t('challenge.celebrateShield'));
          break;
        case 'completed':
          toast.success(t('challenge.celebrateCompleted'));
          break;
        case 'season_ended':
          toast.info(t('challenge.celebrateSeasonEnded'));
          break;
      }
    }
    markEventsSeen(celebrations.watermark);
  }, [celebrations, tiers, t, markEventsSeen]);

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
      const joinable = canJoin(status.state);
      return (
        <View className="gap-4">
          {/*
            What the last run came to, above the invitation to start another.

            Both, and in this order. The screen used to show only the second —
            finishing a season and never having played produced the same card —
            and putting the summary underneath would make the app's first
            response to a completed streak be "start a run".
          */}
          {finishedRun ? <SeasonSummary run={finishedRun} tiers={tiers} /> : null}

          <View className={cardClass({ padding: 'md' }, 'gap-3')}>
            <Text variant="subheading">{t('challenge.notEnrolledTitle')}</Text>
            <Text variant="muted">{t('challenge.notEnrolledBody')}</Text>

            {/*
            The state, named and dated, rather than one blanket sentence.

            This card used to collapse six different situations into "No season
            is open right now" — a season starting on Tuesday, one that ended
            last week, a full one, and one an operator had not finished setting
            up all read identically, so nobody could tell "wait two days" from
            "this is broken". `SeasonNotice` says which season, which state, and
            when; the button below then says what to do about it.
          */}
            <View className="rounded-2xl border border-border p-3">
              <SeasonNotice status={status} />
            </View>

            {/*
            Every state ends in something to press. This screen once explained
            the requirement and then stopped: a signed-out visitor read
            "joining a run needs an account" under a heading saying they were
            not in one, with no way to make an account anywhere on the screen.
            Being told what you need is only useful next to the way to get it.
          */}
            {!session ? (
              <>
                <Text variant="caption">{t('challenge.signInBody')}</Text>
                <Button
                  label={t('sync.signInCreate')}
                  onPress={() => router.push('/(auth)/login')}
                />
              </>
            ) : joinable ? (
              <Button
                label={t('challenge.startRun')}
                onPress={() => router.push('/challenge/join')}
              />
            ) : (
              // Nothing in the remaining states is the user's to fix, so the only
              // honest action is to ask again. Without it the screen is frozen on
              // an answer that was true when it loaded and cannot update — and
              // these are exactly the answers an operator changes from the
              // console while somebody is looking at them.
              <Button
                label={season.isFetching ? t('common.loadingEllipsis') : t('challenge.checkAgain')}
                variant="secondary"
                disabled={season.isFetching}
                onPress={() => {
                  void season.refetch();
                  void today.refetch();
                }}
              />
            )}
          </View>
        </View>
      );
    }

    return (
      <View className="gap-3">
        {/*
          Why today is not counting, when it is not counting.

          The single worst thing this feature could do to somebody is take a
          day's work and say nothing, and until now that was exactly what a
          paused or finished season did: `record_challenge_day` refused every
          submission with a reason the client had no field for, so the checklist
          rendered an ordinary unfinished day and went on doing so forever.

          Above the checklist rather than below it, because it changes what the
          checklist means — read afterwards it is an explanation, read first it
          is a warning.
        */}
        {checklist.blockedBy ? (
          <View
            className={cardClass({ padding: 'md' }, 'gap-1')}
            style={{ borderColor: c.warning, borderWidth: 1 }}
          >
            <SeasonNotice
              status={{
                // The run's own season, not the one on offer — an enrolled user
                // is being told about the season they are in.
                state: checklist.blockedBy,
                name: today.data?.seasonName,
                endsAt: today.data?.seasonEndsAt,
              }}
            />
            <Text variant="caption">{t('challenge.progressSafe')}</Text>
          </View>
        ) : null}

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

        <Braid
          days={chain.data ?? []}
          modules={today.data?.required ?? []}
          justClosed={lastClosedDay === currentDay() && checklist.outstanding.length === 0}
        />

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

        {/* `mutedForeground`, not `subtleForeground`: this is prose, and the
            subtle token is sized for inactive indicators — 4.2:1 in dark and
            2.4:1 in light, both under the 4.5:1 that body text needs. */}
        <Text variant="caption" style={{ color: c.mutedForeground }}>
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
