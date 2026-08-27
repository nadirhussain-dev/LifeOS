import { FlashList } from '@shopify/flash-list';
import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { subDays } from 'date-fns/subDays';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { ChevronBack, ChevronForward } from '@/components/ui/directional-icon';
import { Clock3, Plus } from '@/components/ui/icons';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { EmptyState } from '@/components/ui/empty-state';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { TimelineEventRow } from '@/features/timeline/components/timeline-event-row';
import { useCalendarEventMutations } from '@/features/timeline/hooks/use-calendar-event-mutations';
import { useTimelineForDate } from '@/features/timeline/hooks/use-timeline';
import { toDateKey } from '@/lib/date';

export default function TimelineScreen() {
  const { date: dateKey } = useLocalSearchParams<{ date: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();

  const date = parseISO(dateKey);
  const { data: events = [], isLoading } = useTimelineForDate(dateKey);
  const { remove } = useCalendarEventMutations();

  const goToDate = (next: Date) => router.setParams({ date: toDateKey(next) });

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('timeline.title')}
        eyebrow={t('timeline.eyebrow')}
        tint={moduleTint('calendar', scheme)}
        actions={[
          {
            icon: Plus,
            label: t('timeline.addEvent'),
            onPress: () =>
              router.push({ pathname: '/timeline/event/new', params: { date: dateKey } }),
          },
        ]}
      />

      <View className="flex-row items-center justify-between px-5 pb-3 pt-1">
        <Pressable
          accessibilityRole="button"
          onPress={() => goToDate(subDays(date, 1))}
          hitSlop={10}
          className="h-9 w-9 items-center justify-center"
        >
          <ChevronBack size={18} color={colors[scheme].mutedForeground} />
        </Pressable>
        <Text variant="subheading">{format(date, 'EEEE, MMM d')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => goToDate(addDays(date, 1))}
          hitSlop={10}
          className="h-9 w-9 items-center justify-center"
        >
          <ChevronForward size={18} color={colors[scheme].mutedForeground} />
        </Pressable>
      </View>

      {isLoading ? (
        <View className="gap-2.5 px-4">
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-14 w-full rounded-2xl" />
        </View>
      ) : events.length === 0 ? (
        <EmptyState
          icon={Clock3}
          title={t('timeline.emptyTitle')}
          description={t('timeline.emptyBody')}
        />
      ) : (
        <FlashList
          data={events}
          keyExtractor={(event) => event.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <TimelineEventRow event={item} onDeleteCalendarEvent={(id) => remove.mutate(id)} />
          )}
        />
      )}
    </View>
  );
}
