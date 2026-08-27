import { useTranslation } from 'react-i18next';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Camera, ImagePlus, Video, X, type LucideIcon } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import {
  PermissionDeniedError,
  useGalleryMutations,
} from '@/features/gallery/hooks/use-gallery-mutations';
import {
  MAX_VIDEO_MB,
  type MediaKind,
  type MediaSource,
} from '@/features/gallery/services/gallery-storage';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { notify } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Album these captures are filed under (null = unfiled / All Photos). */
  albumId: string | null;
};

type Option = {
  key: string;
  labelKey: string;
  hintKey: string;
  icon: LucideIcon;
  source: MediaSource;
  mediaTypes: MediaKind[];
};

const OPTIONS: Option[] = [
  {
    key: 'photo',
    labelKey: 'gallery.takePhoto',
    hintKey: 'gallery.takePhotoHint',
    icon: Camera,
    source: 'camera',
    mediaTypes: ['images'],
  },
  {
    key: 'video',
    labelKey: 'gallery.recordVideo',
    hintKey: 'gallery.recordVideoHint',
    icon: Video,
    source: 'camera',
    mediaTypes: ['videos'],
  },
  {
    key: 'library',
    labelKey: 'gallery.chooseLibrary',
    hintKey: 'gallery.chooseLibraryHint',
    icon: ImagePlus,
    source: 'library',
    mediaTypes: ['images', 'videos'],
  },
];

/** Bottom-sheet menu for adding progress media — three big source options
 * (take photo, record video, import). Owns the whole import flow: permission
 * prompts, and the "skipped an oversized video" notice. */
export function AddMediaSheet({ visible, onClose, albumId }: Props) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const tint = moduleTint('gallery', scheme);
  const { importMedia } = useGalleryMutations();

  const run = (option: Option) => {
    onClose();
    importMedia.mutate(
      { albumId, source: option.source, mediaTypes: option.mediaTypes },
      {
        onSuccess: (result) => {
          if (result.rejectedOversize > 0) {
            toast.error(
              t('gallery.videoTooLargeBody', {
                count: result.rejectedOversize,
                mb: MAX_VIDEO_MB,
              }),
            );
          }
        },
        onError: (error) => {
          if (error instanceof PermissionDeniedError) {
            // A notice rather than a toast: the fix is in system settings, and a
            // message that disappears takes the instruction with it.
            void notify({
              title:
                option.source === 'camera'
                  ? t('gallery.cameraAccessTitle')
                  : t('gallery.photoAccessTitle'),
              message:
                option.source === 'camera'
                  ? t('gallery.cameraAccessBody')
                  : t('gallery.photoAccessBody'),
              confirmLabel: t('common.ok'),
            });
          }
        },
      },
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        accessibilityRole="button"
        className="flex-1"
        style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        onPress={onClose}
      >
        <View className="flex-1 justify-end">
          <Pressable
            accessibilityRole="button"
            onPress={(e) => e.stopPropagation()}
            style={{ paddingBottom: insets.bottom + 12 }}
            className="gap-2 rounded-t-3xl bg-card px-5 pt-3"
          >
            <View
              className="mb-1 h-1 w-10 self-center rounded-full"
              style={{ backgroundColor: colors[scheme].border }}
            />
            <View className="flex-row items-center justify-between pb-1">
              <Text variant="subheading">{t('gallery.addToProgress')}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                hitSlop={8}
                className="h-8 w-8 items-center justify-center rounded-full border border-border bg-surface"
              >
                <X size={16} color={colors[scheme].foreground} />
              </Pressable>
            </View>

            {OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <Pressable
                  accessibilityRole="button"
                  key={option.key}
                  onPress={() => run(option)}
                  className="flex-row items-center gap-3.5 rounded-2xl border border-border p-3.5"
                >
                  <View
                    className="h-11 w-11 items-center justify-center rounded-xl"
                    style={{ backgroundColor: alpha(tint, 0.14) }}
                  >
                    <Icon size={21} color={tint} />
                  </View>
                  <View className="flex-1">
                    <Text className="font-sora-semibold text-foreground">{t(option.labelKey)}</Text>
                    <Text variant="caption">{t(option.hintKey, { mb: MAX_VIDEO_MB })}</Text>
                  </View>
                </Pressable>
              );
            })}
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
