import { format, parseISO } from 'date-fns';
import { useCallback, useState } from 'react';
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
  INTIMACY_TAGS,
  addIntimacyEntry,
  listIntimacyEntries,
  removeIntimacyEntry,
  type IntimacyTag,
} from '@/features/private/services/intimacy';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { confirm } from '@/lib/dialog-store';

const TINT = privateModule('intimacy')?.tint ?? moduleTints.intimacy;

export default function IntimacyScreen() {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const tint = resolveTint(TINT, scheme);
  const { t } = useTranslation();

  // See cycle.tsx: explicit reload rather than a counter dependency.
  const [entries, setEntries] = useState(listIntimacyEntries);
  const reload = useCallback(() => setEntries(listIntimacyEntries()), []);
  const [mood, setMood] = useState<number | null>(null);
  const [tags, setTags] = useState<IntimacyTag[]>([]);
  const [note, setNote] = useState('');

  const save = useCallback(() => {
    if (mood === null && tags.length === 0 && !note.trim()) return;
    addIntimacyEntry({
      date: format(new Date(), 'yyyy-MM-dd'),
      mood,
      tags,
      note: note.trim(),
    });
    setMood(null);
    setTags([]);
    setNote('');
    reload();
  }, [mood, tags, note, reload]);

  const confirmDelete = (id: string) =>
    void confirm({
      title: t('private.deleteEntry'),
      message: t('private.deleteEntryBody'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      removeIntimacyEntry(id);
      reload();
    });

  return (
    <PrivateScreen
      title={t('private.intimacyTitle')}
      subtitle={t('private.intimacySubtitle')}
      tint={tint}
      footer={
        <Button
          variant="accent"
          size="lg"
          label={t('private.saveEntry')}
          disabled={mood === null && tags.length === 0 && !note.trim()}
          onPress={save}
        />
      }
    >
      <View className="gap-3">
        <Text variant="micro">{t('private.howWasToday')}</Text>
        <View className="flex-row gap-2">
          {[1, 2, 3, 4, 5].map((level) => {
            const active = mood === level;
            return (
              <Pressable
                key={level}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => setMood(active ? null : level)}
                className="flex-1 items-center rounded-2xl border py-3.5"
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
        <Text variant="micro">{t('private.whatHappened')}</Text>
        <ChipRow
          options={INTIMACY_TAGS}
          selected={tags}
          tint={tint}
          labelFor={(x) => t(`private.intimacyTag_${x}`)}
          onToggle={(x) =>
            setTags((prev) => (prev.includes(x) ? prev.filter((y) => y !== x) : [...prev, x]))
          }
        />
      </View>

      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder={t('private.intimacyNotePlaceholder')}
        placeholderTextColor={theme.mutedForeground}
        multiline
        className={cardClass({ padding: 'row' }, 'min-h-[120px] text-foreground')}
        style={{ fontFamily: 'Sora_400Regular', textAlignVertical: 'top' }}
      />

      {entries.length > 0 ? (
        <View className="gap-3">
          <Text variant="micro">{t('private.history')}</Text>
          {entries.slice(0, 30).map((entry) => (
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
                {entry.mood !== null ? (
                  <Text variant="caption" style={{ color: tint }}>
                    {entry.mood}/5
                  </Text>
                ) : null}
              </View>
              {entry.tags.length > 0 ? (
                <Text variant="caption">
                  {entry.tags.map((x) => t(`private.intimacyTag_${x}`)).join(' · ')}
                </Text>
              ) : null}
              {entry.note ? <Text className="text-foreground">{entry.note}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </PrivateScreen>
  );
}
