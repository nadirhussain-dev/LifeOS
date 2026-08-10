import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'expo-router';
import { BellOff, CheckCheck, Clock, Trash2 } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { ScreenHeader } from '@/components/ui/screen-header';
import { moduleTints } from '@/constants/design-tokens';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import {
  useNotificationActions,
  useNotificationInbox,
} from '@/features/notifications/hooks/use-notifications-inbox';
import {
  CATEGORY_META,
  FALLBACK_NOTIFICATION_ICON,
  type LoggedNotification,
} from '@/features/notifications/types/notification.types';
import { notificationStatus } from '@/features/notifications/services/notification-status';
import { alpha } from '@/lib/color';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { confirm } from '@/lib/dialog-store';

function NotificationRow({
  item,
  onPress,
  onDelete,
}: {
  item: LoggedNotification;
  onPress: () => void;
  onDelete: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const theme = colors[scheme];
  const meta = CATEGORY_META[item.category];
  const Icon = meta?.icon ?? FALLBACK_NOTIFICATION_ICON;
  const tint = meta?.tint ?? theme.accent;
  const status = notificationStatus(item, Date.now());
  const unread = status === 'delivered' && !item.readAt;

  const timeLabel =
    status === 'scheduled'
      ? item.repeats === 'daily'
        ? t('notif.dailyReminder')
        : t('notif.inTime', { time: formatDistanceToNow(item.scheduledAt) })
      : formatDistanceToNow(item.scheduledAt, { addSuffix: true });

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onLongPress={onDelete}
      className="flex-row items-start gap-3 rounded-2xl border border-border p-3.5"
      style={{ backgroundColor: unread ? alpha(tint, 0.08) : theme.card }}
    >
      <View
        className="h-10 w-10 items-center justify-center rounded-xl"
        style={{ backgroundColor: alpha(tint, 0.15) }}
      >
        <Icon size={18} color={tint} />
      </View>
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 font-sora-semibold text-foreground" numberOfLines={1}>
            {item.title}
          </Text>
          {unread && <View className="h-2 w-2 rounded-full" style={{ backgroundColor: tint }} />}
        </View>
        {!!item.body && (
          <Text variant="muted" numberOfLines={2}>
            {item.body}
          </Text>
        )}
        <View className="mt-1 flex-row items-center gap-1.5">
          {status === 'scheduled' && <Clock size={11} color={theme.mutedForeground} />}
          <Text variant="caption">{timeLabel}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text variant="caption" className="px-1 font-sora-semibold uppercase tracking-wide">
      {children}
    </Text>
  );
}

export default function NotificationsInboxScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const theme = colors[scheme];
  const { notifications } = useNotificationInbox();
  const { markRead, markAllRead, remove, clearAll } = useNotificationActions();

  const { upcoming, recent, hasUnread } = useMemo(() => {
    const now = Date.now();
    const up: LoggedNotification[] = [];
    const rec: LoggedNotification[] = [];
    let unread = false;
    for (const n of notifications) {
      const status = notificationStatus(n, now);
      if (status === 'scheduled') up.push(n);
      else {
        rec.push(n);
        if (!n.readAt) unread = true;
      }
    }
    return { upcoming: up, recent: rec, hasUnread: unread };
  }, [notifications]);

  const handlePress = (item: LoggedNotification) => {
    if (!item.readAt) markRead.mutate(item.id);
    if (item.route) {
      router.push({ pathname: item.route as never, params: (item.params ?? {}) as never });
    }
  };

  const confirmClear = () => {
    void confirm({
      title: t('notif.clearAllTitle'),
      message: t('notif.clearAllBody'),
      confirmLabel: t('notif.clear'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      clearAll.mutate();
    });
  };

  if (notifications.length === 0) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader
          title={t('notif.title')}
          eyebrow={t('notif.inboxEyebrow')}
          tint={moduleTints.settings}
        />
        <View className="flex-1 items-center justify-center gap-3 p-8">
          <View
            className="h-16 w-16 items-center justify-center rounded-2xl"
            style={{ backgroundColor: theme.muted }}
          >
            <BellOff size={28} color={theme.mutedForeground} />
          </View>
          <Text className="font-sora-semibold text-lg text-foreground">
            {t('notif.emptyTitle')}
          </Text>
          <Text variant="muted" className="text-center">
            {t('notif.emptyBody')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('notif.title')}
        eyebrow={t('notif.inboxEyebrow')}
        tint={moduleTints.settings}
      />
      <ScrollView
        contentContainerClassName="gap-5 px-5 py-4 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            onPress={() => markAllRead.mutate()}
            disabled={!hasUnread}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border py-2.5"
            style={{ opacity: hasUnread ? 1 : 0.45 }}
          >
            <CheckCheck size={16} color={theme.foreground} />
            <Text className="font-sora-medium text-foreground">{t('notif.markAllRead')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={confirmClear}
            className="flex-row items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5"
          >
            <Trash2 size={16} color={theme.destructive} />
            <Text className="font-sora-medium" style={{ color: theme.destructive }}>
              {t('notif.clear')}
            </Text>
          </Pressable>
        </View>

        {upcoming.length > 0 && (
          <View className="gap-2">
            <SectionLabel>{t('notif.upcoming')}</SectionLabel>
            {upcoming.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                onPress={() => handlePress(item)}
                onDelete={() => remove.mutate(item.id)}
              />
            ))}
          </View>
        )}

        {recent.length > 0 && (
          <View className="gap-2">
            <SectionLabel>{t('notif.recent')}</SectionLabel>
            {recent.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                onPress={() => handlePress(item)}
                onDelete={() => remove.mutate(item.id)}
              />
            ))}
          </View>
        )}

        <Text variant="caption" className="px-1 text-center">
          {t('notif.longPressHint')}
        </Text>
      </ScrollView>
    </View>
  );
}
