import { format } from 'date-fns';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Text } from '@/components/ui/text';
import { moduleTints, resolveTint, type TintPair } from '@/constants/design-tokens';
import { colors, habitDoneColor } from '@/constants/theme';
import type { TimelineEvent, TimelineEventType } from '@/features/timeline/types/timeline.types';
import { confirm } from '@/lib/dialog-store';

/*
 * Each event wears the design-system identity tint of the module it came from
 * (Journal violet, Water cyan, Calendar blue, Habits/Tasks' "done" green) so an
 * event's origin reads at a glance without needing a legend.
 *
 * Pairs, resolved per theme at the point of use. This map used to reach for
 * `.light` on every module tint and hardcode `#eab308` for notes, so the whole
 * timeline drew light-theme colours on a near-black ground — and the one
 * hardcoded entry was the raw yellow that runs at 1.92:1 on white, which the
 * Notes token had already been darkened away from.
 */
const TYPE_TINT: Record<TimelineEventType, TintPair> = {
  task_completed: habitDoneColor,
  task_scheduled: moduleTints.calendar,
  habit_completed: habitDoneColor,
  note_created: moduleTints.notes,
  journal_written: moduleTints.journal,
  water_logged: moduleTints.water,
  calendar_event: moduleTints.calendar,
};

type Props = {
  event: TimelineEvent;
  onDeleteCalendarEvent?: (sourceId: string) => void;
};

export function TimelineEventRow({ event, onDeleteCalendarEvent }: Props) {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  // `colorToken` is a user-chosen hex on a calendar event; the fallback is a
  // pair, so only the fallback needs resolving.
  const tint = event.colorToken ?? resolveTint(TYPE_TINT[event.type], scheme);
  const isCalendarEvent = event.type === 'calendar_event';

  const confirmDelete = () => {
    void confirm({
      title: t('timeline.deleteEventTitle'),
      message: t('timeline.deleteEventBody', { title: event.title }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      onDeleteCalendarEvent?.(event.sourceId);
    });
  };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(event.linkHref)}
      onLongPress={isCalendarEvent && onDeleteCalendarEvent ? confirmDelete : undefined}
      className="flex-row items-center gap-3 py-2.5"
    >
      <View className="w-14 items-end pe-1">
        <Text
          variant="caption"
          className="font-sora-medium"
          style={{ color: colors[scheme].mutedForeground }}
        >
          {format(event.time, 'h:mm a')}
        </Text>
        {event.endTime && (
          <Text variant="caption" style={{ color: colors[scheme].mutedForeground }}>
            – {format(event.endTime, 'h:mm a')}
          </Text>
        )}
      </View>

      <View className="items-center">
        <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tint }} />
        <View className="w-px flex-1 bg-border" />
      </View>

      <View className="flex-1 gap-0.5 pb-3">
        <View className="flex-row items-center gap-1.5">
          {event.emoji && <Text className="text-sm">{event.emoji}</Text>}
          <Text className="flex-1 font-sora-medium" numberOfLines={1}>
            {event.title}
          </Text>
        </View>
        {event.subtitle && (
          <Text variant="caption" numberOfLines={1}>
            {event.subtitle}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
