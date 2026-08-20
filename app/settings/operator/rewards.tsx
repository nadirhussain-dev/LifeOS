import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Switch, View } from 'react-native';

import { ListSkeleton } from '@/components/ui/list-skeleton';
import { cardClass } from '@/components/ui/card';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { REWARDS_MODULE_ID } from '@/features/challenge/config/rewards-flag';
import { SeasonNotice } from '@/features/challenge/components/season-notice';
import {
  operatorFix,
  windowLabel,
  type SeasonState,
} from '@/features/challenge/services/season-state';
import { listSeasons, type AdminSeason } from '@/features/operator/services/challenge-admin';
import { StateChip } from '@/app/settings/operator/seasons';
import { useModuleFlagsStore } from '@/features/module-flags/store/module-flags-store';
import { refreshModuleFlags } from '@/features/module-flags/services/module-flags';
import { setModuleEnabled } from '@/features/operator/services/operator-repository';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast-store';

/**
 * The challenge, from the operator's side.
 *
 * A view over the RPCs in migration 0049 and nothing else — every one of them
 * returns aggregates and none takes a user id, so this screen is structurally
 * incapable of showing whose streak is whose. That is the same line the rest of
 * the console draws: it needs to know how many, not who.
 *
 * Three read-outs, chosen because each one changes a decision:
 *   - the shield economy, which is the dial that actually gets tuned;
 *   - which module is costing people their days, which is the only place a
 *     badly-chosen eligible module would ever surface;
 *   - 30-day retention against a control, which is the number the whole
 *     programme is gated on — carrying its own caveat, because it has one.
 */

type Overview = {
  enrolled: number;
  active: number;
  completed: number;
  paying: number;
  atLeast30Days: number;
  atLeast90Days: number;
};

type ShieldTelemetry = {
  earned: number;
  held: number;
  spent: number;
  runsSavedAtLeastOnce: number;
  runs: number;
};

type Retention = {
  enrolledTotal: number;
  enrolledKept: number;
  controlTotal: number;
  controlKept: number;
};

const percent = (part: number, whole: number): string =>
  whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;

/**
 * Which season these figures describe.
 *
 * The screen used to take `order(created_at desc).limit(1)`, which answers a
 * question nobody asked. A season is created before it runs and outlives its
 * end date, so "newest row" silently reports on a season that has not started
 * — all zeros, correctly, for a season nobody could have enrolled in yet, next
 * to a switch reading "Challenge enabled". That is indistinguishable from the
 * programme being broken, and it is the reading that gets acted on.
 *
 * What it no longer does is decide *whether* a season is live. That judgement
 * used to be made here, from `enabled` and the two dates, while the app made it
 * from the module list — which is how the console came to show "Open" for a
 * season every user was correctly being told they could not join. The word now
 * comes from `challenge_season_state()` (0055) and this function only ranks it.
 *
 * @param rows newest-created first, each carrying the server's state
 */
const PRIORITY: SeasonState[] = ['open', 'full', 'notReady', 'upcoming', 'ended', 'closed', 'none'];

export function pickSeason(rows: AdminSeason[]): AdminSeason | null {
  if (rows.length === 0) return null;
  const ranked = [...rows].sort((a, b) => PRIORITY.indexOf(a.state) - PRIORITY.indexOf(b.state));
  // A stable sort leaves equal states in arrival order, which is newest-first —
  // so the fallback for "none of them is running" is still the one being worked
  // on, which is what an operator opening this screen is looking at.
  return ranked[0] ?? null;
}

export default function OperatorRewardsScreen() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const router = useRouter();

  const season = useQuery({
    // Shared with the season console, so opening one and coming back to the
    // other cannot show two different answers for the same row.
    queryKey: ['operator', 'challenge', 'seasons'],
    queryFn: listSeasons,
  });

  const current = season.data?.ok ? pickSeason(season.data.data) : null;
  const seasonId = current?.id;

  const stats = useQuery({
    queryKey: ['operator', 'challenge', 'stats', seasonId ?? null],
    enabled: Boolean(seasonId),
    queryFn: async () => {
      const [overview, shields, failures, retention] = await Promise.all([
        supabase.rpc('admin_challenge_overview', { p_season: seasonId }),
        supabase.rpc('admin_challenge_shield_telemetry', { p_season: seasonId }),
        supabase.rpc('admin_challenge_module_failures', { p_season: seasonId }),
        supabase.rpc('admin_challenge_retention', { p_season: seasonId }),
      ]);
      for (const result of [overview, shields, failures, retention]) {
        if (result.error) throw new Error(result.error.message);
      }
      return {
        overview: (overview.data ?? {}) as Overview,
        shields: (shields.data ?? {}) as ShieldTelemetry,
        failures: (failures.data ?? []) as { module_id: string; failed_days: number }[],
        retention: (retention.data ?? {}) as Retention,
      };
    },
  });

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('operator.rewardsTitle')}
        eyebrow={t('operator.eyebrow')}
        tint={c.error}
      />

      <ScrollView
        contentContainerClassName="gap-6 px-5 pt-3 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <RewardsSwitch />

        {/* The way in to everything a season is made of. Above the figures on
            purpose: when the numbers are all zero the reason is almost always
            something on that screen, and an operator should not have to already
            know that to find it. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/settings/operator/seasons')}
          className={cardClass({ padding: 'rowLg' }, 'flex-row items-center gap-3')}
        >
          <View className="flex-1">
            <Text className="font-sora-medium text-foreground">{t('operator.seasonsTitle')}</Text>
            <Text variant="caption">{t('operator.seasonsSubtitle')}</Text>
          </View>
          <ChevronRight size={16} color={c.mutedForeground} />
        </Pressable>

        {season.isError || stats.isError ? (
          <QueryError
            onRetry={() => {
              void season.refetch();
              void stats.refetch();
            }}
          />
        ) : current === null ? (
          <Text variant="muted">{t('operator.rewardsNoSeason')}</Text>
        ) : stats.data ? (
          <>
            <SeasonCard season={current} />
            <Section title={t('operator.rewardsRuns')}>
              <Row label={t('operator.rewardsEnrolled')} value={stats.data.overview.enrolled} />
              <Row label={t('operator.rewardsActive')} value={stats.data.overview.active} />
              <Row label={t('operator.rewardsCompleted')} value={stats.data.overview.completed} />
              <Row label={t('operator.rewardsPaying')} value={stats.data.overview.paying} />
            </Section>

            <Section title={t('operator.rewardsShields')} note={t('operator.rewardsShieldNote')}>
              <Row label={t('operator.rewardsEarned')} value={stats.data.shields.earned} />
              <Row label={t('operator.rewardsSpent')} value={stats.data.shields.spent} />
              <Row
                label={t('operator.rewardsSaved')}
                value={percent(stats.data.shields.runsSavedAtLeastOnce, stats.data.shields.runs)}
              />
            </Section>

            <Section title={t('operator.rewardsFailures')} note={t('operator.rewardsFailuresNote')}>
              {stats.data.failures.length === 0 ? (
                <Text variant="caption">{t('operator.rewardsNoData')}</Text>
              ) : (
                stats.data.failures.map((row) => (
                  <Row
                    key={row.module_id}
                    label={t(`syncModule.${row.module_id}`)}
                    value={row.failed_days}
                  />
                ))
              )}
            </Section>

            <Section
              title={t('operator.rewardsRetention')}
              note={t('operator.rewardsRetentionCaveat')}
            >
              <Row
                label={t('operator.rewardsInRun')}
                value={percent(
                  stats.data.retention.enrolledKept,
                  stats.data.retention.enrolledTotal,
                )}
              />
              <Row
                label={t('operator.rewardsControl')}
                value={percent(stats.data.retention.controlKept, stats.data.retention.controlTotal)}
              />
            </Section>
          </>
        ) : (
          // The chain used to end in `null`, so the whole console was blank
          // while the season and its stats were in flight — and these screens
          // hit the network unconditionally, so that is the common case.
          <ListSkeleton rows={4} />
        )}
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-2">
      <Text variant="micro">{title}</Text>
      <View className={cardClass({ padding: 'none' }, 'px-4')}>{children}</View>
      {note ? <Text variant="caption">{note}</Text> : null}
    </View>
  );
}

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <View className="flex-row items-center gap-3 py-3">
      <Text className="flex-1 font-sora-medium text-foreground">{label}</Text>
      <Text className="font-sora-semibold text-foreground">{value}</Text>
    </View>
  );
}

/**
 * Which season the figures below belong to, and what it is actually doing.
 *
 * The screen fetched the season's name and then rendered neither it nor its
 * state, which left every number underneath unattributable: a column of zeros
 * says "nobody enrolled" and "nobody *could* enrol" in exactly the same voice,
 * and those two call for opposite responses.
 *
 * Two distinctions this card exists to draw, both of which have cost real time:
 *
 *  1. The switch at the top of this screen is the `rewards` **module flag** — it
 *     decides whether users see the challenge at all — while a season has its
 *     own `enabled` column, defaulted to false, which decides whether they can
 *     join it. Both are legitimately called "enabled", and with the flag on and
 *     the season off the programme looks live and admits nobody.
 *  2. "Enabled, inside its dates" is not the same as "joinable". A season with
 *     fewer eligible modules than it asks people to commit to is unjoinable by
 *     construction, and this card used to report it as Open — which is exactly
 *     what staging did for weeks while every user was told the opposite.
 *
 * Neither is re-derived here any more. The chip shows the server's word, and
 * under it sits the sentence a user's phone is displaying, rendered by the app's
 * own component.
 */
function SeasonCard({ season }: { season: AdminSeason }) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const fix = operatorFix(season.state);

  return (
    <View className={cardClass({ padding: 'md' }, 'gap-2')}>
      <View className="flex-row items-center gap-3">
        <Text className="flex-1 font-sora-semibold text-foreground" numberOfLines={2}>
          {season.name}
        </Text>
        <StateChip state={season.state} />
      </View>
      <Text variant="caption">{windowLabel(season.startsAt, season.endsAt)}</Text>
      <Text variant="caption">
        {t('operator.seasonCounts', {
          modules: season.eligibleModules,
          required: season.requiredModules,
          rungs: season.tierCount,
          runs: season.activeCount,
        })}
      </Text>

      <View className="mt-1 rounded-xl border border-border p-3">
        <Text variant="micro">{t('operator.seasonUsersSee')}</Text>
        <SeasonNotice
          status={{
            state: season.state,
            name: season.name,
            startsAt: season.startsAt,
            endsAt: season.endsAt,
          }}
        />
      </View>

      {/* Only when it matters. With the season open this would be noise; with it
          anything else it is the whole explanation for everything below. */}
      {fix ? (
        <Text variant="caption" style={{ color: c.warning }}>
          {t(fix)}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The master switch, on the same remote flag table every Hub module uses.
 *
 * Seeded disabled, and it has to be: `module_flags` treats an absent row as
 * enabled (0011's rule 1, so a new module ships working rather than waiting on
 * a migration), which for a programme that ships physical goods would mean it
 * turning itself on during a deploy nobody was watching.
 */
function RewardsSwitch() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const enabled = useModuleFlagsStore((s) => s.flags[REWARDS_MODULE_ID]?.enabled !== false);
  const [busy, setBusy] = useState(false);

  const toggle = async (next: boolean) => {
    setBusy(true);
    const result = await setModuleEnabled(REWARDS_MODULE_ID, next, null);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await refreshModuleFlags();
  };

  return (
    <View className="gap-2">
      <Text variant="micro">{t('operator.rewardsSwitch')}</Text>
      <View className={cardClass({ padding: 'none' }, 'px-4')}>
        <View className="flex-row items-center gap-3 py-3.5">
          <View className="flex-1">
            <Text className="font-sora-medium text-foreground">{t('operator.rewardsEnabled')}</Text>
            <Text variant="caption">{t('operator.rewardsEnabledSubtitle')}</Text>
          </View>
          <Switch
            value={enabled}
            disabled={busy}
            onValueChange={(next) => void toggle(next)}
            trackColor={{ true: c.accent, false: c.border }}
          />
        </View>
      </View>
    </View>
  );
}
