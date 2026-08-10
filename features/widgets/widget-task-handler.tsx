import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { HabitsWidget } from '@/features/widgets/components/habits-widget';
import { DARK, LIGHT } from '@/features/widgets/components/palette';
import { TodayWidget } from '@/features/widgets/components/today-widget';
import { HABITS_WIDGET_NAME, WIDGET_ACTIONS, WIDGET_NAME } from '@/features/widgets/config';
import {
  enqueueWidgetAction,
  localDateKey,
  type WidgetAction,
} from '@/features/widgets/services/widget-actions';
import {
  readTodaySnapshot,
  writeTodaySnapshot,
  type TodaySnapshot,
} from '@/features/widgets/services/widget-snapshot';

/**
 * Runs in a headless JS context whenever the OS needs a widget rendered or a
 * widget control tapped. SQLite is not reliably available here, so it reads the
 * snapshot the app last wrote and renders from that.
 *
 * Taps that *do* something (add water, tick a habit) cannot write to the
 * database for the same reason. They queue an intent, adjust the snapshot so the
 * widget redraws with the new number immediately, and the app turns them into
 * rows on its next run — see `widget-actions.ts` and `drain-widget-actions.ts`.
 */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const name = props.widgetInfo.widgetName;
  if (name !== WIDGET_NAME && name !== HABITS_WIDGET_NAME) return;

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      render(props, await readTodaySnapshot());
      break;
    }

    case 'WIDGET_CLICK': {
      const snapshot = await applyClick(props, await readTodaySnapshot());
      render(props, snapshot);
      break;
    }

    default:
      break;
  }
}

/**
 * Queues the tap and returns the snapshot as it should now look.
 *
 * The optimistic update is not decoration. Without it the widget redraws with
 * the number it already had, which reads as the button being broken — and the
 * real number will not arrive until the app next runs, which may be hours. The
 * app's own drain rewrites the snapshot from the database afterwards, so an
 * optimistic guess that turns out wrong corrects itself rather than persisting.
 */
async function applyClick(
  props: WidgetTaskHandlerProps,
  snapshot: TodaySnapshot,
): Promise<TodaySnapshot> {
  const at = Date.now();
  const logDate = localDateKey(at);

  if (props.clickAction === WIDGET_ACTIONS.addWater) {
    const ml = Number(props.clickActionData?.ml);
    if (!Number.isFinite(ml) || ml <= 0) return snapshot;

    const action: WidgetAction = { kind: 'water', ml, at, logDate };
    await enqueueWidgetAction(action);

    const next: TodaySnapshot = { ...snapshot, waterMl: snapshot.waterMl + ml };
    // The water line is pre-formatted text, so the number in it has to be
    // rewritten rather than recomputed — this context cannot reach i18next. A
    // plain substitution of the leading figure keeps the surrounding
    // translation and its unit intact.
    next.text = {
      ...snapshot.text,
      water: substituteFirstNumber(snapshot.text.water, next.waterMl),
    };
    await writeTodaySnapshot(next);
    return next;
  }

  if (props.clickAction === WIDGET_ACTIONS.toggleHabit) {
    const habitId = String(props.clickActionData?.habitId ?? '');
    if (!habitId) return snapshot;
    // Already done is a no-op rather than an un-tick: the row for a completed
    // habit deep-links into the app instead, so this should not be reachable —
    // but a stale widget could still send it.
    if (snapshot.habits.find((h) => h.id === habitId)?.done !== false) return snapshot;

    await enqueueWidgetAction({ kind: 'habit-done', habitId, at, logDate });

    const next: TodaySnapshot = {
      ...snapshot,
      habits: snapshot.habits.map((h) => (h.id === habitId ? { ...h, done: true } : h)),
      habitsLeft: Math.max(0, snapshot.habitsLeft - 1),
    };
    await writeTodaySnapshot(next);
    return next;
  }

  return snapshot;
}

/**
 * Replaces the first number in an already-translated string.
 *
 * Used for the water line, whose text is "1.5 / 2 L water" in English and the
 * equivalent in three other languages, with the figures in different places.
 * Matching the first run of digits is the one operation that is right in all of
 * them; anything smarter would need the formatter, which is in the app.
 */
function substituteFirstNumber(text: string, ml: number): string {
  const litres = (ml / 1000).toFixed(1);
  return text.replace(/[\d]+([.,][\d]+)?/, litres);
}

/** Both themes, so the launcher can pick — see components/palette.ts. */
function render(props: WidgetTaskHandlerProps, snapshot: TodaySnapshot): void {
  if (props.widgetInfo.widgetName === HABITS_WIDGET_NAME) {
    props.renderWidget({
      light: <HabitsWidget snapshot={snapshot} palette={LIGHT} />,
      dark: <HabitsWidget snapshot={snapshot} palette={DARK} />,
    });
    return;
  }
  props.renderWidget({
    light: <TodayWidget snapshot={snapshot} palette={LIGHT} />,
    dark: <TodayWidget snapshot={snapshot} palette={DARK} />,
  });
}
