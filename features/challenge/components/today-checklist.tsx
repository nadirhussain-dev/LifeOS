import { useRouter } from 'expo-router';
import { Check, CloudOff } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useDayClosed } from '@/features/challenge/hooks/use-day-closed';
import type { ChecklistItem } from '@/features/challenge/types/challenge.types';
import { useTheme } from '@/hooks/use-theme';

/**
 * Today's commitment, as one unmissable list.
 *
 * This is the most-used surface in the whole feature and the one that decides
 * whether the three-module rule costs completions. The failure it exists to
 * prevent is specific and entirely self-inflicted: somebody opens the app, does
 * two of their three, and goes to bed. Nothing about a streak counter or a
 * ladder stops that — only a list with an obvious hole in it does.
 *
 * So: one row per module, a tick that lands the instant something is logged
 * (the local buffer, not the server), a live count, and a tap that goes
 * straight into the module rather than making somebody find it. And an explicit
 * completed state, because "no rows left" and "the day is safe" are different
 * feelings and only one of them is worth ending the evening on.
 *
 * ## The third row state, and why it has to exist
 *
 * Under a season with `require_live_writes` (migration 0065) a module counts
 * only once the server has witnessed the write. That gives a row three states,
 * not two: untouched, worked-on-but-offline, and counted.
 *
 * The middle one is the whole reason this component changed. Without it the
 * strict rule has no symptom until midnight — somebody works through the
 * evening on a train, watches every line go green, and loses the day anyway.
 * A rule that severe is only defensible if the screen is honest about it while
 * there is still time to do something, so an unattested row is drawn as a
 * warning with its own explanation rather than as a tick.
 *
 * `item.counts`, never `item.done`, drives every visual and every count here.
 * They are the same field on a season without the rule and deliberately differ
 * on one with it.
 */

/** Where a module's row takes you. Deliberately the module's landing route —
 *  the point is to remove one navigation step, not to guess at a sub-screen. */
const MODULE_ROUTES: Record<string, string> = {
  habits: '/habits',
  tasks: '/tasks',
  journal: '/journal',
  water: '/water-intake',
  sleep: '/sleep',
  study: '/study',
  goals: '/goals',
  notes: '/notes',
};

type Props = {
  items: ChecklistItem[];
  /** The server has this day in the ledger. The only authoritative answer. */
  qualified: boolean;
  /** Local evidence says done, the server has not confirmed yet. */
  awaitingServer: boolean;
  dayNumber: number;
};

export function TodayChecklist({ items, qualified, awaitingServer, dayNumber }: Props) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const router = useRouter();

  const remaining = items.filter((item) => !item.counts).length;
  const complete = items.length > 0 && remaining === 0;
  // Worked on, and still not counting. Under the live rule this is the state
  // worth shouting about; without it the list is always empty.
  const offline = items.filter((item) => item.done && !item.counts);
  const tint = qualified
    ? c.success
    : complete
      ? c.accent
      : offline.length > 0
        ? c.warning
        : c.foreground;

  /**
   * The moment. Fires once, on the transition, and never on a remount — see
   * `useDayClosed`. It is what the haptic and the settle below are tied to.
   */
  const justClosed = useDayClosed(complete, items.length > 0);

  /**
   * The card settles rather than pops.
   *
   * A spring that overshoots slightly and comes to rest, not a bounce: the day
   * has been *put away*, and the motion should read as something coming to
   * rest against something else. Damping is high enough that it never wobbles
   * — a wobble would make a considered moment look like a toy.
   */
  const settle = useSharedValue(1);
  useEffect(() => {
    if (!justClosed) return;
    settle.value = withSequence(
      withTiming(0.985, { duration: 90 }),
      withSpring(1, { damping: 14, stiffness: 140 }),
    );
  }, [justClosed, settle]);

  const settleStyle = useAnimatedStyle(() => ({ transform: [{ scale: settle.value }] }));

  return (
    <Animated.View
      className={cardClass({ padding: 'md' }, 'gap-3')}
      style={[
        qualified || justClosed ? { backgroundColor: `${c.success}14` } : undefined,
        settleStyle,
      ]}
    >
      <View className="flex-row items-baseline justify-between">
        <Text variant="micro" style={{ color: tint }}>
          {t('challenge.todayTitle').toUpperCase()}
        </Text>
        <Text variant="caption">
          {qualified
            ? t('challenge.todayCounted')
            : remaining === 0
              ? t('challenge.todayConfirming')
              : t('challenge.todayToGo', { count: remaining })}
        </Text>
      </View>

      <View>
        {items.map((item, index) => (
          <Pressable
            key={item.moduleId}
            accessibilityRole="button"
            accessibilityState={{ checked: item.counts }}
            onPress={() => {
              const route = MODULE_ROUTES[item.moduleId];
              if (route) router.push(route);
            }}
            className="flex-row items-center gap-3 py-2.5"
            style={index > 0 ? { borderTopWidth: 1, borderTopColor: c.border } : undefined}
          >
            <View
              className="h-6 w-6 items-center justify-center rounded-md"
              style={
                item.counts
                  ? { backgroundColor: qualified ? c.success : c.accent }
                  : item.done
                    ? // Worked on, not witnessed. Filled rather than outlined,
                      // because this is a state that happened rather than one
                      // still waiting to — an empty box would read as "not done
                      // yet" and hide exactly the thing the user needs to see.
                      { backgroundColor: c.warning }
                    : { borderWidth: 2, borderColor: c.border }
              }
            >
              {item.counts ? (
                <Check size={14} color={c.background} strokeWidth={3} />
              ) : item.done ? (
                <CloudOff size={13} color={c.background} strokeWidth={2.5} />
              ) : null}
            </View>

            <View className="flex-1">
              <Text
                className="font-sora-semibold"
                style={{ color: item.counts ? c.foreground : c.mutedForeground }}
              >
                {t(`syncModule.${item.moduleId}`)}
              </Text>
              {item.done && !item.counts ? (
                <Text variant="caption" style={{ color: c.warning }}>
                  {t('challenge.liveNotCounted')}
                </Text>
              ) : null}
            </View>

            {item.writes > 0 ? <Text variant="caption">{item.writes}</Text> : null}
          </Pressable>
        ))}
      </View>

      {/* One line, and it changes with the state rather than stacking messages.
          At the moment of closing it says the thing worth saying and nothing
          about servers — the confirmation caption is for the seconds after. */}
      <Text variant="caption" style={{ color: tint }}>
        {justClosed
          ? `${t('challenge.dayKept')} ${t('challenge.dayKeptBody', { day: dayNumber + 1 })}`
          : qualified
            ? `${t('challenge.todaySafe', { day: dayNumber })} ${t('challenge.todayTomorrow')}`
            : offline.length > 0
              ? t('challenge.liveOfflineBody', {
                  modules: offline.map((item) => t(`syncModule.${item.moduleId}`)).join(', '),
                })
              : awaitingServer
                ? t('challenge.todayConfirmingBody')
                : t('challenge.reminderOne', {
                    modules: items
                      .filter((item) => !item.counts)
                      .map((item) => t(`syncModule.${item.moduleId}`))
                      .join(', '),
                  })}
      </Text>
    </Animated.View>
  );
}
