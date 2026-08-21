import { useRouter } from 'expo-router';
import { StickyNote } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { WidgetCard } from '@/features/dashboard/components/widget-card';
import { WidgetEmptyState } from '@/features/dashboard/components/widget-empty-state';
import { useRecentNotes } from '@/features/dashboard/hooks/use-widget-data';
import { useRelativeTime } from '@/hooks/use-relative-time';

function NoteRow({
  title,
  snippet,
  updatedAt,
}: {
  title: string;
  snippet: string;
  updatedAt: Date;
}) {
  const relativeTime = useRelativeTime(updatedAt);
  return (
    <View className="gap-0.5">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 font-sora-medium" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="caption" numberOfLines={1}>
          {relativeTime}
        </Text>
      </View>
      <Text variant="muted" numberOfLines={2}>
        {snippet}
      </Text>
    </View>
  );
}

export function RecentNotesWidget() {
  const router = useRouter();
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useRecentNotes();

  return (
    <WidgetCard
      error={error}
      onRetry={refetch}
      icon={StickyNote}
      title={t('dashboard.recentNotes')}
      actionLabel={t('dashboard.viewAll')}
      onActionPress={() => router.push('/notes')}
    >
      {isLoading || !data ? (
        <View className="gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </View>
      ) : data.notes.length === 0 ? (
        <WidgetEmptyState
          message={t('dashboard.noNotesYet')}
          actionLabel={t('dashboard.addNote')}
          onAction={() => router.push('/note/new')}
        />
      ) : (
        <View className="gap-3">
          {data.notes.map((note) => (
            <Pressable
              accessibilityRole="button"
              key={note.id}
              onPress={() => router.push(`/note/${note.id}`)}
            >
              <NoteRow title={note.title} snippet={note.snippet} updatedAt={note.updatedAt} />
            </Pressable>
          ))}
        </View>
      )}
    </WidgetCard>
  );
}
