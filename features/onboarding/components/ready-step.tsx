import { Check, Sparkles } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { currencySymbol } from '@/features/budget/config/currencies';
import { StepScaffold } from '@/features/onboarding/components/step-scaffold';
import type { SeedResult } from '@/features/onboarding/services/seed-from-onboarding';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';

/**
 * The screen the old flow had no equivalent of.
 *
 * Onboarding ended by dropping people onto an empty dashboard, which is where
 * the effort they had just spent went to die: five screens of answers, no
 * acknowledgement, nothing visibly different. This is the receipt — it names what
 * was actually created, by their name, and it is the reason the seeding runs
 * *before* this step rather than on the way out.
 *
 * It reads from the seed's result rather than from what was requested, so it can
 * only claim things that really landed. A line here for a habit whose insert
 * failed would be a lie the user discovers thirty seconds later, on the screen
 * where the habit isn't.
 *
 * With nothing seeded — somebody who skipped everything — it says so warmly and
 * offers the way in. Better than inventing an achievement.
 */
export function ReadyStep({
  name,
  seed,
  onFinish,
}: {
  name: string;
  seed: SeedResult;
  onFinish: () => void;
}) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const reducedMotion = useReducedMotion();

  const lines: string[] = [];
  if (seed.habitsCreated > 0) {
    lines.push(t('onboarding.readyHabits', { count: seed.habitsCreated }));
  }
  if (seed.waterGoalMl != null) {
    lines.push(
      t('onboarding.readyWater', {
        amount: (seed.waterGoalMl / 1000).toFixed(1).replace(/\.0$/, ''),
      }),
    );
  }
  if (seed.currencyCode) {
    lines.push(
      t('onboarding.readyCurrency', {
        currency: `${currencySymbol(seed.currencyCode)} ${seed.currencyCode}`,
      }),
    );
  }

  return (
    <StepScaffold
      hero
      title={
        name.trim()
          ? t('onboarding.readyTitleNamed', { name: name.trim() })
          : t('onboarding.readyTitle')
      }
      body={lines.length > 0 ? t('onboarding.readyBody') : t('onboarding.readyBodyEmpty')}
      above={
        <View
          className="h-[76px] w-[76px] items-center justify-center rounded-[26px]"
          style={{ backgroundColor: alpha(c.accent, 0.12) }}
        >
          <Sparkles size={36} color={c.accent} strokeWidth={1.8} />
        </View>
      }
      footer={
        <Button variant="accent" size="lg" label={t('onboarding.openLifeOS')} onPress={onFinish} />
      }
    >
      {lines.length > 0 ? (
        <View className="gap-3">
          {lines.map((line, index) => (
            <Animated.View
              key={line}
              entering={
                reducedMotion ? undefined : FadeInDown.duration(320).delay(120 + index * 90)
              }
              className="flex-row items-center gap-3"
            >
              <View
                className="h-6 w-6 items-center justify-center rounded-full"
                style={{ backgroundColor: c.accent }}
              >
                <Check size={14} color={c.accentForeground} strokeWidth={3} />
              </View>
              <Text className="flex-1" style={{ color: c.foreground }}>
                {line}
              </Text>
            </Animated.View>
          ))}
        </View>
      ) : null}
    </StepScaffold>
  );
}
