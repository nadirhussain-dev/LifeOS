import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { BellRing, Compass, Lock, WifiOff, type LucideIcon } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { StepScaffold } from '@/features/onboarding/components/step-scaffold';
import { remindersForFocus } from '@/features/onboarding/services/reminder-defaults';
import type { FocusArea } from '@/features/profile/store/profile-store';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';

/**
 * How the app works, and the one permission it needs.
 *
 * ## Why four cards and not a tour of everything
 *
 * Daykeep has thirteen Hub modules on top of the four tab drivers and the
 * private space. A mandatory tour of all eighteen is a five-minute wall in
 * front of an app nobody has used, and the reliable outcome is that a large
 * share of installs never reach the dashboard at all.
 *
 * So this teaches the *shape* rather than the contents — the four things that
 * are genuinely non-obvious and that nothing else in the app ever explains:
 * where everything lives, that it works with no account and no signal, that the
 * private space is a different thing with a different lock, and that reminders
 * are how the app reaches you. Individual modules are introduced at the moment
 * they are opened, which is the only moment each one is relevant.
 *
 * ## Why the permission ask lives here
 *
 * Before this step, `requestNotificationPermission()` had two callers: the
 * settings screen, and the scheduling functions requesting it inline at the
 * moment they happened to need it. So the first time most people met the iOS
 * dialog was at some arbitrary later point with no context at all — which is
 * how a permission gets permanently denied, and a permanent denial makes every
 * reminder in the app dead regardless of what any switch says.
 *
 * Here it arrives immediately after a sentence explaining what it is for, and
 * after the app has already shown it does something. That ordering is the whole
 * intervention.
 *
 * The ask is a **button, not an automatic prompt on mount**. iOS gives one
 * chance per install; spending it on somebody who is still reading is spending
 * it badly. Someone who skips is not asked again here — the scheduling calls
 * still request it later, exactly as they did before.
 */

type Card = { id: string; icon: LucideIcon; titleKey: string; bodyKey: string };

/**
 * The four. Ordered by when the user will need them: where things are, then
 * what happens with no signal, then the space that behaves differently, then
 * the thing that brings them back.
 */
const CARDS: Card[] = [
  {
    id: 'layout',
    icon: Compass,
    titleKey: 'onboarding.learnLayoutTitle',
    bodyKey: 'onboarding.learnLayoutBody',
  },
  {
    id: 'offline',
    icon: WifiOff,
    titleKey: 'onboarding.learnOfflineTitle',
    bodyKey: 'onboarding.learnOfflineBody',
  },
  {
    id: 'private',
    icon: Lock,
    titleKey: 'onboarding.learnPrivateTitle',
    bodyKey: 'onboarding.learnPrivateBody',
  },
  {
    id: 'reminders',
    icon: BellRing,
    titleKey: 'onboarding.learnRemindersTitle',
    bodyKey: 'onboarding.learnRemindersBody',
  },
];

export function LearnStep({
  focusAreas,
  onAllowReminders,
  onNext,
}: {
  focusAreas: FocusArea[];
  /** Requests the OS permission. Resolves to whether it was granted. */
  onAllowReminders: () => Promise<boolean>;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const reducedMotion = useReducedMotion();
  const [asking, setAsking] = useState(false);
  const [answered, setAnswered] = useState(false);

  // What will actually be switched on, named specifically. "We'll send you
  // reminders" is a thing to be wary of; "a nudge at 9pm to write your journal"
  // is a thing to agree to — and this is the list the next screen will confirm,
  // so it must not promise anything `applyReminderDefaults` will not deliver.
  const willEnable = remindersForFocus(focusAreas);

  const ask = async () => {
    setAsking(true);
    try {
      await onAllowReminders();
    } finally {
      setAsking(false);
      // Answered either way. iOS shows this once per install, so a refusal is
      // final and re-offering the button would be offering nothing.
      setAnswered(true);
    }
  };

  return (
    <StepScaffold
      scroll
      eyebrow={t('onboarding.learnEyebrow')}
      title={t('onboarding.learnTitle')}
      body={t('onboarding.learnBody')}
      footer={
        <>
          {!answered ? (
            <Button
              variant="accent"
              size="lg"
              label={t('onboarding.learnAllow')}
              disabled={asking}
              onPress={() => void ask()}
            />
          ) : null}
          <Button
            // Secondary once the ask is on screen, so there is one obvious
            // primary action rather than two competing ones.
            variant={answered ? 'accent' : 'ghost'}
            size="lg"
            label={answered ? t('common.continue') : t('onboarding.learnNotNow')}
            onPress={onNext}
          />
        </>
      }
    >
      <View className="gap-3 pb-4">
        {CARDS.map((card, index) => {
          const Icon = card.icon;
          const isReminders = card.id === 'reminders';
          return (
            <Animated.View
              key={card.id}
              entering={reducedMotion ? undefined : FadeInDown.delay(index * 70).duration(320)}
              className={cardClass({ padding: 'md' }, 'flex-row gap-3.5')}
            >
              <View
                className="h-9 w-9 items-center justify-center rounded-xl"
                style={{ backgroundColor: alpha(c.accent, 0.14) }}
              >
                <Icon size={18} color={c.accent} strokeWidth={2} />
              </View>
              <View className="flex-1 gap-1">
                <Text className="font-sora-semibold">{t(card.titleKey)}</Text>
                <Text variant="caption">{t(card.bodyKey)}</Text>
                {isReminders && willEnable.length > 0 ? (
                  <Text variant="caption" style={{ color: c.accent }}>
                    {t('onboarding.learnRemindersList', {
                      modules: willEnable.map((id) => t(`syncModule.${id}`)).join(', '),
                    })}
                  </Text>
                ) : null}
              </View>
            </Animated.View>
          );
        })}
      </View>
    </StepScaffold>
  );
}
