import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format, set, subDays } from 'date-fns';
import { useLocalSearchParams, useRouter, useSegments } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, View } from 'react-native';

import { CalendarDays, Moon, Sun, Trash2 } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Chip } from '@/components/ui/chip';
import { cardClass } from '@/components/ui/card';
import { showInterstitial } from '@/features/ads/services/interstitial';
import { Button } from '@/components/ui/button';
import { StarRating } from '@/components/ui/star-rating';
import { SheetHeader } from '@/components/ui/sheet-header';
import { Text } from '@/components/ui/text';
import { moduleTint, moduleTints } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { TimeField } from '@/features/sleep/components/time-field';
import { durationBetween, formatDuration } from '@/features/sleep/services/sleep-stats';
import { useSleepMutations } from '@/features/sleep/hooks/use-sleep-mutations';
import { useSleepSession } from '@/features/sleep/hooks/use-sleep';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
import { confirm } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

const FELL_ASLEEP_OPTIONS = [0, 5, 10, 15, 20, 30, 45];

/** Combines the night date with a time-of-day, rolling bedtime to the previous
 * day when it lands at/after the wake time (i.e. an overnight sleep). */
function buildTimestamps(nightDate: Date, bed: Date, wake: Date) {
  const wakeAt = set(nightDate, {
    hours: wake.getHours(),
    minutes: wake.getMinutes(),
    seconds: 0,
    milliseconds: 0,
  });
  let bedAt = set(nightDate, {
    hours: bed.getHours(),
    minutes: bed.getMinutes(),
    seconds: 0,
    milliseconds: 0,
  });
  if (bedAt.getTime() >= wakeAt.getTime()) bedAt = subDays(bedAt, 1);
  return {
    bedtime: bedAt.getTime(),
    wakeTime: wakeAt.getTime(),
    logDate: format(nightDate, 'yyyy-MM-dd'),
  };
}

export default function SleepLogScreen() {
  const { id, bedtimeTs, wakeTs } = useLocalSearchParams<{
    id?: string;
    bedtimeTs?: string;
    wakeTs?: string;
  }>();
  const router = useRouter();
  const segments = useSegments();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const sleepTint = moduleTint('sleep', scheme);
  const { create, update, remove } = useSleepMutations();
  const { data: existing } = useSleepSession(id);

  const isEdit = !!id;

  // Prefill priority: existing record (edit) → tracker hand-off (bed/wake
  // timestamps) → sensible defaults.
  const bedParam = bedtimeTs ? Number(bedtimeTs) : null;
  const wakeParam = wakeTs ? Number(wakeTs) : null;

  const [nightDate, setNightDate] = useState(() => {
    if (existing) return new Date(`${existing.logDate}T00:00:00`);
    if (wakeParam)
      return set(new Date(wakeParam), { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 });
    return new Date();
  });
  const [bed, setBed] = useState(() =>
    existing
      ? new Date(existing.bedtime)
      : bedParam
        ? new Date(bedParam)
        : set(new Date(), { hours: 23, minutes: 0 }),
  );
  const [wake, setWake] = useState(() =>
    existing
      ? new Date(existing.wakeTime)
      : wakeParam
        ? new Date(wakeParam)
        : set(new Date(), { hours: 7, minutes: 0 }),
  );
  const [fellAsleep, setFellAsleep] = useState<number | null>(existing?.fellAsleepMinutes ?? null);
  const [quality, setQuality] = useState<number | null>(existing?.quality ?? null);
  const [note, setNote] = useState(existing?.note ?? '');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Re-seed state once the async session load resolves in edit mode.
  const [seeded, setSeeded] = useState(false);
  if (isEdit && existing && !seeded) {
    setNightDate(new Date(`${existing.logDate}T00:00:00`));
    setBed(new Date(existing.bedtime));
    setWake(new Date(existing.wakeTime));
    setFellAsleep(existing.fellAsleepMinutes ?? null);
    setQuality(existing.quality ?? null);
    setNote(existing.note ?? '');
    setSeeded(true);
  }

  /**
   * "Has anything been touched" against the values this screen opened with.
   *
   * A ref rather than a comparison with `existing`, because the same screen is
   * both the create and the edit form: on create there is no record to compare
   * to, and the defaults (23:00 / 07:00, or the times handed over by the
   * tracker) are themselves the baseline. Re-taken once the async edit load has
   * seeded the fields, or every edit would open already "dirty".
   */
  const snapshot = JSON.stringify([
    nightDate.getTime(),
    bed.getTime(),
    wake.getTime(),
    fellAsleep,
    quality,
    note.trim(),
  ]);
  const baseline = useRef(snapshot);
  const rebased = useRef(false);
  if (seeded && !rebased.current) {
    rebased.current = true;
    baseline.current = snapshot;
  }
  const release = useUnsavedChanges(snapshot !== baseline.current);

  const previewMinutes = useMemo(() => {
    const { bedtime, wakeTime } = buildTimestamps(nightDate, bed, wake);
    return durationBetween(bedtime, wakeTime);
  }, [nightDate, bed, wake]);

  const asleepMinutes = Math.max(0, previewMinutes - (fellAsleep ?? 0));

  const handleDateChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (event.type === 'set' && date) setNightDate(date);
  };

  const save = () => {
    const { bedtime, wakeTime, logDate } = buildTimestamps(nightDate, bed, wake);
    // Sleep can't happen in the future.
    if (wakeTime > Date.now()) {
      toast.error(t('sleep.futureBody'));
      return;
    }
    if (isEdit && existing) {
      update.mutate({
        id: existing.id,
        input: {
          bedtime,
          wakeTime,
          logDate,
          fellAsleepMinutes: fellAsleep,
          quality,
          note: note.trim() || null,
        },
      });
    } else {
      create.mutate({
        logDate,
        bedtime,
        wakeTime,
        fellAsleepMinutes: fellAsleep,
        quality,
        note: note.trim() || null,
      });
    }
    release();
    router.back();
    // Same reasoning as the study timer: a saved entry is a finished flow, not
    // a moment in the middle of one. `showInterstitial` owns every gate.
    void showInterstitial({ segments, breakpoint: 'sleep-log-saved' });
  };

  const confirmDelete = () => {
    if (!existing) return;
    void confirm({
      title: t('sleep.deleteTitle'),
      message: t('sleep.deleteBody'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      remove.mutate(existing.id);
      // Deleting is also a deliberate exit — asking "discard your changes?"
      // on top of a confirmed delete is the app not listening.
      release();
      router.back();
    });
  };

  return (
    <View className="flex-1 bg-background">
      <SheetHeader
        title={isEdit ? t('sleep.editSleep') : t('sleep.logSleepTitle')}
        right={
          isEdit ? (
            <Pressable
              accessibilityRole="button"
              onPress={confirmDelete}
              hitSlop={10}
              className="h-9 w-9 items-center justify-center"
              accessibilityLabel={t('common.delete')}
            >
              <Trash2 size={18} color={colors[scheme].destructive} />
            </Pressable>
          ) : undefined
        }
      />

      <ScrollView
        contentContainerClassName="gap-5 px-5 pt-3 pb-10"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className={cardClass({ padding: 'row' }, 'flex-row items-center justify-between')}>
          <View className="flex-row items-center gap-2">
            <CalendarDays size={16} color={colors[scheme].mutedForeground} />
            <Text className="font-sora-medium text-foreground">{t('sleep.nightOf')}</Text>
          </View>
          {Platform.OS === 'ios' ? (
            <DateTimePicker
              value={nightDate}
              mode="date"
              display="compact"
              maximumDate={new Date()}
              onChange={handleDateChange}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowDatePicker(true)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5"
            >
              <Text className="font-sora-semibold text-foreground">
                {format(nightDate, 'MMM d, yyyy')}
              </Text>
            </Pressable>
          )}
        </View>
        {Platform.OS === 'android' && showDatePicker && (
          <DateTimePicker
            value={nightDate}
            mode="date"
            display="default"
            maximumDate={new Date()}
            onChange={handleDateChange}
          />
        )}

        <View className="flex-row gap-3">
          <TimeField
            icon={Moon}
            label={t('sleep.bedtime')}
            value={bed}
            onChange={setBed}
            tint={sleepTint}
          />
          <TimeField
            icon={Sun}
            label={t('sleep.wakeUp')}
            value={wake}
            onChange={setWake}
            tint="#f59e0b"
          />
        </View>

        <View className="flex-row gap-3 rounded-2xl bg-surface p-4">
          <View className="flex-1 items-center gap-1">
            <Text variant="micro">{t('sleep.inBed')}</Text>
            <Text
              className="font-sora-bold text-2xl text-foreground"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatDuration(previewMinutes)}
            </Text>
          </View>
          <View className="w-px bg-border" />
          <View className="flex-1 items-center gap-1">
            <Text variant="micro">{t('sleep.asleep')}</Text>
            <Text
              className="font-sora-extrabold text-2xl text-sleep"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatDuration(asleepMinutes)}
            </Text>
          </View>
        </View>

        <View className="gap-2.5">
          <Text variant="micro">{t('sleep.timeToFallAsleep')}</Text>
          <View className="flex-row flex-wrap gap-2">
            {FELL_ASLEEP_OPTIONS.map((minutes) => {
              const selected = fellAsleep === minutes;
              return (
                <Chip
                  key={minutes}
                  label={
                    minutes === 0 ? t('sleep.instantly') : t('sleep.minutesShort', { minutes })
                  }
                  selected={selected}
                  tint={moduleTints.sleep}
                  onPress={() => setFellAsleep(selected ? null : minutes)}
                  className="py-2"
                />
              );
            })}
          </View>
        </View>

        <View className="gap-2.5">
          <Text variant="micro">{t('sleep.qualityOptional')}</Text>
          <StarRating value={quality} onChange={setQuality} />
        </View>

        <View className="gap-2.5">
          <Text variant="micro">{t('sleep.noteOptional')}</Text>
          <Input
            value={note}
            onChangeText={setNote}
            placeholder={t('sleep.notePlaceholder')}
            multiline
            className="min-h-16"
          />
        </View>

        <Button
          label={isEdit ? t('common.saveChanges') : t('sleep.saveSleep')}
          onPress={save}
          size="lg"
          variant="accent"
        />
      </ScrollView>
    </View>
  );
}
