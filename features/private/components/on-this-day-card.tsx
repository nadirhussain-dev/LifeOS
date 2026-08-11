import { Image } from 'expo-image';
import { Heart } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { decryptPhotoAsDataUri } from '@/features/private/services/album-cache';
import type { AlbumPhoto } from '@/features/private/types/shared-album.types';
import { alpha } from '@/lib/color';

type Props = {
  photo: AlbumPhoto;
  yearsAgo: number;
  albumKey: Uint8Array;
  tint: string;
  onPress: () => void;
};

/**
 * The resurfaced memory from together.ts's `onThisDay` — the small, quiet
 * nudge to look back at something together, which is most of what makes a
 * shared album worth opening on an ordinary day rather than only when
 * there's something new to add.
 */
export function OnThisDayCard({ photo, yearsAgo, albumKey, tint, onPress }: Props) {
  const { t } = useTranslation();
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!photo.remotePath) return;
    void decryptPhotoAsDataUri(photo.id, photo.remotePath, photo.mimeType, albumKey).then((u) => {
      if (!cancelled) setUri(u);
    });
    return () => {
      cancelled = true;
    };
  }, [photo.id, photo.remotePath, photo.mimeType, albumKey]);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-3 overflow-hidden rounded-2xl border"
      style={{ borderColor: alpha(tint, 0.28) }}
    >
      <View className="h-16 w-16" style={{ backgroundColor: alpha(tint, 0.12) }}>
        {uri ? (
          <Image
            source={{ uri }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="none"
          />
        ) : null}
      </View>
      <View className="flex-1 py-2 pr-3">
        <View className="flex-row items-center gap-1.5">
          <Heart size={12} color={tint} fill={tint} />
          <Text variant="caption" className="font-sora-semibold" style={{ color: tint }}>
            {t('private.onThisDay')}
          </Text>
        </View>
        <Text className="font-sora-medium text-foreground">
          {t('private.yearsAgoToday', { count: yearsAgo })}
        </Text>
      </View>
    </Pressable>
  );
}
