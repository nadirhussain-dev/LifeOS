import type { InsightCandidate, InsightsStatus } from '@/features/insights/types/insights.types';
import type { TimelineEvent } from '@/features/timeline/types/timeline.types';

export type WidgetId =
  | 'today-tasks'
  | 'habit-row'
  | 'today-timeline'
  | 'reflect'
  | 'recent-notes'
  | 'water-intake'
  | 'productivity-summary'
  | 'daily-quote'
  | 'insight-teaser';

export type TaskPreview = {
  id: string;
  title: string;
  done: boolean;
  dueLabel?: string;
};

export type TodayTasksData = {
  completedCount: number;
  totalCount: number;
  upcoming: TaskPreview[];
};

export type HabitPreview = {
  id: string;
  name: string;
  emoji: string;
  streak: number;
  doneToday: boolean;
};

export type HabitRowData = {
  habits: HabitPreview[];
};

export type TodayTimelineData = {
  events: TimelineEvent[];
};

export type MoodOption = 'great' | 'good' | 'okay' | 'low' | 'rough';

export type ReflectData = {
  todaysMood: MoodOption | null;
  journalStreak: number;
  hasWrittenToday: boolean;
};

export type NotePreview = {
  id: string;
  title: string;
  snippet: string;
  updatedAt: Date;
};

export type RecentNotesData = {
  notes: NotePreview[];
};

export type DailyQuoteData = {
  quote: string;
  author: string;
};

/** The dashboard's compact preview of the Insights screen's headline —
 *  same status/candidate shape the full screen uses, just rendered smaller. */
export type InsightTeaserData = {
  status: InsightsStatus;
  headline: InsightCandidate | null;
};
