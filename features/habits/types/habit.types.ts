export type HabitType = 'boolean' | 'count' | 'duration' | 'distance' | 'time' | 'negative';

export type HabitScheduleType =
  'daily' | 'weekly' | 'monthly' | 'custom_days' | 'every_x_days' | 'flexible';

export type HabitSkipReason = 'skip' | 'vacation';

export type Habit = {
  id: string;
  name: string;
  emoji: string | null;
  categoryId: string | null;
  colorToken: string | null;
  type: HabitType;
  unit: string | null;
  targetValue: number | null;
  scheduleType: HabitScheduleType;
  /** Weekday ints, 0 = Sunday, only meaningful when scheduleType is 'custom_days'. */
  scheduleDays: number[] | null;
  scheduleIntervalDays: number | null;
  /** The count-mode goal each log of this habit advances, if any. */
  goalId: string | null;
  reminderTime: string | null;
  reminderAdaptive: boolean;
  reminderNotificationId: string | null;
  position: number;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
};

export type HabitCategory = {
  id: string;
  name: string;
  colorToken: string;
  icon: string;
};

export type HabitLog = {
  id: string;
  habitId: string;
  logDate: string;
  value: number;
  note: string | null;
  loggedAt: number;
};

export type HabitSkip = {
  id: string;
  habitId: string;
  logDate: string;
  reason: HabitSkipReason;
};

export type CreateHabitInput = {
  name: string;
  emoji?: string | null;
  categoryId?: string | null;
  colorToken?: string | null;
  type: HabitType;
  unit?: string | null;
  targetValue?: number | null;
  scheduleType: HabitScheduleType;
  scheduleDays?: number[] | null;
  scheduleIntervalDays?: number | null;
  goalId?: string | null;
  reminderTime?: string | null;
  reminderAdaptive?: boolean;
};

export type UpdateHabitInput = Partial<CreateHabitInput> & {
  isArchived?: boolean;
  position?: number;
};

/** Today's status for a single habit, derived (not stored) for the Today screen. */
export type HabitTodayStatus = 'done' | 'skipped' | 'not_yet' | 'not_scheduled';

export type HabitWithToday = Habit & {
  todayStatus: HabitTodayStatus;
  todayValue: number | null;
  currentStreak: number;
  bestStreak: number;
};

export type HabitStreakSummary = {
  currentStreak: number;
  bestStreak: number;
  completionRate30d: number;
  /**
   * True when the current run is only alive because its one grace day was
   * spent. Lets the UI acknowledge the miss ("1 day missed — streak held")
   * instead of pretending it didn't happen or wiping the run to zero.
   */
  graceUsed: boolean;
};

export type HabitRoutine = {
  id: string;
  name: string;
  position: number;
};

export type RoutineWithHabits = HabitRoutine & {
  habits: HabitWithToday[];
};
