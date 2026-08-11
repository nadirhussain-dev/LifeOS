import { useRouter } from 'expo-router';
import { GitCompareArrows, Images, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dimensions, Pressable, ScrollView, View } from 'react-native';

import { EmptyState } from '@/components/ui/empty-state';
import { Fab } from '@/components/ui/fab';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { AdSlot } from '@/features/ads/components/ad-slot';
import { AddMediaSheet } from '@/features/gallery/components/add-media-sheet';
import { GAP, PhotoTile } from '@/features/gallery/components/photo-grid';
import { SubjectCard } from '@/features/gallery/components/subject-card';
import { useAlbums, usePhotos } from '@/features/gallery/hooks/use-gallery';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Newest media shown on the home screen before "All photos" takes over. */
const RECENT_COUNT = 6;
/** This screen pads by px-5; the shared `tileSize()` assumes 16, which would
 *  overflow the row by 8px and wrap the third tile. */
const H_PADDING = 20;
const RECENT_COLUMNS = 3;

/**
 * Progress home — a transformation tracker.
 *
 * The screen answers one question: what has changed? So tracked subjects come
 * first, each card carrying its own before/after, and everything else is a
 * quiet route into the archive.
 *
 * The previous home stacked a hero, story reels, three rainbow tiles, a feed
 * preview and an album grid — five patterns competing before the user had done
 * anything, wrapped in social affordances (a feed, likes, "You" bylines) that a
 * single-user photo journal has no audience for.
 */
export default function GalleryScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const [addOpen, setAddOpen] = useState(false);

  const { data: albums = [], isLoading } = useAlbums();
  const { data: photos = [] } = usePhotos();

  const tint = moduleTint('gallery', scheme);
  const recent = photos.slice(0, RECENT_COUNT);
  const size =
    (Dimensions.get('window').width - H_PADDING * 2 - GAP * (RECENT_COLUMNS - 1)) / RECENT_COLUMNS;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('gallery.title')}
        eyebrow={t('gallery.eyebrow')}
        tint={tint}
        actions={
          photos.length > 1
            ? [
                {
                  icon: GitCompareArrows,
                  label: t('gallery.beforeAfter'),
                  onPress: () => router.push('/gallery/compare'),
                },
              ]
            : undefined
        }
      />

      {isLoading ? (
        <View className="gap-3 px-5 pt-2">
          <Skeleton className="h-52 w-full rounded-2xl" />
          <Skeleton className="h-52 w-full rounded-2xl" />
        </View>
      ) : albums.length === 0 && photos.length === 0 ? (
        <EmptyState
          icon={Images}
          title={t('gallery.emptyTitle')}
          description={t('gallery.emptyBody')}
          tint={tint}
          actionLabel={t('gallery.newSubject')}
          onAction={() => router.push('/gallery/album/new')}
        />
      ) : (
        <ScrollView
          contentContainerClassName="gap-6 px-5 pb-28 pt-1"
          showsVerticalScrollIndicator={false}
        >
          {/* What you're tracking — the module's primary object. */}
          <View className="gap-3">
            <SectionHeader title={t('gallery.tracking')} />
            {albums.map((album) => (
              <SubjectCard
                key={album.id}
                album={album}
                onPress={(a) => router.push(`/gallery/album/${a.id}`)}
                onCompare={(a) => router.push(`/gallery/compare?album=${a.id}`)}
              />
            ))}
            <Pressable
              onPress={() => router.push('/gallery/album/new')}
              accessibilityRole="button"
              className="flex-row items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-3.5"
            >
              <Plus size={16} color={colors[scheme].mutedForeground} />
              <Text variant="muted" className="font-sora-medium">
                {t('gallery.newSubject')}
              </Text>
            </Pressable>
          </View>

          {/* The archive, one tap away — no separate "feed" destination. */}
          {recent.length > 0 && (
            <View className="gap-3">
              <SectionHeader
                title={t('gallery.recent')}
                actionLabel={t('gallery.allPhotos')}
                actionTint={tint}
                onAction={() => router.push('/gallery/all')}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
                {recent.map((photo) => (
                  <PhotoTile
                    key={photo.id}
                    photo={photo}
                    size={size}
                    onPress={(p) => router.push(`/gallery/photo/${p.id}`)}
                  />
                ))}
              </View>
            </View>
          )}

          <AdSlot placement="gallery-bottom" />
        </ScrollView>
      )}

      <Fab onPress={() => setAddOpen(true)} accessibilityLabel={t('gallery.addMedia')} />

      <AddMediaSheet visible={addOpen} onClose={() => setAddOpen(false)} albumId={null} />
    </View>
  );
}
