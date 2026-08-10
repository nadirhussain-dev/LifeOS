import { Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { CURRENCIES, currencySymbol } from '@/features/budget/config/currencies';
import { suggestedHabits } from '@/features/onboarding/config/starter-habits';
import { StepScaffold } from '@/features/onboarding/components/step-scaffold';
import type { ShapeChoices } from '@/features/onboarding/store/onboarding-draft-store';
import type { FocusArea } from '@/features/profile/store/profile-store';
import { GOAL_PRESETS_ML } from '@/features/water-intake/store/water-settings-store';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';

/** Offered alongside whatever the device reports, so the list is short and the
 *  right answer is usually already selected. The full 90-entry picker lives in
 *  Budget settings; putting it here would turn a two-second decision into a
 *  scroll. */
const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'PKR', 'AED'];

const WATER_PRESETS = GOAL_PRESETS_ML.slice(0, 4);

/**
 * The step that sets things up instead of asking about them.
 *
 * Everything on this screen is a preference the app needs anyway and would
 * otherwise have buried in a settings screen the user does not yet know exists —
 * the hydration goal, the budget currency, and a couple of habits so that the
 * Today screen has something on it the first time it is opened.
 *
 * It is assembled from the previous step's answers, so nobody is shown setup for
 * a part of the app they said they did not care about. When they picked nothing,
 * this step has nothing to offer and the flow skips it entirely rather than
 * showing an empty screen with a Continue button.
 *
 * Nothing here is pre-ticked. A starter habit somebody did not ask for is
 * clutter, and clutter in an app with nothing else in it is worse than
 * emptiness.
 */
export function ShapeStep({
  focusAreas,
  shape,
  onToggleHabit,
  onSetWaterGoal,
  onSetCurrency,
  onNext,
}: {
  focusAreas: FocusArea[];
  shape: ShapeChoices;
  onToggleHabit: (id: string) => void;
  onSetWaterGoal: (ml: number) => void;
  onSetCurrency: (code: string) => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const { c } = useTheme();

  const habits = suggestedHabits(focusAreas);
  const showWater = focusAreas.includes('water');
  const showCurrency = focusAreas.includes('budget');

  const currencyOptions = dedupe([
    ...(shape.currencyCode ? [shape.currencyCode] : []),
    ...COMMON_CURRENCIES,
  ]).slice(0, 6);

  return (
    <StepScaffold
      scroll
      eyebrow={t('onboarding.shapeEyebrow')}
      title={t('onboarding.shapeTitle')}
      body={t('onboarding.shapeBody')}
      footer={<Button variant="accent" size="lg" label={t('common.continue')} onPress={onNext} />}
    >
      <View className="gap-7 pb-4">
        {habits.length > 0 ? (
          <View className="gap-3">
            <Text variant="micro">{t('onboarding.starterHabits')}</Text>
            <View className={cardClass({ padding: 'none' }, 'px-4')}>
              {habits.map((habit, index) => {
                const checked = shape.starterHabits.includes(habit.id);
                return (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    accessibilityLabel={t(habit.labelKey)}
                    key={habit.id}
                    onPress={() => onToggleHabit(habit.id)}
                    className={
                      index === 0
                        ? 'flex-row items-center gap-3 py-3.5'
                        : 'flex-row items-center gap-3 border-t border-border py-3.5'
                    }
                  >
                    <Text style={{ fontSize: 20 }}>{habit.emoji}</Text>
                    <View className="flex-1">
                      <Text className="font-sora-medium text-foreground">{t(habit.labelKey)}</Text>
                      {habit.targetValue && habit.unitKey ? (
                        <Text variant="caption">
                          {habit.targetValue} {t(habit.unitKey)}
                        </Text>
                      ) : null}
                    </View>
                    <View
                      className="h-6 w-6 items-center justify-center rounded-full border"
                      style={{
                        borderColor: checked ? c.accent : c.border,
                        backgroundColor: checked ? c.accent : 'transparent',
                      }}
                    >
                      {checked ? (
                        <Check size={14} color={c.accentForeground} strokeWidth={3} />
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Text variant="caption" className="px-1">
              {t('onboarding.starterHabitsNote')}
            </Text>
          </View>
        ) : null}

        {showWater ? (
          <View className="gap-3">
            <Text variant="micro">{t('onboarding.waterGoal')}</Text>
            <View className="flex-row flex-wrap gap-2">
              {WATER_PRESETS.map((ml) => {
                const selected = shape.waterGoalMl === ml;
                return (
                  <Chip
                    key={ml}
                    label={`${(ml / 1000).toFixed(1).replace(/\.0$/, '')} L`}
                    selected={selected}
                    onPress={() => onSetWaterGoal(ml)}
                  />
                );
              })}
            </View>
          </View>
        ) : null}

        {showCurrency ? (
          <View className="gap-3">
            <Text variant="micro">{t('onboarding.currency')}</Text>
            <View className="flex-row flex-wrap gap-2">
              {currencyOptions.map((code) => (
                <Chip
                  key={code}
                  label={`${currencySymbol(code)} ${code}`}
                  selected={shape.currencyCode === code}
                  onPress={() => onSetCurrency(code)}
                />
              ))}
            </View>
            <Text variant="caption" className="px-1">
              {t('onboarding.currencyNote')}
            </Text>
          </View>
        ) : null}
      </View>
    </StepScaffold>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      className="rounded-full border px-4 py-2.5"
      style={{
        borderColor: selected ? c.accent : c.border,
        backgroundColor: selected ? alpha(c.accent, 0.12) : 'transparent',
      }}
    >
      <Text className="font-sora-medium" style={{ color: selected ? c.accent : c.foreground }}>
        {label}
      </Text>
    </Pressable>
  );
}

function dedupe(codes: string[]): string[] {
  return [
    ...new Set(codes.filter((code) => CURRENCIES.some((currency) => currency.code === code))),
  ];
}

/** True when this step has anything to offer. The flow checks it rather than
 *  rendering a screen whose only content is a Continue button. */
export function hasAnythingToShape(focusAreas: FocusArea[]): boolean {
  return (
    suggestedHabits(focusAreas).length > 0 ||
    focusAreas.includes('water') ||
    focusAreas.includes('budget')
  );
}
