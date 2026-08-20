import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, TextInput, View } from 'react-native';

import { Chip } from '@/components/ui/chip';
import { Button } from '@/components/ui/button';
import { SheetHeader } from '@/components/ui/sheet-header';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { ALBUM_CATEGORIES } from '@/features/gallery/config/album-categories';
import { useGalleryMutations } from '@/features/gallery/hooks/use-gallery-mutations';
import type { AlbumCategory } from '@/features/gallery/types/gallery.types';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function NewAlbumScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const tint = moduleTint('gallery', scheme);
  const { addAlbum } = useGalleryMutations();

  const [name, setName] = useState('');
  const [category, setCategory] = useState<AlbumCategory>('gym');

  const canSave = name.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    addAlbum.mutate(
      { name: name.trim(), category },
      { onSuccess: (album) => router.replace(`/gallery/album/${album.id}`) },
    );
  };

  return (
    <View className="flex-1 bg-background">
      <SheetHeader title={t('gallery.newAlbumTitle')} />

      <ScrollView
        contentContainerClassName="gap-5 px-5 pt-3 pb-10"
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          value={name}
          onChangeText={setName}
          accessibilityLabel={t('gallery.albumName')}
          placeholder={t('gallery.albumName')}
          placeholderTextColor={colors[scheme].mutedForeground}
          autoFocus
          style={{ fontSize: 24, fontFamily: 'Sora_700Bold', color: colors[scheme].foreground }}
        />

        <View className="gap-2.5">
          <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
            {t('fields.category')}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {ALBUM_CATEGORIES.map((item) => {
              const selected = item.id === category;
              const Icon = item.icon;
              return (
                <Chip
                  key={item.id}
                  label={t(item.labelKey)}
                  selected={selected}
                  tint={tint}
                  onPress={() => setCategory(item.id)}
                  className="px-3 py-2"
                  leading={
                    <Icon
                      size={15}
                      color={selected ? '#ffffff' : colors[scheme].mutedForeground}
                      strokeWidth={2.2}
                    />
                  }
                />
              );
            })}
          </View>
        </View>

        <Button
          label={t('gallery.createAlbum')}
          onPress={save}
          disabled={!canSave}
          size="lg"
          variant="accent"
        />
      </ScrollView>
    </View>
  );
}
