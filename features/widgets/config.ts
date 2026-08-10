/** Must match the widget `name` declared in app.json's react-native-android-widget
 * plugin config, and the key used in the task handler's name→component map. */
export const WIDGET_NAME = 'LifeOSToday';

/**
 * Deep links each widget row opens (clickAction OPEN_URI). The `lifeos://`
 * scheme is registered via app.json's `scheme`, and expo-router resolves the
 * path — the triple slash keeps the first segment a path, not a URL host, so
 * `/tasks` isn't mis-parsed as host `tasks`.
 */
export const WIDGET_LINKS = {
  tasks: 'lifeos:///tasks',
  habits: 'lifeos:///habits',
  water: 'lifeos:///water-intake/history',
} as const;

/** The habit check-off widget. Its own widget rather than more rows on
 *  "Today", because a list needs height and a glance needs none. */
export const HABITS_WIDGET_NAME = 'LifeOSHabits';

/**
 * Custom click actions the task handler answers.
 *
 * These are not deep links — they do work and redraw without opening the app,
 * which is the entire point of a check-off widget. Anything that has to open a
 * screen stays on `OPEN_URI`.
 */
export const WIDGET_ACTIONS = {
  addWater: 'ADD_WATER',
  toggleHabit: 'TOGGLE_HABIT',
} as const;
