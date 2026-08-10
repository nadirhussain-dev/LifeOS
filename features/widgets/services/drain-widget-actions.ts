import { logHabit } from '@/features/habits/services/habits-repository';
import { drainWidgetActions } from '@/features/widgets/services/widget-actions';
import { logWater } from '@/features/water-intake/services/water-intake-repository';
import { reportError } from '@/lib/error-reporting';
import { queryClient } from '@/lib/query-client';

/**
 * Turns taps queued by the home-screen widget into real rows.
 *
 * The widget's task handler cannot write to SQLite — it runs headless, which is
 * the same constraint that made the snapshot necessary in the first place. So a
 * tap parks an intent in AsyncStorage and this drains it the next time the app
 * runs, which is the only place a write is safe.
 *
 * ## The two writes behave differently, on purpose
 *
 * `logHabit` upserts on `(habit_id, log_date)`, so replaying it is harmless.
 * `logWater` appends a row every time, so replaying it invents water nobody
 * drank. The queue is therefore read-and-cleared in one step *before* anything
 * is written: a crash mid-drain loses at most the remaining taps, where the
 * other order would double every glass on the next launch. Losing a tap to a
 * crash is a smaller failure than fabricating one.
 *
 * ## It never throws
 *
 * This runs on launch, ahead of the first frame. A malformed queue entry — from
 * an older build, or a partial write — must cost that entry and nothing else.
 */
export async function drainWidgetActionsIntoDb(): Promise<number> {
  let actions;
  try {
    actions = await drainWidgetActions();
  } catch (error) {
    reportError(error, { scope: 'widget-drain:read' });
    return 0;
  }
  if (actions.length === 0) return 0;

  let applied = 0;
  const touched = new Set<string>();

  for (const action of actions) {
    try {
      if (action.kind === 'water') {
        logWater(action.ml, action.logDate);
        touched.add('water-intake');
      } else if (action.kind === 'habit-done') {
        logHabit(action.habitId, action.logDate);
        touched.add('habits');
      } else {
        continue;
      }
      applied += 1;
    } catch (error) {
      reportError(error, { scope: `widget-drain:${action.kind}` });
    }
  }

  // Only the caches that actually changed. `useWidgetSync` is subscribed to
  // these keys, so this is also what rewrites the snapshot — the widget's own
  // optimistic number is replaced by one read from the database, and if any of
  // the writes failed the number corrects itself rather than staying wrong.
  for (const key of touched) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }

  return applied;
}
