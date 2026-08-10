import { format, parseISO } from 'date-fns';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { moduleTints, resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { ChipRow, PrivateScreen } from '@/features/private/components/private-screen';
import { privateModule } from '@/features/private/config/private-modules';
import {
  addRecoveryEntry,
  listRecoveryEntries,
  removeRecoveryEntry,
} from '@/features/private/services/recovery';
import {
  TRIGGERS,
  statsFor,
  type RecoveryTarget,
  type Trigger,
} from '@/features/private/services/recovery-math';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { confirm } from '@/lib/dialog-store';

const TARGETS: RecoveryTarget[] = [
  'porn',
  'masturbation',
  'alcohol',
  'smoking',
  'vaping',
  'gambling',
  'other',
];
const TINT = privateModule('recovery')?.tint ?? moduleTints.recovery;

export default function RecoveryScreen() {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const tint = resolveTint(TINT, scheme);
  const { t } = useTranslation();

  // See cycle.tsx: explicit reload rather than a counter dependency.
  const [entries, setEntries] = useState(listRecoveryEntries);
  const reload = useCallback(() => setEntries(listRecoveryEntries()), []);
  const [target, setTarget] = useState<RecoveryTarget>('porn');
  const [intensity, setIntensity] = useState(3);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [note, setNote] = useState('');

  const stats = useMemo(() => statsFor(entries, target), [entries, target]);

  const log = useCallback(
    (outcome: 'resisted' | 'relapsed') => {
      addRecoveryEntry({
        target,
        date: format(new Date(), 'yyyy-MM-dd'),
        outcome,
        intensity,
        triggers,
        note: note.trim(),
      });
      setTriggers([]);
      setNote('');
      setIntensity(3);
      reload();
    },
    [target, intensity, triggers, note, reload],
  );

  const confirmDelete = (id: string) =>
    void confirm({
      title: t('private.deleteEntry'),
      message: t('private.deleteEntryBody'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      removeRecoveryEntry(id);
      reload();
    });

  const forTarget = entries.filter((e) => e.target === target);

  return (
    <PrivateScreen
      title={t('private.recoveryTitle')}
      subtitle={t('private.recoverySubtitle')}
      tint={tint}
      footer={
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button
              variant="accent"
              size="lg"
              label={t('private.resisted')}
              onPress={() => log('resisted')}
            />
          </View>
          <View className="flex-1">
            {/* Not styled as a failure. A relapse being easy and unjudged to
                record is the difference between honest data and a deleted app. */}
            <Button
              variant="secondary"
              size="lg"
              label={t('private.relapsed')}
              onPress={() => log('relapsed')}
            />
          </View>
        </View>
      }
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-5">
        <View className="flex-row gap-2 px-5">
          {TARGETS.map((option) => {
            const active = target === option;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => setTarget(option)}
                className="rounded-full border px-4 py-2"
                style={{
                  borderColor: active ? tint : theme.border,
                  backgroundColor: active ? alpha(tint, 0.12) : 'transparent',
                }}
              >
                <Text
                  className="font-sora-medium text-sm"
                  style={{ color: active ? tint : theme.foreground }}
                >
                  {t(`private.target_${option}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View className="flex-row gap-3">
        <View
          className="flex-1 gap-1 rounded-2xl px-4 py-3.5"
          style={{ backgroundColor: alpha(tint, 0.12) }}
        >
          <Text variant="caption">{t('private.currentStreak')}</Text>
          <Text className="font-sora-extrabold text-2xl" style={{ color: tint }}>
            {stats.currentStreak === null
              ? t('private.noRelapses')
              : t('private.days', { count: stats.currentStreak })}
          </Text>
        </View>
        <View className="flex-1 gap-1 rounded-2xl border border-border px-4 py-3.5">
          <Text variant="caption">{t('private.longestStreak')}</Text>
          <Text className="font-sora-extrabold text-2xl text-foreground">
            {t('private.days', { count: stats.longestStreak })}
          </Text>
        </View>
      </View>

      <View className="flex-row gap-3">
        <View className="flex-1 gap-1 rounded-2xl border border-border px-4 py-3">
          <Text variant="caption">{t('private.urgesResisted')}</Text>
          <Text className="font-sora-semibold text-lg text-foreground">{stats.resisted}</Text>
        </View>
        <View className="flex-1 gap-1 rounded-2xl border border-border px-4 py-3">
          <Text variant="caption">{t('private.relapsesLogged')}</Text>
          <Text className="font-sora-semibold text-lg text-foreground">{stats.relapsed}</Text>
        </View>
      </View>

      {stats.topRelapseTriggers.length > 0 ? (
        <View className={cardClass({ padding: 'rowLg' }, 'gap-2')}>
          <Text variant="micro">{t('private.watchFor')}</Text>
          <Text className="text-foreground">
            {stats.topRelapseTriggers.map((x) => t(`private.trigger_${x.trigger}`)).join(' · ')}
          </Text>
          <Text variant="caption">{t('private.watchForHint')}</Text>
        </View>
      ) : null}

      <View className="gap-3">
        <Text variant="micro">{t('private.howStrong')}</Text>
        <View className="flex-row gap-2">
          {[1, 2, 3, 4, 5].map((level) => {
            const active = intensity === level;
            return (
              <Pressable
                key={level}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => setIntensity(level)}
                className="flex-1 items-center rounded-2xl border py-3"
                style={{
                  borderColor: active ? tint : theme.border,
                  backgroundColor: active ? alpha(tint, 0.12) : 'transparent',
                }}
              >
                <Text
                  className="font-sora-medium"
                  style={{ color: active ? tint : theme.foreground }}
                >
                  {level}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View className="gap-3">
        <Text variant="micro">{t('private.triggers')}</Text>
        <ChipRow
          options={TRIGGERS}
          selected={triggers}
          tint={tint}
          labelFor={(x) => t(`private.trigger_${x}`)}
          onToggle={(x) =>
            setTriggers((prev) => (prev.includes(x) ? prev.filter((y) => y !== x) : [...prev, x]))
          }
        />
      </View>

      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder={t('private.notePlaceholder')}
        placeholderTextColor={theme.mutedForeground}
        multiline
        className={cardClass({ padding: 'row' }, 'min-h-[80px] text-foreground')}
        style={{ fontFamily: 'Sora_400Regular', textAlignVertical: 'top' }}
      />

      {forTarget.length > 0 ? (
        <View className="gap-3">
          <Text variant="micro">{t('private.history')}</Text>
          {forTarget.slice(0, 20).map((entry) => (
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
                <Text
                  variant="caption"
                  style={{ color: entry.outcome === 'resisted' ? tint : theme.mutedForeground }}
                >
                  {t(`private.${entry.outcome}`)}
                </Text>
              </View>
              {entry.triggers.length > 0 ? (
                <Text variant="caption">
                  {entry.triggers.map((x) => t(`private.trigger_${x}`)).join(' · ')}
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
