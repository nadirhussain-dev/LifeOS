import type { LucideIcon } from 'lucide-react-native';
import {
  BellRing,
  BookOpen,
  CalendarClock,
  CheckSquare,
  Droplet,
  Droplets,
  Heart,
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
 * Every local notification Daykeep schedules is tagged with one of these
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
  | 'split'
  | 'together'
  | 'cycle';

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
    /**
     * Not a bypass. The rule this table follows — stated in delivery.ts — is
     * that only time-critical categories may cross quiet hours: a task due now,
     * a calendar event, money, bedtime. "Take a look at this note" is none of
     * those, and with `true` it did exactly what the window exists to prevent:
     * fired at 00:21, inside the default 22:00–07:00.
     *
     * A note reminder set for the middle of the night now shifts to the end of
     * the window instead of waking anybody up.
     */
    tint: '#eab308',
    bypassQuietHours: false,
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
    /**
     * Time-critical, which was not true until this category had a scheduler.
     *
     * The streak reminder is a last call: it fires at 20:00 naming what is still
     * outstanding, and it is only worth sending while the day can still be
     * saved. Left non-bypassing, "smart digest" delivery mode would fold it into
     * the following morning's brief — arriving the day after the streak it was
     * warning about had already been lost, which is worse than silence.
     */
    bypassQuietHours: true,
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
  /**
   * The Together module's milestone nudge and Cycle's "period expected soon"
   * reminder — the private space's two categories. Both are deliberately
   * generic in body text (see together-reminders.ts / cycle-reminders.ts) so
   * this switch controls whether the nudge fires at all, not what it says.
   */
  together: {
    labelKey: 'notifCategory.together.label',
    descriptionKey: 'notifCategory.together.description',
    icon: Heart,
    tint: '#317e25',
    bypassQuietHours: false,
  },
  cycle: {
    labelKey: 'notifCategory.cycle.label',
    descriptionKey: 'notifCategory.cycle.description',
    icon: Droplets,
    tint: '#e0518a',
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
  'together',
  'cycle',
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
 * `streak` is now in too, and the reasoning that kept it out is worth keeping
 * because it was right at the time. A streak-at-risk reminder has to know
 * whether the work has been done *at the moment it fires*, and a local
 * notification carries text fixed at scheduling time — so every version of it
 * nagged people who had already finished. The conclusion drawn from that was
 * "this needs server push".
 *
 * It did not. It needed a cheaper trigger rather than a smarter one:
 * `features/challenge/services/challenge-reminders.ts` cancels and re-queues the
 * reminder on every write, so its text is rebuilt from current state and it is
 * cancelled outright the moment the day is finished. Nothing fires at somebody
 * who is done, because by then there is nothing queued.
 */
export const CONFIGURABLE_CATEGORIES: NotificationCategory[] = CATEGORY_ORDER;

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
