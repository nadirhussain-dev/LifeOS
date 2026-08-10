import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArrowBack } from '@/components/ui/directional-icon';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { AboutYouStep } from '@/features/onboarding/components/about-you-step';
import { AccountStep } from '@/features/onboarding/components/account-step';
import { FocusStep } from '@/features/onboarding/components/focus-step';
import { LockStep } from '@/features/onboarding/components/lock-step';
import { ReadyStep } from '@/features/onboarding/components/ready-step';
import { ShapeStep, hasAnythingToShape } from '@/features/onboarding/components/shape-step';
import { WelcomeStep } from '@/features/onboarding/components/welcome-step';
import {
  applyOnboardingSeed,
  type SeedResult,
} from '@/features/onboarding/services/seed-from-onboarding';
import { useOnboardingDraftStore } from '@/features/onboarding/store/onboarding-draft-store';
import { useProfileStore } from '@/features/profile/store/profile-store';
import {
  authenticate,
  getBiometricLabel,
  isBiometricAvailable,
} from '@/features/security/lib/biometrics';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { deviceCurrencyCode } from '@/lib/locale';

/**
 * First-run setup.
 *
 * ## What changed and why
 *
 * This used to be five inlined screens in one file that asked for a name, a
 * gender, some focus areas and a biometric lock, then dropped the user on an
 * empty dashboard. Every answer was recorded and none of it produced anything,
 * which is the standard way an app loses somebody in the first minute: they have
 * told it everything about themselves and it has given them nothing back.
 *
 * Two structural changes fix that.
 *
 * **The account offer moved in here, and the welcome moved in front of it.**
 * `app/index.tsx` used to send every unauthenticated visitor to `(auth)/login`,
 * so the first screen of the app was a password field belonging to an app that
 * had not yet demonstrated doing anything. Now the value comes first and the
 * account is a real three-way choice one step in.
 *
 * **The focus answers now seed the app.** They decide what the "make it yours"
 * step offers, that step writes real habits and real settings, and the final
 * screen names what was created. Setup ends with an app that has the user's name
 * on it and something on it to do.
 *
 * ## Steps are a list, not a number
 *
 * The flow is a filtered array rather than an index into a fixed set, because two
 * steps are conditional — the account step disappears once there is a session,
 * and "make it yours" has nothing to offer to somebody who picked no focus
 * areas. Hardcoding indices around conditional screens is how a back button ends
 * up on a screen that no longer exists.
 */
type StepId = 'welcome' | 'account' | 'about' | 'focus' | 'shape' | 'lock' | 'ready';

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();

  const completeOnboarding = useProfileStore((s) => s.completeOnboarding);
  const session = useAuthStore((s) => s.session);
  const isGuest = useAuthStore((s) => s.isGuest);
  const continueAsGuest = useAuthStore((s) => s.continueAsGuest);
  const authProfile = useAuthStore((s) => s.profile);

  const draft = useOnboardingDraftStore();
  const {
    step,
    name,
    gender,
    focusAreas,
    shape,
    setStep,
    setName,
    setGender,
    toggleFocus,
    toggleStarterHabit,
    setWaterGoal,
    setCurrencyCode,
    reset: resetDraft,
  } = draft;

  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioLabel, setBioLabel] = useState('Biometrics');
  const [seed, setSeed] = useState<SeedResult>({
    habitsCreated: 0,
    waterGoalMl: null,
    currencyCode: null,
  });

  useEffect(() => {
    void isBiometricAvailable().then(setBioAvailable);
    void getBiometricLabel().then(setBioLabel);
  }, []);

  /**
   * Prefill from whatever we already know.
   *
   * Somebody who just signed in with Google has already told us their name;
   * asking for it again is the app not paying attention. Same for the currency —
   * the phone knows the region, so a 90-entry picker is a question with an
   * already-known answer. Both only fill a *blank* field, so neither can
   * overwrite something the user typed or chose.
   */
  useEffect(() => {
    const known = authProfile?.displayName?.trim();
    if (known && !name.trim()) setName(known);
  }, [authProfile?.displayName, name, setName]);

  useEffect(() => {
    if (shape.currencyCode) return;
    const local = deviceCurrencyCode();
    if (local) setCurrencyCode(local);
  }, [shape.currencyCode, setCurrencyCode]);

  const authed = !!session || isGuest;

  const steps = useMemo<StepId[]>(() => {
    const list: StepId[] = ['welcome'];
    // Skipped once there is a session or an explicit guest choice — including on
    // the way back from the email flow, which is exactly when re-asking would be
    // most confusing.
    if (!authed) list.push('account');
    list.push('about', 'focus');
    if (hasAnythingToShape(focusAreas)) list.push('shape');
    list.push('lock', 'ready');
    return list;
  }, [authed, focusAreas]);

  /**
   * Clamped, because the step list can shrink underneath a stored index — signing
   * in removes the account step, and deselecting every focus area removes
   * "make it yours". A persisted draft pointing past the end would otherwise
   * render nothing at all.
   */
  const index = Math.min(step, steps.length - 1);
  const current = steps[index];

  useEffect(() => {
    if (step !== index) setStep(index);
  }, [step, index, setStep]);

  const goNext = useCallback(
    () => setStep(Math.min(index + 1, steps.length - 1)),
    [index, steps.length, setStep],
  );
  const goBack = useCallback(() => setStep(Math.max(index - 1, 0)), [index, setStep]);

  /**
   * Runs the seed on the way into the final screen, not on the way out of it.
   *
   * The last screen's whole job is to say what was created, so the creating has
   * to have happened by the time it renders — and doing it here rather than in
   * `finish` also means a user who force-quits on the summary still keeps the
   * habits they chose.
   */
  const goToReady = useCallback(() => {
    setSeed(applyOnboardingSeed(shape));
    setStep(steps.indexOf('ready'));
  }, [shape, steps, setStep]);

  const finish = useCallback(
    (appLockEnabled: boolean) => {
      completeOnboarding({ name, gender, focusAreas, appLockEnabled });
      // The draft has served its purpose; a stale one is a bug waiting for the
      // next person who resets the app.
      resetDraft();
      router.replace('/(tabs)');
    },
    [completeOnboarding, name, gender, focusAreas, resetDraft, router],
  );

  const [lockChoice, setLockChoice] = useState(false);

  const enableLock = useCallback(async () => {
    const ok = await authenticate(t('onboarding.confirmMethod', { method: bioLabel }));
    if (!ok) return;
    setLockChoice(true);
    goToReady();
  }, [bioLabel, goToReady, t]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="h-12 flex-row items-center justify-center px-5">
        {index > 0 && current !== 'ready' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={goBack}
            hitSlop={10}
            className="absolute start-5"
          >
            <ArrowBack size={22} color={c.foreground} />
          </Pressable>
        ) : null}

        <View className="flex-row gap-1.5">
          {steps.map((id, i) => (
            <View
              key={id}
              className="h-1.5 rounded-full"
              style={{
                width: i === index ? 22 : 6,
                backgroundColor: i <= index ? c.accent : c.border,
              }}
            />
          ))}
        </View>
      </View>

      <Animated.View
        key={current}
        entering={reducedMotion ? undefined : FadeIn.duration(240)}
        className="flex-1"
      >
        {current === 'welcome' ? (
          <WelcomeStep onNext={goNext} onSignIn={() => router.push('/(auth)/login')} />
        ) : null}

        {current === 'account' ? (
          <AccountStep
            onSignedIn={goNext}
            onContinueAsGuest={() => {
              continueAsGuest();
              goNext();
            }}
            onUseEmail={() => router.push('/(auth)/sign-up')}
          />
        ) : null}

        {current === 'about' ? (
          <AboutYouStep
            name={name}
            onChangeName={setName}
            gender={gender}
            onChangeGender={setGender}
            onNext={goNext}
          />
        ) : null}

        {current === 'focus' ? (
          <FocusStep selected={focusAreas} onToggle={toggleFocus} onNext={goNext} />
        ) : null}

        {current === 'shape' ? (
          <ShapeStep
            focusAreas={focusAreas}
            shape={shape}
            onToggleHabit={toggleStarterHabit}
            onSetWaterGoal={setWaterGoal}
            onSetCurrency={setCurrencyCode}
            onNext={goNext}
          />
        ) : null}

        {current === 'lock' ? (
          <LockStep
            available={bioAvailable}
            methodLabel={bioLabel}
            onEnable={() => void enableLock()}
            onSkip={() => {
              setLockChoice(false);
              goToReady();
            }}
          />
        ) : null}

        {current === 'ready' ? (
          <ReadyStep name={name} seed={seed} onFinish={() => finish(lockChoice)} />
        ) : null}
      </Animated.View>
    </View>
  );
}
