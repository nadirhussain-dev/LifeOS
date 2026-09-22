import { FlashList } from '@shopify/flash-list';
import { useMemo } from 'react';
import { View } from 'react-native';

import { formatDate } from '@/lib/date-format';
import { Text } from '@/components/ui/text';
import { COLUMNS, GAP, PhotoTile, tileSize } from '@/features/gallery/components/photo-grid';
import type { GalleryPhoto } from '@/features/gallery/types/gallery.types';

type Row =
  | { type: 'header'; key: string; month: string }
  | { type: 'photos'; key: string; items: GalleryPhoto[] };

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Virtualized photo grid — the whole library used to mount as RN Image views
 * inside a ScrollView (the app's biggest OOM/jank risk). This flattens photos
 * into recyclable rows (a month header or a row of up to 3 tiles) and renders
 * them with FlashList, so only on-screen rows are mounted, and the tiles use
 * expo-image (downsampling + disk cache) via PhotoTile.
 */
export function PhotoGridList({
  photos,
  timeline,
  onPressPhoto,
  header,
}: {
  photos: GalleryPhoto[];
  timeline?: boolean;
  onPressPhoto: (photo: GalleryPhoto) => void;
  /**
   * Content scrolled above the grid, as FlashList's own list header.
   *
   * A caller that wants something above the photos must pass it here rather
   * than wrapping this component in a ScrollView: a virtualized list inside a
   * scroll view is given unbounded height, so every row mounts and the
   * recycling that makes this component worth having stops happening. That is
   * exactly how the album screen was written before.
   */
  header?: React.ReactElement;
}) {
  const size = tileSize();

  const rows = useMemo<Row[]>(() => {
    if (!timeline) {
      return chunk(photos, COLUMNS).map((items, i) => ({ type: 'photos', key: `r${i}`, items }));
    }
    const map = new Map<string, GalleryPhoto[]>();
    for (const photo of photos) {
      const k = formatDate(photo.takenAt, 'monthYearLong');
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(photo);
    }
    const out: Row[] = [];
    for (const [month, monthPhotos] of map) {
      out.push({ type: 'header', key: `h-${month}`, month });
      chunk(monthPhotos, COLUMNS).forEach((items, i) =>
        out.push({ type: 'photos', key: `r-${month}-${i}`, items }),
      );
    }
    return out;
  }, [photos, timeline]);

  return (
    <FlashList
      data={rows}
      keyExtractor={(row) => row.key}
      getItemType={(row) => row.type}
      renderItem={({ item }) =>
        item.type === 'header' ? (
          <Text variant="sectionLabel" className="px-4 pb-1 pt-4">
            {item.month}
          </Text>
        ) : (
          <View
            style={{ flexDirection: 'row', gap: GAP, paddingHorizontal: 16, marginBottom: GAP }}
          >
            {item.items.map((photo) => (
              <PhotoTile key={photo.id} photo={photo} size={size} onPress={onPressPhoto} />
            ))}
          </View>
        )
      }
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingTop: timeline ? 0 : 16, paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
    />
  );
}
