import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { Input } from '@/components/ui/input';
import { ChevronForward } from '@/components/ui/directional-icon';
import { ScreenHeader } from '@/components/ui/screen-header';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { QueryError } from '@/components/ui/query-error';
import { Text } from '@/components/ui/text';
import { SeasonNotice } from '@/features/challenge/components/season-notice';
import {
  isHealthy,
  operatorFix,
  windowLabel,
  type SeasonState,
} from '@/features/challenge/services/season-state';
import {
  createSeason,
  listSeasons,
  type AdminSeason,
} from '@/features/operator/services/challenge-admin';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';
import { toast } from '@/lib/toast-store';

/**
 * Every season, and what each one is actually doing.
 *
 * The screen this list is the answer to: 0048 put every knob of the programme
 * in data and shipped no way to see or change any of it, so seasons were made
 * by hand in the SQL editor and their state could only be worked out by reading
 * three tables. Staging duly ended up with a season that was enabled, inside
 * its window, and impossible to join, showing "Open" to staff and "no season is
 * open" to every user — with no screen anywhere that could show both facts at
 * once.
 *
 * So each row carries three things: the state word the server computed, the
 * counts that explain it, and — the part that ends the confusion for good — the
 * sentence a user's phone is displaying right now, rendered by the same
 * component the app renders it with. An operator never has to take the
 * console's word for what users can see.
 */
export default function OperatorSeasonsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { c } = useTheme();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const seasons = useQuery({
    queryKey: ['operator', 'challenge', 'seasons'],
    queryFn: listSeasons,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['operator', 'challenge'] });
    // The app's own read of the programme, invalidated alongside, so a staff
    // member with the challenge open in the same build sees what they just did.
    void queryClient.invalidateQueries({ queryKey: ['challenge'] });
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const result = await createSeason(trimmed);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setName('');
    refresh();
    router.push({ pathname: '/settings/operator/season', params: { id: result.data } });
  };

  const rows = seasons.data?.ok ? seasons.data.data : [];

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        eyebrow={t('operator.eyebrow')}
        title={t('operator.seasonsTitle')}
        subtitle={t('operator.seasonsSubtitle')}
        tint={c.error}
      />

      <ScrollView contentContainerClassName="gap-3 px-5 pb-10" showsVerticalScrollIndicator={false}>
        {seasons.isError || (seasons.data && !seasons.data.ok) ? (
          <QueryError onRetry={() => void seasons.refetch()} />
        ) : null}

        {seasons.data?.ok && rows.length === 0 ? (
          <Text variant="muted">{t('operator.seasonsEmpty')}</Text>
        ) : null}

        {seasons.isLoading ? <ListSkeleton rows={3} /> : null}
        {rows.map((season) => (
          <SeasonRow
            key={season.id}
            season={season}
            onOpen={() =>
              router.push({ pathname: '/settings/operator/season', params: { id: season.id } })
            }
          />
        ))}

        <View className={cardClass({ padding: 'md' }, 'gap-2')}>
          <Text variant="micro">{t('operator.seasonNew')}</Text>
          <Input
            value={name}
            onChangeText={setName}
            placeholder={t('operator.seasonNamePlaceholder')}
          />
          {/* Stated on the way in, because it is the step whose absence caused
              every symptom this console was built for: a new season is created
              switched off and stays that way until somebody has given it
              modules and a ladder. */}
          <Text variant="caption">{t('operator.seasonNewHint')}</Text>
          <Button
            label={busy ? t('common.saving') : t('operator.seasonCreate')}
            onPress={() => void create()}
            disabled={!name.trim() || busy}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function SeasonRow({ season, onOpen }: { season: AdminSeason; onOpen: () => void }) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const fix = operatorFix(season.state);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      className={cardClass({ padding: 'md' }, 'gap-2')}
    >
      <View className="flex-row items-center gap-3">
        <Text className="flex-1 font-sora-semibold text-foreground" numberOfLines={2}>
          {season.name}
        </Text>
        <StateChip state={season.state} />
        <ChevronForward size={16} color={c.mutedForeground} />
      </View>

      <Text variant="caption">{windowLabel(season.startsAt, season.endsAt)}</Text>

      {/* The counts behind the word. "Not joinable" on its own is one more
          thing to go and check; "Not joinable · 0 of 3 modules" is a sentence
          somebody can act on without leaving the screen. */}
      <Text variant="caption">
        {t('operator.seasonCounts', {
          modules: season.eligibleModules,
          required: season.requiredModules,
          rungs: season.tierCount,
          runs: season.activeCount,
        })}
      </Text>

      <View
        className="rounded-xl px-3 py-2"
        style={{ backgroundColor: alpha(c.mutedForeground, 0.1) }}
      >
        <Text variant="micro">{t('operator.seasonUsersSee')}</Text>
        {/*
          The app's own component, fed the same fields the phone gets. A second
          hand-written description of each state in the console is exactly how
          the console and the app started disagreeing in the first place.
        */}
        <SeasonNotice
          status={{
            state: season.state,
            name: season.name,
            startsAt: season.startsAt,
            endsAt: season.endsAt,
          }}
        />
      </View>

      {fix ? (
        <Text variant="caption" style={{ color: c.warning }}>
          {t(fix)}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** The state word, coloured. Green only for `open` — every other state is
 *  something a user is currently unable to do. */
export function StateChip({ state }: { state: SeasonState }) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const colour = isHealthy(state) ? c.success : c.warning;

  return (
    <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: alpha(colour, 0.12) }}>
      <Text variant="caption" style={{ color: colour }}>
        {t(`operator.seasonState_${state}`)}
      </Text>
    </View>
  );
}
