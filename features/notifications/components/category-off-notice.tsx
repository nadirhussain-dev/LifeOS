import { useRouter } from 'expo-router';
import { BellOff } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, View } from 'react-native';

import { ChevronForward } from '@/components/ui/directional-icon';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useNotificationsStore } from '@/features/notifications/store/notifications-store';
import {
  CATEGORY_META,
  type NotificationCategory,
} from '@/features/notifications/types/notification.types';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Shown on a per-module reminder screen (Water, Journal, Sleep bedtime) when
 * something upstream means its reminders cannot fire, however its own toggle
 * reads: the OS permission has been revoked, the master switch is off, or the
 * category is off. Without it a module's "Reminders" toggle can sit there
 * saying ON while nothing ever arrives.
 *
 * The revoked-permission case is the one that gives no other signal at all.
 * Both switches are app state the user set deliberately and can see in
 * Settings; permission is set *outside* the app, can be taken away months
 * later, and silently kills every reminder in every module at once. That one
 * sends the user to system settings — the app's own screen cannot fix it.
 *
 * Renders nothing when reminders can actually fire.
 */
export function CategoryOffNotice({ category }: { category: NotificationCategory }) {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const theme = colors[scheme];
  const masterEnabled = useNotificationsStore((s) => s.masterEnabled);
  const categoryOn = useNotificationsStore((s) => s.categories[category] ?? true);
  // Strictly false, not falsy: null means the first check has not come back
  // yet, and claiming notifications are blocked during launch would be a
  // scare that resolves itself a moment later.
  const permissionRevoked = useNotificationsStore((s) => s.systemPermissionGranted === false);

  if (masterEnabled && categoryOn && !permissionRevoked) return null;

  const title = permissionRevoked
    ? t('notif.systemOff')
    : !masterEnabled
      ? t('notif.allOff')
      : t('notif.categoryOff', { category: t(CATEGORY_META[category].labelKey) });

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        permissionRevoked ? void Linking.openSettings() : router.push('/settings/notifications')
      }
      className="flex-row items-center gap-3 rounded-2xl border p-3.5"
      style={{ borderColor: theme.border, backgroundColor: theme.muted }}
    >
      <BellOff size={18} color={theme.mutedForeground} />
      <View className="flex-1">
        <Text className="font-sora-medium text-foreground">{title}</Text>
        <Text variant="caption">
          {permissionRevoked ? t('notif.openSystemSettings') : t('notif.categoryOffBody')}
        </Text>
      </View>
      <ChevronForward size={18} color={theme.mutedForeground} />
    </Pressable>
  );
}
