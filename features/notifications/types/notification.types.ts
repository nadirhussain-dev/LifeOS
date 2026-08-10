import type { LucideIcon } from 'lucide-react-native';
import {
  BellRing,
  BookOpen,
  CalendarClock,
  CheckSquare,
  Droplet,
  Moon,
  NotebookPen,
  PartyPopper,
  Repeat,
  Sparkles,
  StickyNote,
  Target,
  Users,
  Wallet,
} from 'lucide-react-native';

/**
 * Every local notification LifeOS schedules is tagged with one of these
 * categories. The category drives three things: the per-category on/off
 * switch in Notification Settings, whether the notification bypasses quiet
 * hours (time-critical, user-timed ones do), and the icon/label shown in the
 * inbox. Keep this union in sync with CATEGORY_META below.
 */
export type NotificationCategory =
  | 'tasks'
  | 'habits'
  | 'journal'
  | 'water'
  | 'sleep'
  | 'study'
  | 'budget'
  | 'calendar'
  | 'notes'
  | 'goals'
  | 'digest'
  | 'streak'
  | 'split';

export type NotificationCategoryMeta = {
  labelKey: string;
  /** Shown under the toggle in Notification Settings. */
  descriptionKey: string;
  icon: LucideIcon;
  /** Hex tint used for the inbox icon chip and settings row. */
  tint: string;
  /** True for reminders the user explicitly timed or that are time-critical
   * (a task due-time, a calendar event, a debt due date, the bedtime nudge).
   * These fire even inside quiet hours; nudges (water/habits/etc.) are shifted
   * out of the window instead. */
  bypassQuietHours: boolean;
};

export const CATEGORY_META: Record<NotificationCategory, NotificationCategoryMeta> = {
  tasks: {
    labelKey: 'notifCategory.tasks.label',
    descriptionKey: 'notifCategory.tasks.description',
    icon: CheckSquare,
    tint: '#6366f1',
    bypassQuietHours: true,
  },
  habits: {
    labelKey: 'notifCategory.habits.label',
    descriptionKey: 'notifCategory.habits.description',
    icon: Repeat,
    tint: '#10b981',
    bypassQuietHours: false,
  },
  journal: {
    labelKey: 'notifCategory.journal.label',
    descriptionKey: 'notifCategory.journal.description',
    icon: BookOpen,
    tint: '#f59e0b',
    bypassQuietHours: false,
  },
  water: {
    labelKey: 'notifCategory.water.label',
    descriptionKey: 'notifCategory.water.description',
    icon: Droplet,
    tint: '#0ea5e9',
    bypassQuietHours: false,
  },
  sleep: {
    labelKey: 'notifCategory.sleep.label',
    descriptionKey: 'notifCategory.sleep.description',
    icon: Moon,
    tint: '#8b5cf6',
    bypassQuietHours: true,
  },
  study: {
    labelKey: 'notifCategory.study.label',
    descriptionKey: 'notifCategory.study.description',
    icon: NotebookPen,
    tint: '#ec4899',
    bypassQuietHours: false,
  },
  budget: {
    labelKey: 'notifCategory.budget.label',
    descriptionKey: 'notifCategory.budget.description',
    icon: Wallet,
    tint: '#22c55e',
    bypassQuietHours: true,
  },
  calendar: {
    labelKey: 'notifCategory.calendar.label',
    descriptionKey: 'notifCategory.calendar.description',
    icon: CalendarClock,
    tint: '#ef4444',
    bypassQuietHours: true,
  },
  notes: {
    labelKey: 'notifCategory.notes.label',
    descriptionKey: 'notifCategory.notes.description',
    icon: StickyNote,
    tint: '#eab308',
    bypassQuietHours: true,
  },
  goals: {
    labelKey: 'notifCategory.goals.label',
    descriptionKey: 'notifCategory.goals.description',
    icon: Target,
    tint: '#14b8a6',
    bypassQuietHours: false,
  },
  digest: {
    labelKey: 'notifCategory.digest.label',
    descriptionKey: 'notifCategory.digest.description',
    icon: Sparkles,
    tint: '#f97316',
    bypassQuietHours: false,
  },
  streak: {
    labelKey: 'notifCategory.streak.label',
    descriptionKey: 'notifCategory.streak.description',
    icon: PartyPopper,
    tint: '#a855f7',
    bypassQuietHours: false,
  },
  /**
   * Shared expense groups. The only category that arrives as a PUSH rather than
   * being scheduled on-device — somebody else's action, on their phone, is what
   * triggers it. It had no category at all before, so a group push pinged the
   * device and then left no trace anywhere in the app: not in the inbox, not in
   * the badge, and with no way to switch it off short of the OS.
   *
   * bypassQuietHours is false: another person adding an expense at 1am is not
   * worth waking somebody for.
   */
  split: {
    labelKey: 'notifCategory.split.label',
    descriptionKey: 'notifCategory.split.description',
    icon: Users,
    tint: '#0d9488',
    bypassQuietHours: false,
  },
};

/** Ordered list of the categories users actually toggle in settings (excludes
 * the always-on internal ones if any). All are user-facing today. */
export const CATEGORY_ORDER: NotificationCategory[] = [
  'tasks',
  'habits',
  'journal',
  'water',
  'sleep',
  'study',
  'budget',
  'calendar',
  'notes',
  'goals',
  'digest',
  'streak',
  'split',
];

/**
 * Categories that actually schedule something and therefore get a user-facing
 * switch in Notification Settings. A toggle that controls nothing is worse than
 * a missing one, so a category earns its switch by having a scheduler.
 *
 * `goals` and `study` were excluded for exactly that reason and are now in:
 * `features/goals/services/goal-reminders.ts` schedules dated deadline
 * reminders, and `features/study/services/study-reminders.ts` schedules the
 * weekly study nudge.
 *
 * `streak` stays out, and not for want of effort. A streak-at-risk reminder has
 * to know whether the habit has been done *at the moment it fires*, and a local
 * notification carries text fixed at scheduling time — so every version of it
 * nags people who already finished. That needs server push; until then the
 * in-app celebration covers the ground worth covering. See the "Deferred (by
 * design)" section of TODO.md.
 */
export const CONFIGURABLE_CATEGORIES: NotificationCategory[] = CATEGORY_ORDER.filter(
  (category) => category !== 'streak',
);

/** Fallback icon for any category not found in the map (defensive). */
export const FALLBACK_NOTIFICATION_ICON: LucideIcon = BellRing;

/** Payload attached to a scheduled notification's `content.data` so the tap
 * handler can deep-link to the right screen and mark the log row read. */
export type NotificationPayload = {
  category: NotificationCategory;
  /** Deep-link path, e.g. '/task' or '/budget/debts/[id]'. */
  route?: string;
  params?: Record<string, string>;
  /** Row id in notification_log, set when logging is enabled. */
  logId?: string;
};

export type NotificationRepeat = 'none' | 'daily' | 'weekly';

/** A row from notification_log, shaped for the inbox UI. */
export type LoggedNotification = {
  id: string;
  notificationId: string | null;
  category: NotificationCategory;
  title: string;
  body: string;
  route: string | null;
  params: Record<string, string> | null;
  scheduledAt: number;
  repeats: NotificationRepeat;
  /** When it actually arrived, or null if it hasn't yet. */
  deliveredAt: number | null;
  readAt: number | null;
  canceledAt: number | null;
  createdAt: number;
};
