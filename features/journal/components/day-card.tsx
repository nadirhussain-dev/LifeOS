import { format } from 'date-fns/format';
import { isToday } from 'date-fns/isToday';
import { parseISO } from 'date-fns/parseISO';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { resolveTint } from '@/constants/design-tokens';
import { MOOD_EMOJI, MOOD_TINT } from '@/features/journal/constants';
import type { JournalEntry } from '@/features/journal/types/journal.types';

type Props = {
  entry: JournalEntry;
  onPress: () => void;
};

export function DayCard({ entry, onPress }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const date = parseISO(entry.entryDate);
  const snippet = entry.body.trim().slice(0, 90);
  const tint = entry.mood
    ? resolveTint(MOOD_TINT[entry.mood], scheme)
    : colors[scheme].mutedForeground;

  return (
    <View style={styles.shadowWrap}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        className={cardClass({ padding: 'rowLg' }, 'flex-row items-center gap-3')}
      >
        <View className="w-11 items-center">
          <Text variant="micro" className="font-sora-semibold">
            {format(date, 'EEE')}
          </Text>
          <Text style={{ fontSize: 20 }} className="font-sora-bold text-foreground">
            {format(date, 'd')}
          </Text>
        </View>

        <View
          className="h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: `${tint}1f` }}
        >
          <Text className="text-lg">{entry.mood ? MOOD_EMOJI[entry.mood] : '·'}</Text>
        </View>

        <View className="flex-1 gap-0.5">
          <Text
            numberOfLines={1}
            className={
              snippet
                ? 'font-journal text-[15px]'
                : 'font-journal-italic text-[15px] text-muted-foreground'
            }
          >
            {snippet || t('journal.noReflection')}
          </Text>
          {isToday(date) && <Text variant="caption">{t('common.today')}</Text>}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  shadowWrap: {
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 18,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 0 },
    }),
  },
});
