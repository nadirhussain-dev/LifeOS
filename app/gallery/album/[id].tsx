import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { EmptyState } from '@/components/ui/empty-state';
import {
  CalendarClock,
  GitCompareArrows,
  Grid3x3,
  ImagePlus,
  Play,
  Trash2,
} from '@/components/ui/icons';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { albumCategoryMeta } from '@/features/gallery/config/album-categories';
import { AddMediaSheet } from '@/features/gallery/components/add-media-sheet';
import { PhotoGridList } from '@/features/gallery/components/photo-grid-list';
import { useAlbum, usePhotosByAlbum } from '@/features/gallery/hooks/use-gallery';
import { useGalleryMutations } from '@/features/gallery/hooks/use-gallery-mutations';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { confirm } from '@/lib/dialog-store';

export default function AlbumDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const tint = moduleTint('gallery', scheme);
  const [timeline, setTimeline] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const albumQuery = useAlbum(id);
  const photosQuery = usePhotosByAlbum(id);
  const { data: album } = albumQuery;
  const { data: photos = [] } = photosQuery;
  const { removeAlbum } = useGalleryMutations();

  const isError = albumQuery.isError || photosQuery.isError;
  const error = albumQuery.error ?? photosQuery.error;
  const retry = () => {
    void albumQuery.refetch();
    void photosQuery.refetch();
  };

  /**
   * No album and no error is the ordinary case: the read is still in flight,
   * or the album was just deleted from the header action and this screen is
   * one frame ahead of the pop. Rendering nothing is right for both.
   *
   * A *failed* read is not that. It used to land here too and leave a blank
   * screen with no header, no explanation and no way to retry — the one
   * outcome where the person has to guess whether the album is gone or the
   * app is broken. It gets its own screen, with the header omitted because
   * every field in it (the name, the category, the count) comes from the read
   * that just failed.
   */
  if (!album) {
    if (isError) {
      return (
        <View className="flex-1 bg-background">
          <ScreenHeader title={t('gallery.albumFallbackTitle')} tint={tint} />
          <QueryError error={error} onRetry={retry} />
        </View>
      );
    }
    return null;
  }

  const meta = albumCategoryMeta(album.category);

  const addPhotos = () => setAddOpen(true);

  const confirmDelete = () => {
    void confirm({
      title: t('gallery.deleteAlbumTitle'),
      message: t('gallery.deleteAlbumBody', { name: album.name }),
      confirmLabel: t('gallery.deleteAlbum'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      removeAlbum.mutate(album.id);
      router.back();
    });
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={album.name}
        eyebrow={t('gallery.albumEyebrow', {
          category: t(meta.labelKey),
          items: t('gallery.itemsCount', { count: photos.length }),
        })}
        tint={tint}
        right={
          <View className="flex-row items-center gap-4">
            <Pressable
              accessibilityRole="button"
              onPress={() => setTimeline((t) => !t)}
              hitSlop={8}
              accessibilityLabel={t('gallery.toggleTimeline')}
            >
              {timeline ? (
                <Grid3x3 size={20} color={colors[scheme].foreground} />
              ) : (
                <CalendarClock size={20} color={colors[scheme].foreground} />
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={addPhotos}
              hitSlop={8}
              accessibilityLabel={t('gallery.addPhotos')}
            >
              <ImagePlus size={20} color={colors[scheme].foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={confirmDelete}
              hitSlop={8}
              accessibilityLabel={t('gallery.deleteAlbum')}
            >
              <Trash2 size={19} color={colors[scheme].destructive} />
            </Pressable>
          </View>
        }
      />

      {isError ? (
        <QueryError error={error} onRetry={retry} />
      ) : photos.length === 0 ? (
        <EmptyState
          icon={ImagePlus}
          title={t('gallery.albumEmptyTitle')}
          description={t('gallery.albumEmptyBody')}
          tint={tint}
          actionLabel={t('gallery.addMedia')}
          onAction={addPhotos}
        />
      ) : (
        <PhotoGridList
          photos={photos}
          timeline={timeline}
          onPressPhoto={(photo) => router.push(`/gallery/photo/${photo.id}`)}
          /* Two ends and everything between: the reason a subject exists.
           * Passed as the list's own header rather than wrapped around it in a
           * ScrollView — see PhotoGridList for why that distinction is the
           * whole point of this screen's change. */
          header={
            photos.length > 1 ? (
              <View className="mb-4 flex-row gap-2.5 px-4 pt-4">
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/gallery/compare?album=${album.id}`)}
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl py-3"
                  style={{ backgroundColor: alpha(tint, 0.12) }}
                >
                  <GitCompareArrows size={16} color={tint} />
                  <Text className="font-sora-semibold" style={{ color: tint }}>
                    {t('gallery.compare')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/gallery/story/all?album=${album.id}`)}
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl border border-border py-3"
                >
                  <Play size={15} color={colors[scheme].foreground} />
                  <Text className="font-sora-semibold text-foreground">
                    {t('gallery.playProgression')}
                  </Text>
                </Pressable>
              </View>
            ) : undefined
          }
        />
      )}

      <AddMediaSheet visible={addOpen} onClose={() => setAddOpen(false)} albumId={album.id} />
    </View>
  );
}
