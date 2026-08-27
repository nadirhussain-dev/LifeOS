import { DailyQuoteWidget } from '@/features/dashboard/components/widgets/daily-quote-widget';
import { HabitRowWidget } from '@/features/dashboard/components/widgets/habit-row-widget';
import { InsightTeaserWidget } from '@/features/dashboard/components/widgets/insight-teaser-widget';
import { ProductivitySummaryWidget } from '@/features/dashboard/components/widgets/productivity-summary-widget';
import { RecentNotesWidget } from '@/features/dashboard/components/widgets/recent-notes-widget';
import { ReflectWidget } from '@/features/dashboard/components/widgets/reflect-widget';
import { TodayTasksWidget } from '@/features/dashboard/components/widgets/today-tasks-widget';
import { TodayTimelineWidget } from '@/features/dashboard/components/widgets/today-timeline-widget';
import { WaterIntakeWidget } from '@/features/dashboard/components/widgets/water-intake-widget';
import { memo } from 'react';

import type { WidgetId } from '@/features/dashboard/types/dashboard.types';

/**
 * Every widget, memoized.
 *
 * None of them take props — each one reads its own data through its own query
 * hook — so without `memo` all nine re-render whenever anything above them on
 * the dashboard renders: a theme read, a store subscription, a widget being
 * reordered. Nine subtrees rebuilt to produce identical output, on the screen
 * that opens first and is scrolled most.
 *
 * `memo` on a propless component is the strongest possible form of it: there is
 * no props comparison that can fail, so each widget re-renders only when its
 * own hooks say its data changed, which is exactly the intent.
 *
 * Applied here rather than in nine files so the property is visible in one
 * place and a new widget inherits it by being added to this map.
 */
export const WIDGET_REGISTRY: Record<WidgetId, React.ComponentType> = {
  'today-tasks': memo(TodayTasksWidget),
  'habit-row': memo(HabitRowWidget),
  'today-timeline': memo(TodayTimelineWidget),
  reflect: memo(ReflectWidget),
  'recent-notes': memo(RecentNotesWidget),
  'water-intake': memo(WaterIntakeWidget),
  'productivity-summary': memo(ProductivitySummaryWidget),
  'daily-quote': memo(DailyQuoteWidget),
  'insight-teaser': memo(InsightTeaserWidget),
};

/**
 * Which Hub module owns each widget's content.
 *
 * The dashboard is the one screen that renders other modules' data by design,
 * so it is also the one screen where "this module is switched off" has to be
 * honoured on somebody else's behalf. Without this map a module moved behind
 * the vault kept its widget on the home screen — Timeline, Notes and Water are
 * all `canBePrivate`, and all three had a widget reading straight from their
 * tables. The home-screen widget already gated its three rows this way
 * (`widget-data.tsx`); this is the same rule for the in-app dashboard.
 *
 * `null` means the widget belongs to no single module and is left alone:
 * `daily-quote` is app content, and `productivity-summary` spans tasks and
 * habits at once — the same reason `digest` maps to nothing in
 * `MODULE_FOR_CATEGORY`. Widgets like those filter what they read instead.
 */
export const WIDGET_MODULE: Record<WidgetId, string | null> = {
  'today-tasks': 'tasks',
  'habit-row': 'habits',
  'today-timeline': 'timeline',
  reflect: 'journal',
  'recent-notes': 'notes',
  'water-intake': 'water',
  'productivity-summary': null,
  'daily-quote': null,
  'insight-teaser': 'insights',
};

/**
 * Whether a widget may render, given a module gate (`useModuleGate()` in a
 * component, `moduleMayBeNamed` outside one). Widgets owned by no module always
 * may.
 */
export function widgetAllowed(id: WidgetId, allowed: (moduleId: string) => boolean): boolean {
  const owner = WIDGET_MODULE[id];
  return owner === null || allowed(owner);
}
