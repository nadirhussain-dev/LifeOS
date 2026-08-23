import { useRouter } from 'expo-router';
import { Bell, Search, Settings } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useGreeting } from '@/features/dashboard/hooks/use-greeting';
import { useUnreadNotificationCount } from '@/features/notifications/hooks/use-notifications-inbox';
import { useProfileStore } from '@/features/profile/store/profile-store';

export function DashboardHeader() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const name = useProfileStore((s) => s.name);
  const { greeting, dateLabel } = useGreeting(name || undefined);
  const insets = useSafeAreaInsets();
  const unread = useUnreadNotificationCount();

  return (
    <View
      className="flex-row items-center justify-between pb-1"
      style={{ paddingTop: insets.top + 10 }}
    >
      <View className="flex-1 gap-0.5">
        <Text variant="sectionLabel">{dateLabel}</Text>
        <Text className="font-sora-extrabold text-3xl tracking-tight text-foreground">
          {greeting}
        </Text>
      </View>
      <View className="flex-row items-center gap-2">
        {/* Search sits first because it is the most-reached-for control on a
            home screen fronting twelve modules. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/search')}
          hitSlop={8}
          accessibilityLabel={t('search.title')}
          className="h-11 w-11 items-center justify-center rounded-full border border-border bg-surface"
        >
          <Search color={colors[scheme].foreground} size={20} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/notifications')}
          hitSlop={8}
          accessibilityLabel={
            unread > 0
              ? `${t('settings.notifications')}, ${t('notif.unreadCount', { count: unread })}`
              : t('settings.notifications')
          }
          className="h-11 w-11 items-center justify-center rounded-full border border-border bg-surface"
        >
          <Bell color={colors[scheme].foreground} size={20} />
          {unread > 0 && (
            <View
              /* On a round button the badge belongs on the rim, but `top-1.5
                 end-1.5` insets it from the *square* bounding box: that put its
                 centre ~11px from the centre of a 22px-radius circle — halfway
                 in, overlapping the bell glyph rather than reading as a badge
                 attached to the button. Flush to the corner puts it ~18px out,
                 riding the arc at the 45° point where the eye looks for it.

                 Flush rather than overhanging (`-top-1 -end-1`, the usual iOS
                 look): Android clips children that leave the parent's bounds
                 whatever `overflow` says, so an overhang would lose a slice of
                 the circle on exactly the device this was reported on. */
              className="absolute end-0 top-0 h-[18px] min-w-[18px] items-center justify-center rounded-full px-1"
              style={{
                backgroundColor: colors[scheme].destructive,
                // Separates the red from the button's border and the glyph
                // beneath it — without the ring they touch and read as one
                // smudged shape at this size.
                borderWidth: 2,
                borderColor: colors[scheme].background,
              }}
            >
              <Text
                // The badge is a fixed 18px box, so OS font scaling has nowhere
                // to go — the count would clip instead of growing. The label is
                // on the Pressable above, which is what a screen reader gets.
                allowFontScaling={false}
                style={{
                  color: '#ffffff',
                  fontSize: 10,
                  lineHeight: 12,
                  fontFamily: 'Sora_700Bold',
                }}
              >
                {unread > 9 ? '9+' : unread}
              </Text>
            </View>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/settings')}
          hitSlop={8}
          accessibilityLabel={t('settings.title')}
          className="h-11 w-11 items-center justify-center rounded-full border border-border bg-surface"
        >
          <Settings color={colors[scheme].foreground} size={20} />
        </Pressable>
      </View>
    </View>
  );
}
