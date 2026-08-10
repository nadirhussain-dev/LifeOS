import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Taps on the widget that have not reached the database yet.
 *
 * ## Why a queue rather than a write
 *
 * The widget's task handler runs in a headless JS context. The snapshot exists
 * because SQLite is not reliably available there — that constraint does not
 * change just because the user tapped something. A "+1 glass" button that opens
 * the database from a headless task is a button that works on the maintainer's
 * phone and silently does nothing on somebody else's.
 *
 * So the tap does two things it *can* do safely: it appends an intent here, and
 * it nudges the snapshot so the widget redraws with the new number immediately.
 * The app drains the queue into real rows the next time it runs. The user sees
 * the right number at once; the durable write happens where writes are safe.
 *
 * ## The timestamp is the point
 *
 * Each entry carries the moment it was tapped, not the moment it was drained.
 * Somebody who logs four glasses across an afternoon and opens the app that
 * evening gets four glasses at the times they drank them, rather than four
 * stacked at 9pm. Draining a week-old queue stays correct for the same reason.
 *
 * Dependency-free apart from AsyncStorage, like `widget-snapshot.ts`, because
 * the headless context has to be able to import it.
 */
export type WidgetAction =
  | { kind: 'water'; ml: number; at: number; logDate: string }
  /** `habitId` rather than an index: the widget's list is a snapshot and the
   *  underlying order can change between the render and the tap. */
  | { kind: 'habit-done'; habitId: string; at: number; logDate: string };

/**
 * The local `yyyy-MM-dd` at the moment of the tap, stamped into the action.
 *
 * Derived here rather than at drain time, and this is not a detail: a glass
 * logged at 11:50pm and drained when the app opens at 8am would otherwise be
 * filed against the wrong day, and a habit ticked just before midnight would
 * break the streak it was ticked to keep.
 *
 * Plain `Date` methods rather than `toDateKey`/date-fns, to keep this module
 * importable from the headless context with nothing behind it but AsyncStorage.
 */
export function localDateKey(at: number): string {
  const d = new Date(at);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

const QUEUE_KEY = 'lifeos.widget.actions.v1';

/**
 * Bounded, and it drops the *oldest* on overflow.
 *
 * A queue that grows without limit is a phone that eventually cannot write its
 * own preferences. Fifty is far past any honest usage — it is the ceiling for a
 * pocket-tapping accident or a bug, and in both of those the recent taps are
 * the ones worth keeping.
 */
const MAX_QUEUED = 50;

export async function readWidgetActions(): Promise<WidgetAction[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as WidgetAction[]) : [];
  } catch {
    return [];
  }
}

export async function enqueueWidgetAction(action: WidgetAction): Promise<void> {
  try {
    const queue = await readWidgetActions();
    queue.push(action);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUED)));
  } catch {
    // A failed enqueue costs one tap. Throwing here would take down the task
    // handler mid-render and leave the widget showing the previous number with
    // no explanation, which is worse.
  }
}

/**
 * Takes everything currently queued and clears it, in one step.
 *
 * Read-then-clear rather than clear-after-processing: the caller writes rows
 * inside its own transaction, and a crash between the two would otherwise
 * replay the whole queue and double every glass of water. Losing a tap to a
 * crash is a smaller failure than inventing one.
 */
export async function drainWidgetActions(): Promise<WidgetAction[]> {
  const queue = await readWidgetActions();
  if (queue.length === 0) return [];
  await AsyncStorage.removeItem(QUEUE_KEY).catch(() => undefined);
  return queue;
}
