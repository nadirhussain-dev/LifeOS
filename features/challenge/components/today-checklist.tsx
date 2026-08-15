import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
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

  const remaining = items.filter((item) => !item.done).length;
  const complete = items.length > 0 && remaining === 0;
  const tint = qualified ? c.success : complete ? c.accent : c.foreground;

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
            accessibilityState={{ checked: item.done }}
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
                item.done
                  ? { backgroundColor: qualified ? c.success : c.accent }
                  : { borderWidth: 2, borderColor: c.border }
              }
            >
              {item.done ? <Check size={14} color={c.background} strokeWidth={3} /> : null}
            </View>

            <Text
              className="flex-1 font-sora-semibold"
              style={{ color: item.done ? c.foreground : c.mutedForeground }}
            >
              {t(`syncModule.${item.moduleId}`)}
            </Text>

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
            : awaitingServer
              ? t('challenge.todayConfirmingBody')
              : t('challenge.reminderOne', {
                  modules: items
                    .filter((item) => !item.done)
                    .map((item) => t(`syncModule.${item.moduleId}`))
                    .join(', '),
                })}
      </Text>
    </Animated.View>
  );
}
