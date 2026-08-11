import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ProgressRing } from '@/components/ui/progress-ring';
import { Text } from '@/components/ui/text';
import { alpha } from '@/lib/color';

type Props = {
  /** 1-indexed day since the most recent logged period started, or null with
   *  no periods logged yet. */
  currentDay: number | null;
  /** Mean cycle length from this person's own history — see
   *  cycle-math.ts's averageCycleLength. Null before three periods exist. */
  averageCycleLength: number | null;
  tint: string;
};

/** Cycle length to sweep the ring against before three periods give a real
 *  average — a plain visual reference, never shown as a number anywhere. */
const FALLBACK_LENGTH = 28;

/**
 * The Cycle module's hero: a single glance at where today sits.
 *
 * Deliberately shows one thing — day-of-cycle against the person's own
 * average — and nothing cycle-math.ts's header rules out. No phase names, no
 * fertile window, no ovulation marker: that file is explicit about why
 * ("no fertility window... a medical claim, wrong often enough to matter"),
 * and a ring is exactly the kind of component that invites adding one. The
 * text this renders (day count, "needs more cycles") is the same information
 * the screen already showed in two side-by-side boxes — this is that data,
 * not new claims about it.
 */
export function CycleHero({ currentDay, averageCycleLength, tint }: Props) {
  const { t } = useTranslation();
  const length = averageCycleLength ?? FALLBACK_LENGTH;
  const progress = currentDay ? Math.min(1, currentDay / length) : 0;

  return (
    <View className="items-center gap-3 py-2">
      <ProgressRing progress={progress} size={168} strokeWidth={14} color={tint} gradient>
        <View className="items-center">
          <Text className="font-sora-extrabold text-4xl" style={{ color: tint }}>
            {currentDay ?? '—'}
          </Text>
          <Text variant="caption">
            {currentDay ? t('private.dayOfCycle') : t('private.noPeriodsYet')}
          </Text>
        </View>
      </ProgressRing>
      {averageCycleLength ? (
        <View
          className="flex-row items-center gap-1.5 rounded-full px-3 py-1.5"
          style={{ backgroundColor: alpha(tint, 0.12) }}
        >
          <Text variant="caption" style={{ color: tint }} className="font-sora-medium">
            {t('private.averageCycleDays', { count: averageCycleLength })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
