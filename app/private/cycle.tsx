import { format, parseISO } from 'date-fns';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { moduleTints, resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { ChipRow, PrivateScreen } from '@/features/private/components/private-screen';
import { privateModule } from '@/features/private/config/private-modules';
import {
  addCycleEntry,
  listCycleEntries,
  removeCycleEntry,
} from '@/features/private/services/cycle';
import {
  SYMPTOMS,
  averageCycleLength,
  dayOfCycle,
  periodsFrom,
  predictedNextStart,
  type Flow,
  type Symptom,
} from '@/features/private/services/cycle-math';
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
  const [flow, setFlow] = useState<Flow | null>(null);
  const [symptoms, setSymptoms] = useState<Symptom[]>([]);
  const [note, setNote] = useState('');

  const periods = useMemo(() => periodsFrom(entries), [entries]);
  const average = useMemo(() => averageCycleLength(periods), [periods]);
  const nextStart = useMemo(() => predictedNextStart(periods, average), [periods, average]);
  const currentDay = useMemo(() => dayOfCycle(periods), [periods]);

  const save = useCallback(() => {
    if (!flow && symptoms.length === 0 && !note.trim()) return;
    addCycleEntry({
      date: format(new Date(), 'yyyy-MM-dd'),
      flow,
      symptoms,
      mood: null,
      note: note.trim(),
    });
    setFlow(null);
    setSymptoms([]);
    setNote('');
    reload();
  }, [flow, symptoms, note, reload]);

  const confirmDelete = (id: string) =>
    void confirm({
      title: t('private.deleteEntry'),
      message: t('private.deleteEntryBody'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      removeCycleEntry(id);
      reload();
    });

  return (
    <PrivateScreen
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
      {/* Summary */}
      <View className="flex-row gap-3">
        <View
          className="flex-1 gap-1 rounded-2xl px-4 py-3.5"
          style={{ backgroundColor: alpha(tint, 0.12) }}
        >
          <Text variant="caption">{t('private.dayOfCycle')}</Text>
          <Text className="font-sora-extrabold text-2xl" style={{ color: tint }}>
            {currentDay ?? '—'}
          </Text>
        </View>
        <View className="flex-1 gap-1 rounded-2xl border border-border px-4 py-3.5">
          <Text variant="caption">{t('private.averageCycle')}</Text>
          <Text className="font-sora-extrabold text-2xl text-foreground">
            {average ? t('private.days', { count: average }) : '—'}
          </Text>
        </View>
      </View>

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
              onLongPress={() => confirmDelete(entry.id)}
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
            </Pressable>
          ))}
        </View>
      ) : null}
    </PrivateScreen>
  );
}
