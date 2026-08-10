import { updateBudgetSettings } from '@/features/budget/services/budget-repository';
import { createHabit } from '@/features/habits/services/habits-repository';
import { STARTER_HABITS } from '@/features/onboarding/config/starter-habits';
import type { ShapeChoices } from '@/features/onboarding/store/onboarding-draft-store';
import { useWaterSettingsStore } from '@/features/water-intake/store/water-settings-store';
import i18n from '@/lib/i18n';
import { reportError } from '@/lib/error-reporting';

/**
 * Turns the onboarding answers into real rows and real settings.
 *
 * This is the difference between onboarding that asks and onboarding that sets
 * up. Everything here is something the app would otherwise have made the user
 * find later, in a settings screen they did not know existed — the water goal,
 * the budget currency, and a couple of habits so the Today screen has something
 * on it the first time it is opened.
 *
 * ## Each step is isolated
 *
 * A failure in any one of these must not cost the others, and must never block
 * finishing setup. Someone whose habit insert fails should still land in the app
 * with their name and their currency set; being bounced back to a spinner
 * because a seed row failed is a far worse outcome than a missing habit. So each
 * piece is caught separately and the result reports what actually landed, which
 * is also what the final screen reads from — it says what was created rather
 * than what was requested.
 */
export type SeedResult = {
  habitsCreated: number;
  waterGoalMl: number | null;
  currencyCode: string | null;
};

export function applyOnboardingSeed(shape: ShapeChoices): SeedResult {
  const result: SeedResult = { habitsCreated: 0, waterGoalMl: null, currencyCode: null };

  for (const id of shape.starterHabits) {
    const starter = STARTER_HABITS.find((h) => h.id === id);
    if (!starter) continue;
    try {
      createHabit({
        // Translated at creation time, then stored as text. A habit is the
        // user's own content from this point on — re-translating it when they
        // change language would silently rewrite something they may have edited.
        name: i18n.t(starter.labelKey),
        emoji: starter.emoji,
        type: starter.type,
        scheduleType: starter.scheduleType,
        targetValue: starter.targetValue ?? null,
        unit: starter.unitKey ? i18n.t(starter.unitKey) : null,
      });
      result.habitsCreated += 1;
    } catch (error) {
      reportError(error, { scope: 'onboarding-seed:habit' });
    }
  }

  if (shape.waterGoalMl != null) {
    try {
      useWaterSettingsStore.getState().setGoal(shape.waterGoalMl);
      result.waterGoalMl = shape.waterGoalMl;
    } catch (error) {
      reportError(error, { scope: 'onboarding-seed:water' });
    }
  }

  if (shape.currencyCode) {
    try {
      updateBudgetSettings({ currency: shape.currencyCode });
      result.currencyCode = shape.currencyCode;
    } catch (error) {
      reportError(error, { scope: 'onboarding-seed:currency' });
    }
  }

  return result;
}
