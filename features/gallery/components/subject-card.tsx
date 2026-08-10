import { differenceInCalendarDays, format } from 'date-fns';
import { Image } from 'expo-image';
import { GitCompareArrows, ImagePlus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { ArrowForward } from '@/components/ui/directional-icon';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { albumCategoryMeta } from '@/features/gallery/config/album-categories';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import type { AlbumWithCover } from '@/features/gallery/types/gallery.types';

type Props = {
  album: AlbumWithCover;
  onPress: (album: AlbumWithCover) => void;
  onCompare: (album: AlbumWithCover) => void;
};

/** One thumbnail end of the transformation, with the date it was taken. */
function End({ uri, takenAt, label }: { uri: string; takenAt: number; label: string }) {
  return (
    <View className="flex-1 gap-1.5">
      <View className="aspect-[3/4] overflow-hidden rounded-xl bg-surface">
        <Image
          source={{ uri }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          recyclingKey={uri}
          transition={150}
        />
      </View>
      <View>
        <Text variant="micro">{label}</Text>
        <Text variant="caption" className="font-sora-medium text-foreground">
          {format(takenAt, 'MMM d, yyyy')}
        </Text>
      </View>
    </View>
  );
}

/**
 * A tracked subject — the module's primary object now that Progress is a
 * transformation tracker rather than a feed.
 *
 * The card *is* the before/after: the album's oldest and newest media sit side
 * by side with the elapsed span between them, so the thing the module exists to
 * show is visible without navigating anywhere. Chrome stays neutral so the two
 * photographs carry the color; the Progress tint appears only on Compare.
 */
export function SubjectCard({ album, onPress, onCompare }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const tint = moduleTint('gallery', scheme);
  const Icon = albumCategoryMeta(album.category).icon;

  const hasBothEnds =
    album.firstUri != null &&
    album.latestUri != null &&
    album.firstTakenAt != null &&
    album.latestTakenAt != null &&
    album.photoCount > 1;

  const spanDays = hasBothEnds
    ? Math.max(0, differenceInCalendarDays(album.latestTakenAt!, album.firstTakenAt!))
    : 0;

  return (
    <Pressable
      onPress={() => onPress(album)}
      accessibilityRole="button"
      accessibilityLabel={album.name}
      className={cardClass({ padding: 'sm' }, 'gap-3')}
    >
      <View className="flex-row items-center gap-2">
        <Icon size={15} color={colors[scheme].mutedForeground} />
        <Text className="flex-1 font-sora-semibold text-foreground" numberOfLines={1}>
          {album.name}
        </Text>
        {hasBothEnds ? (
          <Text variant="caption" className="font-sora-semibold" style={{ color: tint }}>
            {t('gallery.spanDays', { count: spanDays })}
          </Text>
        ) : null}
      </View>

      {hasBothEnds ? (
        <>
          <View className="flex-row items-center gap-2.5">
            <End uri={album.firstUri!} takenAt={album.firstTakenAt!} label={t('gallery.start')} />
            <ArrowForward size={16} color={colors[scheme].mutedForeground} />
            <End
              uri={album.latestUri!}
              takenAt={album.latestTakenAt!}
              label={t('gallery.latest')}
            />
          </View>

          <View className="flex-row items-center justify-between">
            <Text variant="caption">{t('gallery.itemsCount', { count: album.photoCount })}</Text>
            <Pressable
              onPress={() => onCompare(album)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('gallery.compare')}
              className="flex-row items-center gap-1.5 rounded-full px-3 py-1.5"
              style={{ backgroundColor: alpha(tint, 0.12) }}
            >
              <GitCompareArrows size={14} color={tint} />
              <Text variant="caption" className="font-sora-semibold" style={{ color: tint }}>
                {t('gallery.compare')}
              </Text>
            </Pressable>
          </View>
        </>
      ) : (
        /* One photo or none: there is no "change" to show yet, so the card asks
           for the second data point instead of faking a before/after. */
        <View className="flex-row items-center gap-3">
          {album.latestUri ? (
            <View className="h-16 w-16 overflow-hidden rounded-xl bg-surface">
              <Image
                source={{ uri: album.latestUri }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                recyclingKey={album.latestUri}
              />
            </View>
          ) : (
            <View className="h-16 w-16 items-center justify-center rounded-xl border border-dashed border-border">
              <ImagePlus size={20} color={colors[scheme].mutedForeground} />
            </View>
          )}
          <Text variant="caption" className="flex-1">
            {album.photoCount === 0 ? t('gallery.subjectEmpty') : t('gallery.subjectNeedsSecond')}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
