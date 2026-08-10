import type { TFunction } from 'i18next';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { cardClass } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ProgressRing } from '@/components/ui/progress-ring';
import { Text } from '@/components/ui/text';
import { elevation, moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { useHabitRow, useReflect, useTodayTasks } from '@/features/dashboard/hooks/use-widget-data';
import { useTodayWaterTotal } from '@/features/water-intake/hooks/use-water-intake';
import { useWaterSettingsStore } from '@/features/water-intake/store/water-settings-store';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

/**
 * The dashboard's calm summary hero — the reference implementation of the
 * LifeOS design system. It embodies four principles at once:
 *   • Summary before detail — the whole day reads in one glance.
 *   • Progress principle + goal-gradient — three rings make momentum visible.
 *   • One primary action — exactly one accent CTA that always answers
 *     "what should I do next?", resolved from real state.
 *   • Honest progress — every ring reflects true counts, never inflated.
 *
 * Each ring wears its module's signature tint (tasks → brand accent, habits →
 * habit green, water → water cyan) so the module color language shows up the
 * moment the app opens.
 */
export function TodayFocusCard() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();

  const { data: tasks } = useTodayTasks();
  const { data: habitRow } = useHabitRow();
  const { data: reflect } = useReflect();
  const { data: waterMl } = useTodayWaterTotal();
  const goalMl = useWaterSettingsStore((state) => state.goalMl);

  const taskDone = tasks?.completedCount ?? 0;
  const taskTotal = tasks?.totalCount ?? 0;
  const habits = habitRow?.habits ?? [];
  const habitDone = habits.filter((h) => h.doneToday).length;
  const habitTotal = habits.length;
  const water = waterMl ?? 0;

  const ratio = (done: number, total: number) => (total > 0 ? done / total : 0);

  // "What next?" — the single most useful action given the current state.
  const next = resolveNextAction(t, {
    pendingTasks: taskTotal - taskDone,
    nextTask: tasks?.upcoming[0],
    hasWrittenToday: reflect?.hasWrittenToday ?? false,
    pendingHabits: habitTotal - habitDone,
  });

  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeInDown.duration(320)}
      className={cardClass({ padding: 'lg' }, 'gap-4')}
      style={elevation.e2}
    >
      <View className="flex-row items-center justify-between">
        <Text
          variant="micro"
          className="font-sora-semibold uppercase tracking-wide text-muted-foreground"
          style={{ letterSpacing: 1 }}
        >
          {t('dashboard.todaysMomentum')}
        </Text>
        <Text variant="caption" className="text-muted-foreground">
          {summaryLine(t, taskTotal - taskDone, habitTotal - habitDone, water >= goalMl)}
        </Text>
      </View>

      <View className="flex-row justify-around">
        <RingStat
          progress={ratio(taskDone, taskTotal)}
          value={taskTotal > 0 ? `${taskDone}/${taskTotal}` : '—'}
          label={t('tabs.tasks')}
          tint={colors[scheme].accent}
        />
        <RingStat
          progress={ratio(habitDone, habitTotal)}
          value={habitTotal > 0 ? `${habitDone}/${habitTotal}` : '—'}
          label={t('tabs.habits')}
          tint={moduleTint('habit', scheme)}
        />
        <RingStat
          progress={goalMl > 0 ? water / goalMl : 0}
          value={`${(water / 1000).toFixed(1)}L`}
          label={t('dashboard.water')}
          tint={moduleTint('water', scheme)}
        />
      </View>

      <View className="border-divider gap-3 border-t pt-4">
        <View>
          <Text
            variant="micro"
            className="font-sora-semibold uppercase text-muted-foreground"
            style={{ letterSpacing: 1 }}
          >
            {next.eyebrow}
          </Text>
          <Text className="mt-1 font-sora-semibold text-base text-foreground" numberOfLines={1}>
            {next.title}
          </Text>
        </View>
        <Button
          variant="accent"
          size="md"
          label={next.cta}
          onPress={() => router.push(next.href as never)}
        />
      </View>
    </Animated.View>
  );
}

function RingStat({
  progress,
  value,
  label,
  tint,
}: {
  progress: number;
  value: string;
  label: string;
  tint: string;
}) {
  return (
    <View className="items-center gap-2">
      <ProgressRing progress={progress} size={80} strokeWidth={8} color={tint} gradient>
        <Text
          className="font-sora-extrabold text-lg text-foreground"
          style={{ letterSpacing: -0.5, fontVariant: ['tabular-nums'] }}
        >
          {value}
        </Text>
      </ProgressRing>
      <Text variant="caption" className="font-sora-semibold">
        {label}
      </Text>
    </View>
  );
}

/** A single supportive line — never a guilt trip, never a fake urgency count. */
function summaryLine(
  t: TFunction,
  pendingTasks: number,
  pendingHabits: number,
  waterMet: boolean,
): string {
  const remaining = Math.max(0, pendingTasks) + Math.max(0, pendingHabits) + (waterMet ? 0 : 1);
  if (remaining === 0) return t('dashboard.allCaughtUpCheck');
  return t('dashboard.thingsNeedYou', { count: remaining });
}

type NextAction = { eyebrow: string; title: string; cta: string; href: string };

/**
 * Resolve the one action worth surfacing. Order reflects daily rhythm: clear
 * what's due, then reflect, then check in on habits, and finally rest.
 */
function resolveNextAction(
  t: TFunction,
  input: {
    pendingTasks: number;
    nextTask?: { title: string; dueLabel?: string };
    hasWrittenToday: boolean;
    pendingHabits: number;
  },
): NextAction {
  if (input.pendingTasks > 0 && input.nextTask) {
    const when = input.nextTask.dueLabel ? ` · ${input.nextTask.dueLabel}` : '';
    return {
      eyebrow: t('dashboard.nextUp'),
      title: `${input.nextTask.title}${when}`,
      cta: t('dashboard.viewTasks'),
      href: '/(tabs)/tasks',
    };
  }
  if (!input.hasWrittenToday) {
    return {
      eyebrow: t('dashboard.quietMoment'),
      title: t('dashboard.reflectToday'),
      cta: t('dashboard.writeEntry'),
      href: '/(tabs)/journal',
    };
  }
  if (input.pendingHabits > 0) {
    return {
      eyebrow: t('dashboard.keepGoing'),
      title: t('dashboard.checkHabits'),
      cta: t('dashboard.openHabits'),
      href: '/(tabs)/habits',
    };
  }
  return {
    eyebrow: t('dashboard.nothingPressing'),
    title: t('dashboard.allCaughtUp'),
    cta: t('dashboard.reviewWeek'),
    href: '/(tabs)/hub',
  };
}
