import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { CalendarClock, Grid3x3, Heart, Images, Plus, Search } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Fab } from '@/components/ui/fab';
import { ScreenHeader } from '@/components/ui/screen-header';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { AddMediaSheet } from '@/features/gallery/components/add-media-sheet';
import { PhotoGridList } from '@/features/gallery/components/photo-grid-list';
import { usePhotos } from '@/features/gallery/hooks/use-gallery';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function AllPhotosScreen() {
  const { favorites: favoritesParam } = useLocalSearchParams<{ favorites?: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const tint = moduleTint('gallery', scheme);

  const { data: photos = [] } = usePhotos();
  const [timeline, setTimeline] = useState(true);
  const [favoritesOnly, setFavoritesOnly] = useState(favoritesParam === '1');
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return photos.filter((photo) => {
      if (favoritesOnly && !photo.isFavorite) return false;
      if (q) {
        const inCaption = (photo.caption ?? '').toLowerCase().includes(q);
        const inTags = photo.tags.some((tag) => tag.toLowerCase().includes(q));
        if (!inCaption && !inTags) return false;
      }
      return true;
    });
  }, [photos, favoritesOnly, query]);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={favoritesOnly ? t('gallery.favorites') : t('gallery.allPhotos')}
        eyebrow={t('gallery.title')}
        tint={tint}
        right={
          <View className="flex-row items-center gap-4">
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowSearch((s) => !s)}
              hitSlop={8}
              accessibilityLabel={t('common.search')}
            >
              <Search size={20} color={colors[scheme].foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setFavoritesOnly((f) => !f)}
              hitSlop={8}
              accessibilityLabel={t('gallery.toggleFavorites')}
            >
              <Heart
                size={20}
                color={favoritesOnly ? tint : colors[scheme].foreground}
                fill={favoritesOnly ? tint : 'transparent'}
              />
            </Pressable>
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
              onPress={() => setAddOpen(true)}
              hitSlop={8}
              accessibilityLabel={t('gallery.addMedia')}
            >
              <Plus size={22} color={colors[scheme].foreground} />
            </Pressable>
          </View>
        }
      />

      {showSearch && (
        <View className="mx-4 mb-2 flex-row items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <Search size={16} color={colors[scheme].mutedForeground} />
          <Input
            surface="bare"
            value={query}
            onChangeText={setQuery}
            placeholder={t('gallery.searchCaptionsTags')}
            autoFocus
            className="flex-1 text-foreground"
          />
        </View>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={favoritesOnly ? Heart : Images}
          title={
            favoritesOnly
              ? t('gallery.noFavoritesTitle')
              : query
                ? t('gallery.noMatchesTitle')
                : t('gallery.noPhotosTitle')
          }
          description={
            favoritesOnly
              ? t('gallery.noFavoritesBody')
              : query
                ? t('gallery.noMatchesBody')
                : t('gallery.noPhotosBody')
          }
          tint={tint}
          actionLabel={!favoritesOnly && !query ? t('gallery.addMedia') : undefined}
          onAction={!favoritesOnly && !query ? () => setAddOpen(true) : undefined}
        />
      ) : (
        <PhotoGridList
          photos={filtered}
          timeline={timeline && !query}
          onPressPhoto={(photo) => router.push(`/gallery/photo/${photo.id}`)}
        />
      )}

      {filtered.length > 0 && (
        <Fab onPress={() => setAddOpen(true)} accessibilityLabel={t('gallery.addMedia')} />
      )}

      <AddMediaSheet visible={addOpen} onClose={() => setAddOpen(false)} albumId={null} />
    </View>
  );
}
