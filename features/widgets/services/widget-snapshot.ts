import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The small, denormalized snapshot the home-screen widget renders from.
 *
 * The widget's task handler runs in a headless JS context that can't reliably
 * open the SQLite database, so the app writes this snapshot to AsyncStorage
 * whenever the underlying data changes (see widget-data.tsx's syncTodayWidget)
 * and the handler just reads it back. This module is deliberately dependency-
 * free apart from AsyncStorage so it's safe to import from that headless
 * context — keep repository/expo imports out of it.
 */
export type TodaySnapshot = {
  tasksDue: number;
  habitsLeft: number;
  waterMl: number;
  waterGoalMl: number;
  /**
   * Which rows may be drawn at all.
   *
   * The home screen is the most exposed surface this app has — it is visible
   * without unlocking the phone on most launchers, to anyone who picks it up.
   * So the two switches that hide a module in the app have to reach out here
   * too, and the decision is baked into the snapshot rather than read at render
   * time: the widget's task handler runs headless, where the stores holding
   * those switches are not reliably available. The app context decides; the
   * handler only draws.
   */
  show: { tasks: boolean; habits: boolean; water: boolean };
  /**
   * Today's habits, for the check-off widget.
   *
   * Carries ids because a tap has to name what it completed — the list's order
   * can change between the render and the tap, so an index would occasionally
   * tick the wrong habit. Empty whenever `show.habits` is false, so a hidden
   * module contributes no names here either.
   */
  habits: { id: string; name: string; done: boolean }[];
  /** How much one tap of "+1" logs. Read from the app's own quick-add size so
   *  the widget and the water screen cannot disagree about what a glass is. */
  waterGlassMl: number;
  /**
   * The rendered strings, already in the user's language and already
   * pluralised.
   *
   * The widget was the only English-only surface in an app that ships Arabic,
   * Hindi and Urdu. It could not simply call `t()` for the same reason it cannot
   * read the database: its task handler runs headless, and initialising i18next
   * there means loading four locale bundles and expo-localization in a context
   * that may not survive it — for text the app can perfectly well format itself.
   *
   * So the same trick as `show`: the app decides, the handler draws. This also
   * gets real plural rules for free, where the widget previously did
   * `count === 1 ? 'task' : 'tasks'` — a rule that is wrong in Arabic, which has
   * six plural forms, and wrong in Urdu for the number zero.
   */
  text: {
    heading: string;
    tasks: string;
    habits: string;
    water: string;
    /** Shown when every row is hidden or nothing has synced yet. */
    empty: string;
  };
  /** Epoch ms of the last write; 0 means the app has never synced yet. */
  updatedAt: number;
};

const STORAGE_KEY = 'lifeos.widget.today.v1';

/**
 * Also the fallback for a snapshot written before `show` and `text` existed,
 * since the read below spreads the stored object over this one. Everything
 * defaults to hidden, which is the safe direction for the upgrade: a user who
 * had already privatised a module stops leaking it the moment this build runs,
 * rather than on their next app launch. The cost is a widget that says "open
 * LifeOS" until then, which is honest — it genuinely does not know today's
 * numbers yet.
 *
 * The English in here is the only English left, and it is only ever seen before
 * the first sync — which happens on the next app launch, and cannot happen at
 * all until the app has run once. A blank widget would be the alternative, and
 * that reads as broken.
 */
export const EMPTY_SNAPSHOT: TodaySnapshot = {
  tasksDue: 0,
  habitsLeft: 0,
  waterMl: 0,
  waterGoalMl: 2000,
  show: { tasks: false, habits: false, water: false },
  habits: [],
  waterGlassMl: 250,
  text: { heading: 'TODAY', tasks: '', habits: '', water: '', empty: 'Open LifeOS' },
  updatedAt: 0,
};

export async function writeTodaySnapshot(snapshot: TodaySnapshot): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)).catch(() => undefined);
}

export async function readTodaySnapshot(): Promise<TodaySnapshot> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_SNAPSHOT;
    return { ...EMPTY_SNAPSHOT, ...(JSON.parse(raw) as Partial<TodaySnapshot>) };
  } catch {
    return EMPTY_SNAPSHOT;
  }
}
