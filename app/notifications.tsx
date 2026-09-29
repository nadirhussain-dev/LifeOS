import { formatDistanceToNow } from 'date-fns/formatDistanceToNow';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, View } from 'react-native';

import { BellOff, CheckCheck, Clock, Trash2 } from '@/components/ui/icons';
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
import { groupScheduled } from '@/features/notifications/services/inbox-grouping';
import { notificationStatus } from '@/features/notifications/services/notification-status';
import { useNotificationsStore } from '@/features/notifications/store/notifications-store';
import { alpha } from '@/lib/color';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { confirm } from '@/lib/dialog-store';

function NotificationRow({
  item,
  count = 1,
  onPress,
  onDelete,
  onToggleRead,
}: {
  item: LoggedNotification;
  /** Schedules this row stands for — see groupScheduled. */
  count?: number;
  onPress: () => void;
  onDelete: () => void;
  /** Flips this row between read and unread. */
  onToggleRead: () => void;
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
        ? // A daily schedule with several slots says how often as well as what:
          // "Daily reminder" alone was identical across all fourteen hydration
          // rows, which is what made them unreadable.
          count > 1
          ? t('notif.dailyTimes', { count })
          : t('notif.dailyReminder')
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
          {/* The dot was decorative, and read was a one-way door: opening a
              notification marked it read and nothing could undo that. Tapping
              one to find out what it said therefore destroyed the only record
              that you had not dealt with it — which is the entire job of the
              unread state. "Mark all read" did it to every row at once.

              So the dot is the control. Filled means unread and tapping marks
              it read; hollow means read and tapping puts it back. Drawn in both
              states rather than only when unread, because a control that
              appears only on the rows that already have it offers no way to
              reach the ones that do not.

              Its own hit target, kept off the row's: the row navigates, and a
              toggle that also navigated would be indistinguishable from the
              thing it is meant to be an alternative to. */}
          {status === 'delivered' && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={unread ? t('notif.markRead') : t('notif.markUnread')}
              onPress={onToggleRead}
              hitSlop={12}
              className="h-5 w-5 items-center justify-center"
            >
              <View
                className="h-2.5 w-2.5 rounded-full"
                style={
                  unread
                    ? { backgroundColor: tint }
                    : { borderWidth: 1.5, borderColor: theme.mutedForeground }
                }
              />
            </Pressable>
          )}
        </View>
        {!!item.body && (
          <Text variant="muted" numberOfLines={2}>
            {item.body}
          </Text>
        )}
        <View className="mt-1 flex-row items-center gap-1.5">
          {status === 'scheduled' && <Clock size={11} color={theme.mutedForeground} />}
          <Text variant="caption">{timeLabel}</Text>
          {/* Daily cadence is already spelled out in timeLabel; a weekly habit
              across four weekdays is not, so say how many are behind this one
              rather than repeating the row four times. */}
          {count > 1 && item.repeats !== 'daily' && (
            <Text variant="caption" style={{ color: tint }}>
              {t('notif.plusMore', { count: count - 1 })}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text variant="sectionLabel" className="px-1">
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
  const { markRead, markUnread, markAllRead, remove, clearAll } = useNotificationActions();
  // Strictly false — null is "not checked yet", not "blocked".
  const permissionRevoked = useNotificationsStore((s) => s.systemPermissionGranted === false);

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
    // Scheduled rows collapse per schedule and run soonest-first; delivered
    // ones stay individual and newest-first, as the query returns them.
    return { upcoming: groupScheduled(up), recent: rec, hasUnread: unread };
  }, [notifications]);

  const toggleRead = (item: LoggedNotification) => {
    if (item.readAt) markUnread.mutate(item.id);
    else markRead.mutate(item.id);
  };

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
          {/* Empty *because* nothing can arrive is the likeliest way to see
              this screen with a revoked permission, and "You're all caught up"
              is precisely the wrong thing to say about it. */}
          <Text className="font-sora-semibold text-lg text-foreground">
            {permissionRevoked ? t('notif.systemOff') : t('notif.emptyTitle')}
          </Text>
          <Text variant="muted" className="text-center">
            {permissionRevoked ? t('notif.permissionBlockedNote') : t('notif.emptyBody')}
          </Text>
          {permissionRevoked && (
            <Pressable
              accessibilityRole="button"
              onPress={() => void Linking.openSettings()}
              className="mt-1 rounded-xl border border-border px-4 py-2.5"
            >
              <Text className="font-sora-medium" style={{ color: theme.accent }}>
                {t('notif.openSystemSettings')}
              </Text>
            </Pressable>
          )}
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
        {/* The screen someone opens when reminders have stopped arriving, so
            it is where the reason belongs. Nothing else in the app changes
            when the OS permission is revoked — every switch still reads ON. */}
        {permissionRevoked && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void Linking.openSettings()}
            className="flex-row items-center gap-3 rounded-2xl border p-3.5"
            style={{
              borderColor: theme.destructive,
              backgroundColor: alpha(theme.destructive, 0.08),
            }}
          >
            <BellOff size={18} color={theme.destructive} />
            <View className="flex-1">
              <Text className="font-sora-medium text-foreground">{t('notif.systemOff')}</Text>
              <Text variant="caption">{t('notif.openSystemSettings')}</Text>
            </View>
          </Pressable>
        )}

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

        {/* Recent leads. This is an inbox: it answers "what did I miss", and
            queued reminders had been pushing every arrival below the fold —
            fourteen hydration slots are enough to hide them entirely. */}
        {recent.length > 0 && (
          <View className="gap-2">
            <SectionLabel>{t('notif.recent')}</SectionLabel>
            {recent.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                onPress={() => handlePress(item)}
                onDelete={() => remove.mutate(item.id)}
                onToggleRead={() => toggleRead(item)}
              />
            ))}
          </View>
        )}

        {upcoming.length > 0 && (
          <View className="gap-2">
            <SectionLabel>{t('notif.upcoming')}</SectionLabel>
            {upcoming.map((group) => (
              <NotificationRow
                key={group.lead.id}
                item={group.lead}
                count={group.count}
                onPress={() => handlePress(group.lead)}
                // The whole schedule, not just the occurrence on screen —
                // removing one slot of fourteen would look like nothing
                // happened.
                onDelete={() => group.ids.forEach((id) => remove.mutate(id))}
                onToggleRead={() => toggleRead(group.lead)}
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
