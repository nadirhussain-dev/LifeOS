import { type BottomSheetModal } from '@gorhom/bottom-sheet';
import { addMonths, format, parseISO, subMonths } from 'date-fns';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { moduleTints, resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { ChipRow, PrivateScreen } from '@/features/private/components/private-screen';
import {
  CycleEntrySheet,
  type CycleEntryTarget,
} from '@/features/private/components/cycle-entry-sheet';
import { CycleHero } from '@/features/private/components/cycle-hero';
import { CycleMonthStrip } from '@/features/private/components/cycle-month-strip';
import { privateModule } from '@/features/private/config/private-modules';
import {
  addCycleEntry,
  editCycleEntry,
  listCycleEntries,
  removeCycleEntry,
} from '@/features/private/services/cycle';
import { syncCycleReminders } from '@/features/private/services/cycle-reminders';
import {
  SYMPTOMS,
  averageCycleLength,
  dayOfCycle,
  distinctTags,
  fertileWindow,
  periodsFrom,
  predictedNextStart,
  type CycleEntry,
  type CycleFields,
  type Flow,
  type Symptom,
} from '@/features/private/services/cycle-math';
import { useCycleSettingsStore } from '@/features/private/store/cycle-settings-store';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { confirm } from '@/lib/dialog-store';

const FLOWS: Flow[] = ['spotting', 'light', 'medium', 'heavy'];
const TINT = privateModule('cycle')?.tint ?? moduleTints.cycle;

export default function CycleScreen() {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const tint = resolveTint(TINT, scheme);
  const { t } = useTranslation();

  // Entries are held in state and reloaded explicitly rather than derived
  // from a counter: the repository read is a synchronous SQLite call, so
  // there is nothing to memoise, and a `version` dep that the body never
  // reads is exactly the kind of lie exhaustive-deps exists to catch.
  const [entries, setEntries] = useState(listCycleEntries);
  const reload = useCallback(() => setEntries(listCycleEntries()), []);
  // Every write can change the predicted next start, so the "period expected
  // soon" reminder is rebuilt right alongside the screen's own data — see
  // cycle-reminders.ts's header for why a periodic resync alone can't do
  // this (it can't see cycle data before the vault has been unlocked once).
  const reloadAndResync = useCallback(() => {
    reload();
    void syncCycleReminders();
  }, [reload]);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [symptoms, setSymptoms] = useState<Symptom[]>([]);
  const [note, setNote] = useState('');
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());

  const sheetRef = useRef<BottomSheetModal>(null);
  const [sheetTarget, setSheetTarget] = useState<CycleEntryTarget | null>(null);

  const periods = useMemo(() => periodsFrom(entries), [entries]);
  const average = useMemo(() => averageCycleLength(periods), [periods]);
  const nextStart = useMemo(() => predictedNextStart(periods, average), [periods, average]);
  const currentDay = useMemo(() => dayOfCycle(periods), [periods]);
  const fertile = useMemo(() => fertileWindow(periods, average), [periods, average]);

  const fertileWindowAck = useCycleSettingsStore((s) => s.fertileWindowAck);
  const setFertileWindowAck = useCycleSettingsStore((s) => s.setFertileWindowAck);
  const [ackPending, setAckPending] = useState(false);

  // The one-time consent gate — see cycle-settings-store.ts's header. Only
  // fires once there is actually a window to show; a person who never logs
  // three periods never sees the prompt at all. Declining does not persist
  // "no": the estimate simply stays hidden until it's shown again next visit,
  // which is the direction this feature should err on.
  useEffect(() => {
    if (!fertile || fertileWindowAck || ackPending) return;
    setAckPending(true);
    void confirm({
      title: t('private.fertileWindowConsentTitle'),
      message: t('private.fertileWindowConsentBody'),
      confirmLabel: t('private.fertileWindowConsentAccept'),
      cancelLabel: t('common.cancel'),
    }).then((ok) => {
      if (ok) setFertileWindowAck(true);
      setAckPending(false);
    });
  }, [fertile, fertileWindowAck, ackPending, t, setFertileWindowAck]);
  const suggestions = useMemo(
    () => ({
      customTags: distinctTags(entries, 'customTags'),
      medications: distinctTags(entries, 'medications'),
    }),
    [entries],
  );

  const openSheet = (target: CycleEntryTarget) => {
    setSheetTarget(target);
    sheetRef.current?.present();
  };

  const save = useCallback(() => {
    if (!flow && symptoms.length === 0 && !note.trim()) return;
    addCycleEntry({
      date: format(new Date(), 'yyyy-MM-dd'),
      flow,
      symptoms,
      mood: null,
      note: note.trim(),
      basalTempC: null,
      weightKg: null,
      medications: [],
      customTags: [],
      photoFileNames: [],
    });
    setFlow(null);
    setSymptoms([]);
    setNote('');
    reloadAndResync();
  }, [flow, symptoms, note, reloadAndResync]);

  const openMoreDetails = () => {
    openSheet({ date: format(new Date(), 'yyyy-MM-dd'), flow, symptoms, note });
  };

  const confirmDelete = (entry: CycleEntry) =>
    void confirm({
      title: t('private.deleteEntry'),
      message: t('private.deleteEntryBody'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      removeCycleEntry(entry);
      reloadAndResync();
    });

  const handleSheetSave = (fields: CycleFields, id: string | null) => {
    if (id) editCycleEntry(id, fields);
    else addCycleEntry(fields);
    reloadAndResync();
  };

  const handleSheetDelete = (entry: CycleEntry) => {
    removeCycleEntry(entry);
    reloadAndResync();
  };

  const entryForDate = (dateKey: string): CycleEntryTarget =>
    entries.find((e) => e.date === dateKey) ?? { date: dateKey };

  return (
    <PrivateScreen
      moduleId="cycle"
      title={t('private.cycleTitle')}
      subtitle={t('private.cycleSubtitle')}
      tint={tint}
      footer={
        <Button
          variant="accent"
          size="lg"
          label={t('private.logToday')}
          disabled={!flow && symptoms.length === 0 && !note.trim()}
          onPress={save}
        />
      }
    >
      <CycleHero currentDay={currentDay} averageCycleLength={average} tint={tint} />

      {nextStart ? (
        <Text variant="caption" className="px-1">
          {/* Explicitly an estimate from her own history — see cycle-math.ts
              for why this module makes no medical claims. */}
          {t('private.estimatedNext', { date: format(parseISO(nextStart), 'd MMM') })}
        </Text>
      ) : (
        <Text variant="caption" className="px-1">
          {t('private.needMoreCycles')}
        </Text>
      )}

      {fertile && fertileWindowAck ? (
        <View
          className={cardClass({ padding: 'md' }, 'gap-1.5')}
          style={{ borderColor: alpha(tint, 0.3) }}
        >
          <Text className="font-sora-medium text-foreground">
            {t('private.fertileWindowRange', {
              start: format(parseISO(fertile.start), 'd MMM'),
              end: format(parseISO(fertile.end), 'd MMM'),
            })}
          </Text>
          {/* Persistent, not a one-time dialog — see cycle-math.ts's header on
              why this notice travels with the number every time it renders. */}
          <Text variant="caption">{t('private.fertileWindowDisclaimer')}</Text>
        </View>
      ) : null}

      <CycleMonthStrip
        monthAnchor={monthAnchor}
        entries={entries}
        tint={tint}
        onSelectDate={(dateKey) => openSheet(entryForDate(dateKey))}
        onPrevMonth={() => setMonthAnchor((d) => subMonths(d, 1))}
        onNextMonth={() => setMonthAnchor((d) => addMonths(d, 1))}
      />

      {/* Today's log */}
      <View className="gap-3">
        <Text variant="micro">{t('private.flow')}</Text>
        <View className="flex-row gap-2">
          {FLOWS.map((option) => {
            const active = flow === option;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => setFlow(active ? null : option)}
                className="flex-1 items-center rounded-2xl border py-3"
                style={{
                  borderColor: active ? tint : theme.border,
                  backgroundColor: active ? alpha(tint, 0.12) : 'transparent',
                }}
              >
                <Text
                  className="font-sora-medium text-sm"
                  style={{ color: active ? tint : theme.foreground }}
                >
                  {t(`private.flow_${option}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View className="gap-3">
        <Text variant="micro">{t('private.symptoms')}</Text>
        <ChipRow
          options={SYMPTOMS}
          selected={symptoms}
          tint={tint}
          labelFor={(s) => t(`private.symptom_${s}`)}
          onToggle={(s) =>
            setSymptoms((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
          }
        />
      </View>

      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder={t('private.notePlaceholder')}
        placeholderTextColor={theme.mutedForeground}
        multiline
        className={cardClass({ padding: 'row' }, 'min-h-[88px] text-foreground')}
        style={{ fontFamily: 'Sora_400Regular', textAlignVertical: 'top' }}
      />

      <Pressable accessibilityRole="button" onPress={openMoreDetails} className="self-start px-1">
        <Text className="font-sora-medium text-sm" style={{ color: tint }}>
          {t('private.moreDetails')}
        </Text>
      </Pressable>

      {/* History */}
      {periods.length > 0 ? (
        <View className="gap-3">
          <Text variant="micro">{t('private.recentPeriods')}</Text>
          {periods.slice(0, 6).map((period) => (
            <View
              key={period.start}
              className={cardClass({ padding: 'row' }, 'flex-row items-center justify-between')}
            >
              <Text className="font-sora-medium text-foreground">
                {format(parseISO(period.start), 'd MMM yyyy')}
              </Text>
              <Text variant="caption">{t('private.days', { count: period.days })}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {entries.length > 0 ? (
        <View className="gap-3">
          <Text variant="micro">{t('private.allEntries')}</Text>
          {entries.slice(0, 20).map((entry) => (
            <Pressable
              key={entry.id}
              onPress={() => openSheet(entry)}
              onLongPress={() => confirmDelete(entry)}
              accessibilityRole="button"
              accessibilityHint={t('private.longPressDelete')}
              className={cardClass({ padding: 'row' }, 'gap-1')}
            >
              <View className="flex-row items-center justify-between">
                <Text className="font-sora-medium text-foreground">
                  {format(parseISO(entry.date), 'd MMM yyyy')}
                </Text>
                {entry.flow ? (
                  <Text variant="caption" style={{ color: tint }}>
                    {t(`private.flow_${entry.flow}`)}
                  </Text>
                ) : null}
              </View>
              {entry.symptoms.length > 0 ? (
                <Text variant="caption">
                  {entry.symptoms.map((s) => t(`private.symptom_${s}`)).join(' · ')}
                </Text>
              ) : null}
              {entry.note ? <Text variant="caption">{entry.note}</Text> : null}
              {entry.photoFileNames.length > 0 ? (
                <Text variant="caption">
                  {t('private.photoCount', { count: entry.photoFileNames.length })}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      <CycleEntrySheet
        ref={sheetRef}
        target={sheetTarget}
        tint={tint}
        suggestions={suggestions}
        onSave={handleSheetSave}
        onDelete={handleSheetDelete}
      />
    </PrivateScreen>
  );
}
