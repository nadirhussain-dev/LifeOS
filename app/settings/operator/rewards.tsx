import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Switch, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { REWARDS_MODULE_ID } from '@/features/challenge/config/rewards-flag';
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

export type SeasonRow = {
  id: string;
  name: string;
  enabled: boolean;
  starts_at: string | null;
  ends_at: string | null;
};

/** Whether the season's own gate is open right now — the same three conditions
 *  `challenge_enroll` checks in 0048 before it will let anybody in. */
export function isSeasonLive(season: SeasonRow, now = Date.now()): boolean {
  if (!season.enabled) return false;
  if (season.starts_at && Date.parse(season.starts_at) > now) return false;
  if (season.ends_at && Date.parse(season.ends_at) < now) return false;
  return true;
}

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
 * So: a live season wins; failing that the most recently created one, which is
 * the best guess at "the one you are working on". The caller renders which it
 * got either way, because the numbers mean different things.
 *
 * @param rows newest-created first
 */
export function pickSeason(rows: SeasonRow[], now = Date.now()): SeasonRow | null {
  return rows.find((row) => isSeasonLive(row, now)) ?? rows[0] ?? null;
}

export default function OperatorRewardsScreen() {
  const { t } = useTranslation();
  const { c } = useTheme();

  const season = useQuery({
    queryKey: ['operator', 'challenge', 'season'],
    queryFn: async () => {
      // Every season, newest first, rather than `limit(1)`. Which one these
      // numbers describe is a judgement (see `pickSeason`) and it cannot be made
      // in the ORDER BY: "most recently created" is not "currently running", and
      // reporting on a season created for next month is how a live season's
      // figures get replaced by a row of zeros nobody can account for.
      const { data, error } = await supabase
        .from('challenge_seasons')
        .select('id, name, enabled, starts_at, ends_at')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return pickSeason((data ?? []) as SeasonRow[]);
    },
  });

  const seasonId = season.data?.id as string | undefined;

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

        {season.isError || stats.isError ? (
          <QueryError
            onRetry={() => {
              void season.refetch();
              void stats.refetch();
            }}
          />
        ) : season.data === null ? (
          <Text variant="muted">{t('operator.rewardsNoSeason')}</Text>
        ) : stats.data && season.data ? (
          <>
            <SeasonCard season={season.data} />
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
        ) : null}
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
 * Which season the figures below belong to, and whether it is actually running.
 *
 * The screen fetched the season's name and then rendered neither it nor its
 * state, which left every number underneath unattributable: a column of zeros
 * says "nobody enrolled" and "nobody *could* enrol" in exactly the same voice,
 * and those two call for opposite responses.
 *
 * The distinction this card exists to draw is the one that costs the most time:
 * the switch at the top of this screen is the `rewards` **module flag** — it
 * decides whether users see the challenge at all — while `challenge_seasons`
 * has its own `enabled` column, defaulted to false, which is what
 * `challenge_enroll` checks. Both can legitimately be called "enabled", only
 * one is on this screen, and with the module flag on and the season off the
 * programme looks live and admits nobody.
 */
function SeasonCard({ season }: { season: SeasonRow }) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const live = isSeasonLive(season);

  const window = [season.starts_at, season.ends_at]
    .map((value) => (value ? new Date(value).toISOString().slice(0, 10) : '—'))
    .join(' → ');

  return (
    <View className={cardClass({ padding: 'md' }, 'gap-2')}>
      <View className="flex-row items-center gap-3">
        <Text className="flex-1 font-sora-semibold text-foreground" numberOfLines={2}>
          {season.name}
        </Text>
        <View
          className="rounded-full px-2.5 py-1"
          style={{ backgroundColor: `${live ? c.success : c.error}1f` }}
        >
          <Text variant="caption" style={{ color: live ? c.success : c.error }}>
            {t(live ? 'operator.rewardsSeasonLive' : 'operator.rewardsSeasonClosed')}
          </Text>
        </View>
      </View>
      <Text variant="caption">{window}</Text>
      {/* Only when it matters. With the season open this would be noise; with it
          shut it is the whole explanation for everything below. */}
      {live ? null : <Text variant="caption">{t('operator.rewardsSeasonClosedWhy')}</Text>}
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
