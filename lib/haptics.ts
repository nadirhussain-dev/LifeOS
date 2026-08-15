import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * The app's haptic vocabulary — four signals, and no others.
 *
 * Haptics were already in use in a handful of screens, each picking an
 * intensity on the spot. That is the usual state of things and it is why most
 * apps' haptics register as noise: if every tap buzzes the same, the buzz stops
 * carrying information, and if every screen picks differently it never becomes
 * a language at all.
 *
 * A small fixed set does the opposite. Four signals, used consistently, and
 * within a week somebody knows what the double pulse means without ever having
 * been told. That is the difference between feedback and vocabulary.
 *
 * The set, and what each one is reserved for:
 *
 *   `selection()`  — moving through options. Cheapest, most frequent.
 *   `logged()`     — one thing recorded. A habit ticked, a glass logged.
 *   `dayKept()`    — **the day closed.** Two pulses, and nothing else in the
 *                    app is allowed to be two pulses. This is the one the user
 *                    should come to recognise.
 *   `rungReached()`— a milestone. Rare, softer, longer.
 *
 * Everything is fire-and-forget and nothing throws: haptics are unavailable on
 * web, on some Android hardware, and whenever the OS decides they are. A missing
 * buzz must never be able to interrupt what the user was actually doing.
 */

/** Android's older devices report support inconsistently; the promise rejects
 *  rather than resolving false, so every call is swallowed at the edge. */
function fire(run: () => Promise<void>): void {
  if (Platform.OS === 'web') return;
  void run().catch(() => undefined);
}

/** Moving between options — a picker, a segmented control, a slider notch. */
export function selection(): void {
  fire(() => Haptics.selectionAsync());
}

/** One thing recorded. The most common signal in the app after selection. */
export function logged(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/**
 * The day is kept — every committed module is done.
 *
 * Two pulses, deliberately spaced. The gap is what makes it read as a
 * *different thing* rather than a stronger version of `logged()`; a single
 * heavier buzz would just feel like a firmer tap. Nothing else in the app may
 * use a double, or this stops meaning anything.
 *
 * 90ms is long enough to be perceived as two events and short enough that it
 * still feels like one gesture.
 */
export function dayKept(): void {
  if (Platform.OS === 'web') return;
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
  setTimeout(() => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)), 90);
}

/** A rung on the ladder. Softer and longer than the day — this is arrival,
 *  not completion, and it should feel like settling rather than a stamp. */
export function rungReached(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}
