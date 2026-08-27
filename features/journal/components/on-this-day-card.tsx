import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { preview, type OnThisDayEntry } from '@/features/journal/services/on-this-day';
import { useTheme } from '@/hooks/use-theme';

/**
 * Your own words, from this date in earlier years.
 *
 * The one thing in the app that gives something back without being asked. A
 * journal that only ever writes is a drawer — everything goes one way and the
 * reason to open it tomorrow is duty. This is the reason that isn't duty.
 *
 * Deliberately restrained, because the content is doing the work:
 *
 *   - **Nothing renders when there is no history.** An "on this day" card that
 *     says "nothing yet" every day for a year is a daily reminder that the
 *     feature is empty, which is worse than no card. It appears the first day
 *     it has something, and that arrival is itself a small event.
 *   - **The year is the loudest thing on the card.** "1 year ago" is the hook;
 *     the body is the payoff. Reversing that makes it look like a list of old
 *     entries, which is what a journal already is.
 *   - **No mood chips, no metrics, no actions.** Everything the entry knows is
 *     one tap away on the entry itself. A memory rendered as a dashboard row is
 *     not a memory.
 */

type Props = {
  entries: OnThisDayEntry[];
};

export function OnThisDayCard({ entries }: Props) {
  const { t } = useTranslation();
  const { c, tint } = useTheme();
  const router = useRouter();

  if (entries.length === 0) return null;

  return (
    <View className={cardClass({ padding: 'md' }, 'gap-3')}>
      <Text variant="micro" style={{ color: tint('journal') }}>
        {t('journal.onThisDayTitle')}
      </Text>

      {entries.map(({ entry, yearsAgo }, index) => {
        const body = preview(entry.body);
        return (
          <Pressable
            key={entry.id}
            accessibilityRole="button"
            onPress={() => router.push(`/journal/${entry.entryDate}`)}
            className="gap-1 py-1"
            style={
              index > 0
                ? { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 }
                : undefined
            }
          >
            <View className="flex-row items-baseline justify-between gap-3">
              <Text className="font-sora-semibold" style={{ color: c.foreground }}>
                {yearsAgo === 1
                  ? t('journal.onThisDayYear')
                  : t('journal.onThisDayYears', { count: yearsAgo })}
              </Text>
              <Text variant="caption">{format(parseISO(entry.entryDate), 'd MMM yyyy')}</Text>
            </View>

            {/* An entry can be a mood with no words. Showing an empty line under
                the year would read as a rendering fault rather than a quiet day. */}
            {body.length > 0 ? <Text variant="muted">{body}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
