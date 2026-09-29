import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  clearNotificationLog,
  deleteNotificationLog,
  listNotificationLog,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  unreadNotificationCount,
} from '@/features/notifications/services/notification-log-repository';

const INBOX_KEY = ['notifications', 'inbox'] as const;
const UNREAD_KEY = ['notifications', 'unread'] as const;

export function useNotificationInbox() {
  const query = useQuery({
    queryKey: INBOX_KEY,
    queryFn: () => listNotificationLog(),
  });
  return { notifications: query.data ?? [], isLoading: query.isLoading };
}

/** Badge count for the header bell — delivered, unread, one-time reminders. */
export function useUnreadNotificationCount() {
  const query = useQuery({
    queryKey: UNREAD_KEY,
    queryFn: () => unreadNotificationCount(),
    // A reminder crosses from scheduled→delivered on a timer, not on a write,
    // so poll while mounted to keep the badge honest without a push channel.
    refetchInterval: 60_000,
  });
  return query.data ?? 0;
}

export function useNotificationActions() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: INBOX_KEY });
    queryClient.invalidateQueries({ queryKey: UNREAD_KEY });
  };

  const markRead = useMutation({
    mutationFn: async (logId: string) => markNotificationRead(logId),
    onSuccess: invalidate,
  });
  const markUnread = useMutation({
    mutationFn: async (logId: string) => markNotificationUnread(logId),
    onSuccess: invalidate,
  });
  const markAllRead = useMutation({
    mutationFn: async () => markAllNotificationsRead(),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (logId: string) => deleteNotificationLog(logId),
    onSuccess: invalidate,
  });
  const clearAll = useMutation({
    mutationFn: async () => clearNotificationLog(),
    onSuccess: invalidate,
  });

  return { markRead, markUnread, markAllRead, remove, clearAll };
}
