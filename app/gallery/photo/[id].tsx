import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CalendarDays, Heart, Trash2, X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image } from 'expo-image';
import { Dimensions, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { GalleryVideo } from '@/features/gallery/components/gallery-video';
import { usePhoto } from '@/features/gallery/hooks/use-gallery';
import { useGalleryMutations } from '@/features/gallery/hooks/use-gallery-mutations';
import { formatDuration } from '@/features/gallery/types/gallery.types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { confirm } from '@/lib/dialog-store';

export default function PhotoDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const tint = moduleTint('gallery', scheme);
  const { data: photo } = usePhoto(id);
  const { editPhoto, toggleFavorite, removePhoto } = useGalleryMutations();

  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [showDate, setShowDate] = useState(false);
  const [seeded, setSeeded] = useState(false);

  if (photo && !seeded) {
    setCaption(photo.caption ?? '');
    setTags(photo.tags);
    setSeeded(true);
  }

  if (!photo) return null;

  const screenWidth = Dimensions.get('window').width;
  const aspect = photo.width && photo.height ? photo.width / photo.height : 1;
  const imageHeight = Math.min(screenWidth / aspect, Dimensions.get('window').height * 0.55);

  const commitCaption = () => {
    if (caption.trim() !== (photo.caption ?? ''))
      editPhoto.mutate({ id: photo.id, input: { caption: caption.trim() || null } });
  };

  const addTag = () => {
    const trimmed = tagDraft.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      const next = [...tags, trimmed];
      setTags(next);
      editPhoto.mutate({ id: photo.id, input: { tags: next } });
    }
    setTagDraft('');
  };

  const removeTag = (tag: string) => {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    editPhoto.mutate({ id: photo.id, input: { tags: next } });
  };

  const handleDate = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowDate(false);
    if (event.type === 'set' && date)
      editPhoto.mutate({ id: photo.id, input: { takenAt: date.getTime() } });
  };

  const confirmDelete = () => {
    void confirm({
      title: t('gallery.deletePhotoTitle'),
      message: t('gallery.deletePhotoBody'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      removePhoto.mutate(photo.id);
      router.back();
    });
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        eyebrow={t('gallery.title')}
        tint={tint}
        right={
          <View className="flex-row items-center gap-4">
            <Pressable
              accessibilityRole="button"
              onPress={() => toggleFavorite.mutate({ id: photo.id, isFavorite: !photo.isFavorite })}
              hitSlop={8}
              accessibilityLabel={t('gallery.favorite')}
            >
              <Heart size={22} color={tint} fill={photo.isFavorite ? tint : 'transparent'} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={confirmDelete}
              hitSlop={8}
              accessibilityLabel={t('common.delete')}
            >
              <Trash2 size={20} color={colors[scheme].destructive} />
            </Pressable>
          </View>
        }
      />

      <ScrollView
        contentContainerClassName="gap-5 pb-10"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {photo.mediaType === 'video' ? (
          <View>
            <GalleryVideo
              uri={photo.uri}
              style={{ width: screenWidth, height: imageHeight, backgroundColor: '#000000' }}
            />
            <View
              className="absolute bottom-2 end-2 rounded-md px-2 py-0.5"
              style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
            >
              <Text className="font-sora-semibold text-[11px] text-white">
                {formatDuration(photo.durationMs)}
              </Text>
            </View>
          </View>
        ) : (
          <Image
            source={{ uri: photo.uri }}
            style={{ width: screenWidth, height: imageHeight, backgroundColor: '#00000010' }}
            contentFit="contain"
            recyclingKey={photo.id}
          />
        )}

        <View className="gap-5 px-5">
          <View className={cardClass({ padding: 'row' }, 'flex-row items-center justify-between')}>
            <View className="flex-row items-center gap-2">
              <CalendarDays size={16} color={colors[scheme].mutedForeground} />
              <Text className="font-sora-medium text-foreground">{t('gallery.date')}</Text>
            </View>
            {Platform.OS === 'ios' ? (
              <DateTimePicker
                value={new Date(photo.takenAt)}
                mode="date"
                display="compact"
                onChange={handleDate}
              />
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowDate(true)}
                className="rounded-lg bg-surface px-3 py-1.5"
              >
                <Text className="font-sora-semibold text-foreground">
                  {format(photo.takenAt, 'MMM d, yyyy')}
                </Text>
              </Pressable>
            )}
          </View>
          {Platform.OS === 'android' && showDate && (
            <DateTimePicker
              value={new Date(photo.takenAt)}
              mode="date"
              display="default"
              onChange={handleDate}
            />
          )}

          <View className="gap-2">
            <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
              {t('gallery.caption')}
            </Text>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              onBlur={commitCaption}
              placeholder={t('gallery.captionPlaceholder')}
              placeholderTextColor={colors[scheme].mutedForeground}
              multiline
              className={cardClass({ padding: 'row' }, 'min-h-12 text-foreground')}
            />
          </View>

          <View className="gap-2">
            <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
              {t('gallery.tags')}
            </Text>
            <View className="flex-row flex-wrap items-center gap-2">
              {tags.map((tag) => (
                <Pressable
                  accessibilityRole="button"
                  key={tag}
                  onPress={() => removeTag(tag)}
                  className="flex-row items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5"
                >
                  <Text className="text-foreground">#{tag}</Text>
                  <X size={12} color={colors[scheme].mutedForeground} />
                </Pressable>
              ))}
              <View className="flex-row items-center rounded-full border border-dashed border-border px-3 py-1.5">
                <TextInput
                  value={tagDraft}
                  onChangeText={setTagDraft}
                  placeholder={t('gallery.addTag')}
                  placeholderTextColor={colors[scheme].mutedForeground}
                  onSubmitEditing={addTag}
                  returnKeyType="done"
                  autoCapitalize="none"
                  className="min-w-16 text-foreground"
                />
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
