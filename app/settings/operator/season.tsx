import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Switch, View } from 'react-native';

import { Trash2 } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { QueryError } from '@/components/ui/query-error';
import { Text } from '@/components/ui/text';
import { SeasonNotice } from '@/features/challenge/components/season-notice';
import { attributableModules } from '@/features/challenge/config/write-attribution';
import { operatorFix, windowLabel } from '@/features/challenge/services/season-state';
import { StateChip } from '@/app/settings/operator/seasons';
import {
  deleteSeason,
  deleteSeasonTier,
  listSeasonModules,
  listSeasonTiers,
  listSeasons,
  seedSeason,
  setSeasonEnabled,
  setSeasonModule,
  shiftedEnd,
  updateSeason,
  upsertSeasonTier,
  type AdminSeason,
  type AdminSeasonTier,
  type SeasonPatch,
} from '@/features/operator/services/challenge-admin';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

/**
 * One season, every knob.
 *
 * 0048's header says nothing about the programme should be a code constant, and
 * it kept that promise — then shipped no screen for any of it, which turns
 * "editable without a release" into "editable by whoever has the production
 * connection string". This is the screen that was missing.
 *
 * Three things it is built around, in order:
 *
 *  1. **The state, quoted from the server, with the user's sentence under it.**
 *     Not re-derived here. The whole class of bug this replaces was two screens
 *     computing "is it open" from different columns.
 *  2. **The switch that actually closes a season**, kept visually apart from the
 *     `rewards` module flag on the previous screen and labelled with what each
 *     one does — those two being confusable is why "I tried to close it and
 *     nothing happened" was a reasonable thing to say.
 *  3. **Dates that move in both directions**, with the resulting date shown
 *     before it is committed, because extending and shortening a live season is
 *     the routine operational act here and it must not require arithmetic.
 */
export default function OperatorSeasonScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { c } = useTheme();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [busy, setBusy] = useState(false);
  const [patch, setPatch] = useState<SeasonPatch>({});

  const seasons = useQuery({
    queryKey: ['operator', 'challenge', 'seasons'],
    queryFn: listSeasons,
  });
  const modules = useQuery({
    queryKey: ['operator', 'challenge', 'modules', id],
    enabled: Boolean(id),
    queryFn: () => listSeasonModules(id),
  });
  const tiers = useQuery({
    queryKey: ['operator', 'challenge', 'tiers', id],
    enabled: Boolean(id),
    queryFn: () => listSeasonTiers(id),
  });

  const season = (seasons.data?.ok ? seasons.data.data : []).find((s) => s.id === id) ?? null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['operator', 'challenge'] });
    void queryClient.invalidateQueries({ queryKey: ['challenge'] });
  };

  /** Runs a write, reports the server's refusal verbatim, and refreshes. */
  const run = async (
    action: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>,
    success?: string,
  ) => {
    if (busy) return;
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (success) toast.success(success);
    refresh();
  };

  if (!id) return null;

  if (seasons.isError || (seasons.data && !seasons.data.ok)) {
    return (
      <View className="flex-1 bg-background px-5 pt-14">
        <QueryError onRetry={() => void seasons.refetch()} />
      </View>
    );
  }

  const dirty = Object.keys(patch).length > 0;
  /** The row with unsaved edits laid over it, so the preview matches the form. */
  const draft: AdminSeason | null = season ? { ...season, ...patch } : null;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        eyebrow={t('operator.eyebrow')}
        title={season?.name ?? t('operator.seasonsTitle')}
        subtitle={t('operator.seasonSubtitle')}
        tint={c.error}
      />

      {!season || !draft ? (
        <View className="px-5">
          <Text variant="muted">{t('operator.seasonMissing')}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="gap-5 px-5 pb-16"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* --- what it is doing, and what users are reading --------------- */}
          <View className={cardClass({ padding: 'md' }, 'gap-2')}>
            <View className="flex-row items-center gap-3">
              <Text className="flex-1 font-sora-semibold text-foreground">
                {t('operator.seasonStatus')}
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

            {operatorFix(season.state) ? (
              <Text variant="caption" style={{ color: c.warning }}>
                {t(operatorFix(season.state) as string)}
              </Text>
            ) : null}

            {/* The one-tap repair for the state that produced this whole
                console: enabled, in window, and nothing to commit to. */}
            {season.eligibleModules === 0 || season.tierCount === 0 ? (
              <Button
                variant="secondary"
                label={t('operator.seasonSeed')}
                disabled={busy}
                onPress={() => void run(() => seedSeason(season.id), t('operator.seasonSeeded'))}
              />
            ) : null}
          </View>

          {/* --- the switch that actually closes it ------------------------- */}
          <Section title={t('operator.seasonSwitchTitle')} note={t('operator.seasonSwitchNote')}>
            <View className="flex-row items-center gap-3 py-3.5">
              <View className="flex-1">
                <Text className="font-sora-medium text-foreground">
                  {t('operator.seasonOpenLabel')}
                </Text>
                <Text variant="caption">{t('operator.seasonOpenSubtitle')}</Text>
              </View>
              <Switch
                value={season.enabled}
                disabled={busy}
                onValueChange={(next) =>
                  void run(
                    () => setSeasonEnabled(season.id, next),
                    next ? t('operator.seasonOpened') : t('operator.seasonClosed'),
                  )
                }
                trackColor={{ true: c.accent, false: c.border }}
              />
            </View>
          </Section>

          {/* --- dates ------------------------------------------------------ */}
          <Section title={t('operator.seasonDates')} note={t('operator.seasonDatesNote')}>
            <DateField
              label={t('operator.seasonStartsAt')}
              value={draft.startsAt}
              onChange={(startsAt) => setPatch((p) => ({ ...p, startsAt }))}
            />
            <DateField
              label={t('operator.seasonEndsAt')}
              value={draft.endsAt}
              onChange={(endsAt) => setPatch((p) => ({ ...p, endsAt }))}
            />
            {/*
              Extending and shortening are the same control in both directions,
              anchored on the end date the season already has. An operator
              adding a week to a live season should not have to open a calendar,
              work out the date and retype it — that is where the typo that
              closes a season early comes from.
            */}
            <View className="flex-row flex-wrap gap-2 py-2">
              {[7, 30, -7].map((days) => (
                <Pressable
                  key={days}
                  accessibilityRole="button"
                  onPress={() =>
                    setPatch((p) => ({ ...p, endsAt: shiftedEnd(draft.endsAt, days) }))
                  }
                  className="rounded-full border border-border px-3 py-1.5"
                >
                  <Text variant="caption">
                    {days > 0
                      ? t('operator.seasonExtend', { days })
                      : t('operator.seasonShorten', { days: Math.abs(days) })}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                onPress={() => setPatch((p) => ({ ...p, endsAt: new Date().toISOString() }))}
                className="rounded-full border border-border px-3 py-1.5"
              >
                <Text variant="caption">{t('operator.seasonEndNow')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPatch((p) => ({ ...p, endsAt: null }))}
                className="rounded-full border border-border px-3 py-1.5"
              >
                <Text variant="caption">{t('operator.seasonNoEnd')}</Text>
              </Pressable>
            </View>
          </Section>

          {/* --- the rules -------------------------------------------------- */}
          <Section title={t('operator.seasonRules')} note={t('operator.seasonRulesNote')}>
            <NumberField
              label={t('operator.seasonRequiredModules')}
              hint={t('operator.seasonRequiredModulesHint')}
              value={draft.requiredModules}
              onChange={(requiredModules) => setPatch((p) => ({ ...p, requiredModules }))}
            />
            <NumberField
              label={t('operator.seasonMinWrites')}
              hint={t('operator.seasonMinWritesHint')}
              value={draft.minWrites}
              onChange={(minWrites) => setPatch((p) => ({ ...p, minWrites }))}
            />
            {/* A switch, not a number, and placed with the rules rather than
                with the open/closed switch above: it changes what qualifies a
                day, which is the same category of decision as min writes and
                required modules. Turning it ON mid-season is safe — every
                client that can attest has shipped by then. Turning it OFF is
                the emergency lever, which is why it is one tap and not buried
                behind the patch form's Save. */}
            <View className="flex-row items-center gap-3 py-3.5">
              <View className="flex-1">
                <Text className="font-sora-medium text-foreground">
                  {t('operator.seasonLiveWrites')}
                </Text>
                <Text variant="caption">{t('operator.seasonLiveWritesHint')}</Text>
              </View>
              <Switch
                value={draft.requireLiveWrites ?? false}
                disabled={busy}
                onValueChange={(requireLiveWrites) =>
                  setPatch((p) => ({ ...p, requireLiveWrites }))
                }
                trackColor={{ true: c.accent, false: c.border }}
              />
            </View>
            <NumberField
              label={t('operator.seasonMinSeconds')}
              hint={t('operator.seasonMinSecondsHint')}
              value={draft.minActiveSeconds}
              onChange={(minActiveSeconds) => setPatch((p) => ({ ...p, minActiveSeconds }))}
            />
            <NumberField
              label={t('operator.seasonGrace')}
              hint={t('operator.seasonGraceHint')}
              value={draft.dayGraceHours}
              onChange={(dayGraceHours) => setPatch((p) => ({ ...p, dayGraceHours }))}
            />
            <NumberField
              label={t('operator.seasonMaxEnrollments')}
              hint={t('operator.seasonMaxEnrollmentsHint')}
              value={draft.maxEnrollments}
              nullable
              onChange={(maxEnrollments) => setPatch((p) => ({ ...p, maxEnrollments }))}
            />
          </Section>

          <Section title={t('operator.seasonShields')} note={t('operator.seasonShieldsNote')}>
            <NumberField
              label={t('operator.seasonShieldEarn')}
              hint={t('operator.seasonShieldEarnHint')}
              value={draft.shieldEarnDays}
              onChange={(shieldEarnDays) => setPatch((p) => ({ ...p, shieldEarnDays }))}
            />
            <NumberField
              label={t('operator.seasonShieldFloor')}
              hint={t('operator.seasonShieldFloorHint')}
              value={draft.shieldFloorDays}
              onChange={(shieldFloorDays) => setPatch((p) => ({ ...p, shieldFloorDays }))}
            />
            <NumberField
              label={t('operator.seasonShieldCap')}
              hint={t('operator.seasonShieldCapHint')}
              value={draft.shieldCap}
              onChange={(shieldCap) => setPatch((p) => ({ ...p, shieldCap }))}
            />
            <NumberField
              label={t('operator.seasonMaxDemotion')}
              hint={t('operator.seasonMaxDemotionHint')}
              value={draft.maxDemotionDays}
              onChange={(maxDemotionDays) => setPatch((p) => ({ ...p, maxDemotionDays }))}
            />
          </Section>

          <Section title={t('operator.seasonPicker')} note={t('operator.seasonPickerNote')}>
            <NumberField
              label={t('operator.seasonLockDays')}
              hint={t('operator.seasonLockDaysHint')}
              value={draft.moduleLockDays}
              onChange={(moduleLockDays) => setPatch((p) => ({ ...p, moduleLockDays }))}
            />
            <NumberField
              label={t('operator.seasonSwaps')}
              hint={t('operator.seasonSwapsHint')}
              value={draft.moduleSwapsAllowed}
              onChange={(moduleSwapsAllowed) => setPatch((p) => ({ ...p, moduleSwapsAllowed }))}
            />
          </Section>

          {dirty ? (
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Button
                  variant="secondary"
                  label={t('common.cancel')}
                  onPress={() => setPatch({})}
                  disabled={busy}
                />
              </View>
              <View className="flex-1">
                <Button
                  label={busy ? t('common.saving') : t('common.save')}
                  disabled={busy}
                  onPress={() =>
                    void run(() => updateSeason(season.id, patch), t('operator.seasonSaved')).then(
                      () => setPatch({}),
                    )
                  }
                />
              </View>
            </View>
          ) : null}

          {/* --- eligible modules ------------------------------------------- */}
          <ModulesSection
            seasonId={season.id}
            requiredModules={season.requiredModules}
            rows={modules.data?.ok ? modules.data.data : []}
            busy={busy}
            onWrite={run}
          />

          {/* --- the ladder ------------------------------------------------- */}
          <LadderSection
            seasonId={season.id}
            rows={tiers.data?.ok ? tiers.data.data : []}
            busy={busy}
            onWrite={run}
          />

          {/* --- deletion, which the server refuses once anybody has joined -- */}
          <Section title={t('operator.seasonDanger')} note={t('operator.seasonDangerNote')}>
            <View className="py-2">
              <Button
                variant="secondary"
                label={t('operator.seasonDelete')}
                disabled={busy || season.enrolledCount > 0}
                onPress={() =>
                  void confirm({
                    title: t('operator.seasonDeleteConfirmTitle'),
                    message: t('operator.seasonDeleteConfirmBody', { name: season.name }),
                    confirmLabel: t('common.delete'),
                    cancelLabel: t('common.cancel'),
                    destructive: true,
                  }).then((yes) => {
                    if (!yes) return;
                    void run(() => deleteSeason(season.id)).then(() => router.back());
                  })
                }
              />
              {season.enrolledCount > 0 ? (
                <Text variant="caption">
                  {t('operator.seasonDeleteBlocked', { count: season.enrolledCount })}
                </Text>
              ) : null}
            </View>
          </Section>
        </ScrollView>
      )}
    </View>
  );
}

/**
 * Which modules may be committed to.
 *
 * The candidate list is the write-attribution map's own vocabulary, which is
 * the sync registry's keys — not a second list typed out here. A module offered
 * under any other name is one nobody can ever satisfy: writes arrive attributed
 * to `habits` while the contract waits for something spelled differently, and
 * the symptom is a user doing the work and losing the day.
 */
function ModulesSection({
  seasonId,
  requiredModules,
  rows,
  busy,
  onWrite,
}: {
  seasonId: string;
  requiredModules: number;
  rows: { moduleId: string; eligible: boolean; estDailySeconds: number }[];
  busy: boolean;
  onWrite: (
    action: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>,
    success?: string,
  ) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { c } = useTheme();

  const candidates = useMemo(
    () =>
      attributableModules().filter(
        // The private space is deliberately excluded. Committing to it would
        // put its name on a checklist and in the per-module strips of a screen
        // built to be shown to other people, which is the opposite of what that
        // module is for.
        (moduleId) => moduleId !== 'private',
      ),
    [],
  );

  const byId = new Map(rows.map((row) => [row.moduleId, row]));
  const eligible = rows.filter((row) => row.eligible).length;

  return (
    <Section
      title={t('operator.seasonModules')}
      note={
        eligible < requiredModules
          ? t('operator.seasonModulesShort', { count: requiredModules - eligible })
          : t('operator.seasonModulesNote')
      }
    >
      {candidates.map((moduleId) => {
        const row = byId.get(moduleId);
        const on = row?.eligible ?? false;
        const seconds = row?.estDailySeconds ?? 60;
        return (
          <View key={moduleId} className="flex-row items-center gap-3 py-2.5">
            <View className="flex-1">
              <Text className="font-sora-medium text-foreground">
                {t(`syncModule.${moduleId}`)}
              </Text>
              <Text variant="caption">
                {t('operator.seasonModuleMinutes', {
                  count: Math.max(Math.round(seconds / 60), 1),
                })}
              </Text>
            </View>
            <Switch
              value={on}
              disabled={busy}
              onValueChange={(next) =>
                void onWrite(() => setSeasonModule(seasonId, moduleId, next, seconds))
              }
              trackColor={{ true: c.accent, false: c.border }}
            />
          </View>
        );
      })}
    </Section>
  );
}

/** The rungs, editable one at a time. */
/**
 * A rung's payout, in one line an operator can scan a ladder of.
 *
 * Counts by kind rather than listing slugs. Nine rungs each naming three slugs
 * is a wall of text nobody reads, and the questions this line has to answer are
 * "does this rung pay anything at all" and "does it pay Premium" — the second
 * because that is the only effect that costs money, and an operator should
 * never have to open the database to find out which rungs spend it.
 */
function summariseRewards(
  rewards: Record<string, unknown>[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (rewards.length === 0) return t('operator.seasonRungNoReward');

  const counts = new Map<string, number>();
  for (const effect of rewards) {
    const kind = typeof effect.kind === 'string' ? effect.kind : 'unknown';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([kind, count]) => {
      // Premium is the one worth spelling out, because the number is days of
      // paid access and a count of "1" says nothing about whether that is a
      // week or three months.
      if (kind === 'premium') {
        const days = rewards.find((r) => r.kind === 'premium')?.days;
        return t('operator.seasonRungPremium', { count: Number(days ?? 0) });
      }
      return count > 1 ? `${kind} ×${count}` : kind;
    })
    .join(' · ');
}

function LadderSection({
  seasonId,
  rows,
  busy,
  onWrite,
}: {
  seasonId: string;
  rows: AdminSeasonTier[];
  busy: boolean;
  onWrite: (
    action: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>,
    success?: string,
  ) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const [day, setDay] = useState('');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');

  const add = async () => {
    const threshold = Math.round(Number(day));
    if (!Number.isFinite(threshold) || threshold <= 0 || !name.trim()) return;
    await onWrite(() =>
      upsertSeasonTier(seasonId, {
        dayThreshold: threshold,
        name: name.trim(),
        // Physical rewards are a shipping commitment and a legal one; they are
        // set deliberately in SQL rather than being one tap away in a form that
        // also handles typos.
        rewardKind: 'digital',
        rewardTitle: title.trim() || null,
        rewardDescription: null,
      }),
    );
    setDay('');
    setName('');
    setTitle('');
  };

  return (
    <Section title={t('operator.seasonLadder')} note={t('operator.seasonLadderNote')}>
      {rows.length === 0 ? (
        <View className="py-3">
          <Text variant="caption">{t('operator.seasonLadderEmpty')}</Text>
        </View>
      ) : (
        rows.map((tier) => (
          <View key={tier.dayThreshold} className="flex-row items-center gap-3 py-2.5">
            <Text className="w-12 font-sora-semibold text-foreground">{tier.dayThreshold}</Text>
            <View className="flex-1">
              <Text className="font-sora-medium text-foreground">{tier.name}</Text>
              {tier.rewardTitle ? <Text variant="caption">{tier.rewardTitle}</Text> : null}
              {/*
                What the rung actually pays, next to what it says it pays.

                Both, deliberately. `rewardTitle` is the operator's prose and
                `rewards` is what the engine will hand over, and the failure
                worth catching here is exactly the two disagreeing — a rung
                promising a gift box while granting a badge is invisible from
                either line alone. Read-only: a JSON editor in a form that also
                handles typos is how somebody clears a payout by accident, and
                the seed already writes the default ladder.
              */}
              <Text variant="micro" style={{ color: c.mutedForeground }}>
                {summariseRewards(tier.rewards ?? [], t)}
              </Text>
            </View>
            {tier.rewardKind === 'physical' ? (
              <Text variant="caption">{t('operator.seasonPhysical')}</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              disabled={busy}
              onPress={() => void onWrite(() => deleteSeasonTier(seasonId, tier.dayThreshold))}
              className="h-9 w-9 items-center justify-center rounded-full border border-border"
            >
              <Trash2 size={15} color={c.mutedForeground} />
            </Pressable>
          </View>
        ))
      )}

      <View className="gap-2 py-3">
        <View className="flex-row gap-2">
          <Input
            value={day}
            onChangeText={setDay}
            placeholder={t('operator.seasonRungDay')}
            keyboardType="numeric"
            className="w-24"
          />
          <Input
            value={name}
            onChangeText={setName}
            placeholder={t('operator.seasonRungName')}
            containerClassName="flex-1"
          />
        </View>
        <Input value={title} onChangeText={setTitle} placeholder={t('operator.seasonRungReward')} />
        <Button
          variant="secondary"
          label={t('operator.seasonRungAdd')}
          disabled={busy || !day.trim() || !name.trim()}
          onPress={() => void add()}
        />
      </View>
    </Section>
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

/**
 * A number with its meaning next to it.
 *
 * The hint is not decoration. These are the knobs of a mechanic that took a
 * migration header to explain, and `shieldFloorDays` next to a bare text box is
 * a number somebody will change without knowing what it protects.
 */
type NumberFieldProps = {
  label: string;
  hint: string;
  value: number | null;
} & (
  | { nullable?: false; onChange: (value: number) => void }
  /** Clearable, meaning "no limit" — which is not the same answer as 0. */
  | { nullable: true; onChange: (value: number | null) => void }
);

function NumberField(props: NumberFieldProps) {
  const { label, hint, value } = props;
  const { t } = useTranslation();
  const [text, setText] = useState(value === null ? '' : String(value));

  const commit = (next: string) => {
    setText(next);
    const trimmed = next.trim();
    if (trimmed === '') {
      // An empty uncapped field is a real setting; an empty required one is a
      // half-typed number, and committing 0 for it would silently change a rule
      // mid-season for everybody living under it.
      if (props.nullable) props.onChange(null);
      return;
    }
    const parsed = Math.round(Number(trimmed));
    if (Number.isFinite(parsed)) props.onChange(parsed);
  };

  return (
    <View className="flex-row items-center gap-3 py-2.5">
      <View className="flex-1">
        <Text className="font-sora-medium text-foreground">{label}</Text>
        <Text variant="caption">{hint}</Text>
      </View>
      <Input
        surface="bare"
        value={text}
        onChangeText={commit}
        keyboardType="numeric"
        placeholder={props.nullable ? t('operator.seasonNoLimit') : ''}
        className="w-20 rounded-xl border border-border px-3 py-2 text-right text-foreground"
      />
    </View>
  );
}

/**
 * A date, as `YYYY-MM-DD`.
 *
 * Typed rather than picked, deliberately: this console is staff-facing, the
 * column is a timestamp, and an unambiguous ISO date is the one format that
 * cannot be read as a different day by somebody in another country. Anything
 * unparseable is left alone rather than committed — a half-typed date must not
 * be able to close a season.
 */
function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const { t } = useTranslation();
  const iso = value ? new Date(value).toISOString().slice(0, 10) : '';
  const [text, setText] = useState(iso);

  // The quick-shift buttons write straight to the patch, so the box has to
  // follow the value it is displaying rather than only its own typing.
  const shown = text === iso || text.length !== 10 ? text : iso;

  const commit = (next: string) => {
    setText(next);
    if (next.trim() === '') {
      onChange(null);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next.trim())) return;
    const parsed = new Date(`${next.trim()}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) onChange(parsed.toISOString());
  };

  return (
    <View className="flex-row items-center gap-3 py-2.5">
      <Text className="flex-1 font-sora-medium text-foreground">{label}</Text>
      <Input
        surface="bare"
        value={shown}
        onChangeText={commit}
        placeholder={t('operator.seasonDatePlaceholder')}
        autoCapitalize="none"
        autoCorrect={false}
        className="w-36 rounded-xl border border-border px-3 py-2 text-right text-foreground"
      />
    </View>
  );
}
