import { useRouter } from 'expo-router';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { X } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = {
  title: string;
  /** Defaults to router.back() — dismisses the modal. */
  onClose?: () => void;
  /** Optional trailing control (e.g. a pin toggle or a delete when editing).
   *  Omit to keep the title optically centered against the close chip. */
  right?: ReactNode;
};

/**
 * The header every presented modal / form sheet wears. Sibling to
 * `ScreenHeader`: where a pushed screen gets a back chevron, a modal gets a
 * centered title flanked by an ✕ close chip — the conventional "dismiss, don't
 * go back" affordance. Replaces the hand-rolled `insets.top + 12` + ✕ blocks
 * that had drifted apart across the form screens (title `micro` vs `caption`,
 * `bg-surface` vs `bg-muted`, `px-4` vs `px-5`).
 */
export function SheetHeader({ title, onClose, right }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const c = colors[scheme];

  const handleClose = onClose ?? (() => router.back());

  return (
    <View
      style={{ paddingTop: insets.top + 12 }}
      className="flex-row items-center justify-between px-5 pb-2"
    >
      <Pressable
        onPress={handleClose}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        className="h-9 w-9 items-center justify-center rounded-full border border-border bg-surface"
      >
        <X size={18} color={c.foreground} />
      </Pressable>

      <Text
        className="font-sora-semibold uppercase text-foreground"
        style={{ fontSize: 12, letterSpacing: 0.6 }}
        numberOfLines={1}
      >
        {title}
      </Text>

      {right ? (
        <View className="h-9 min-w-[36px] items-end justify-center">{right}</View>
      ) : (
        <View className="h-9 w-9" />
      )}
    </View>
  );
}
