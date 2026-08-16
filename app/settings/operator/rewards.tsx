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
 * A view over the RPCs in migration 0051 and nothing else — every one of them
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

export default function OperatorRewardsScreen() {
  const { t } = useTranslation();
  const { c } = useTheme();

  const season = useQuery({
    queryKey: ['operator', 'challenge', 'season'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('challenge_seasons')
        .select('id, name')
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      return data?.[0] ?? null;
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
        ) : stats.data ? (
          <>
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
