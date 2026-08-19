import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArrowBack } from '@/components/ui/directional-icon';
import type { FunnelMetric } from '@/features/analytics/config/funnel-metrics';
import { trackFunnel } from '@/features/analytics/store/funnel-store';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { AboutYouStep } from '@/features/onboarding/components/about-you-step';
import { AccountStep } from '@/features/onboarding/components/account-step';
import { FocusStep } from '@/features/onboarding/components/focus-step';
import { LearnStep } from '@/features/onboarding/components/learn-step';
import { LockStep } from '@/features/onboarding/components/lock-step';
import { ReadyStep } from '@/features/onboarding/components/ready-step';
import { ShapeStep, hasAnythingToShape } from '@/features/onboarding/components/shape-step';
import { WelcomeStep } from '@/features/onboarding/components/welcome-step';
import {
  applyOnboardingSeed,
  type SeedResult,
} from '@/features/onboarding/services/seed-from-onboarding';
import {
  applyReminderDefaults,
  type DefaultedReminder,
} from '@/features/onboarding/services/reminder-defaults';
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
import { requestNotificationPermission } from '@/lib/notifications';

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
type StepId = 'welcome' | 'account' | 'about' | 'focus' | 'shape' | 'learn' | 'lock' | 'ready';

/**
 * The funnel metric each step reports on arrival.
 *
 * `welcome` is `onboarding_started` rather than `onboarding_reached_welcome`,
 * because it is the denominator every other rung is read against and naming it
 * for the step would bury that.
 */
const FUNNEL_FOR_STEP: Record<StepId, FunnelMetric> = {
  welcome: 'onboarding_started',
  account: 'onboarding_reached_account',
  about: 'onboarding_reached_about',
  focus: 'onboarding_reached_focus',
  shape: 'onboarding_reached_shape',
  learn: 'onboarding_reached_learn',
  lock: 'onboarding_reached_lock',
  ready: 'onboarding_reached_ready',
};

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();

  const completeOnboarding = useProfileStore((s) => s.completeOnboarding);
  const markAccountOnboarded = useProfileStore((s) => s.markAccountOnboarded);
  const session = useAuthStore((s) => s.session);
  const markOnboardingComplete = useAuthStore((s) => s.markOnboardingComplete);
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
    // After the answers, before the finish. It needs the focus areas to name
    // which reminders it is about to switch on, and it has to come before
    // `ready` so the receipt there can confirm what actually landed.
    list.push('learn');
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

  /**
   * Reports the step the user has actually reached.
   *
   * Driven off `current` rather than fired from each step's own `onNext`, for
   * the same reason `useUsageReporter` derives module opens from the route: a
   * call somebody has to remember to add in seven places is a call that goes
   * missing from one of them, and the symptom is a funnel with a hole in it
   * that reads exactly like a drop-off.
   *
   * Deduped per step per session by `reported`, because going back and forward
   * again is one person reaching a step, not two — the server counts totals and
   * distinct installs separately, and only the second is the funnel.
   */
  const reported = useRef<Set<string>>(new Set());
  useEffect(() => {
    const metric = FUNNEL_FOR_STEP[current];
    if (!metric || reported.current.has(metric)) return;
    reported.current.add(metric);
    trackFunnel(metric);
  }, [current]);

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
      trackFunnel('onboarding_completed');
      completeOnboarding({ name, gender, focusAreas, appLockEnabled });
      // Two records, and the difference matters.
      //
      // Locally: which ACCOUNT finished, not just that somebody did. This is
      // the one that survives with no network, and the one that stops the next
      // account to sign in on this phone inheriting the flow it never saw —
      // see features/onboarding/services/onboarding-scope.ts.
      if (session) markAccountOnboarded(session.user.id);
      // On the server: so some OTHER device this account signs into later can
      // skip the flow. Fired without awaiting, because this device already has
      // its answer and a slow or failed write must not delay the dashboard.
      if (session) void markOnboardingComplete();
      // The draft has served its purpose; a stale one is a bug waiting for the
      // next person who resets the app.
      resetDraft();
      router.replace('/(tabs)');
    },
    [
      completeOnboarding,
      name,
      gender,
      focusAreas,
      resetDraft,
      router,
      session,
      markAccountOnboarded,
      markOnboardingComplete,
    ],
  );

  const [lockChoice, setLockChoice] = useState(false);
  const [remindersOn, setRemindersOn] = useState<DefaultedReminder[]>([]);

  /**
   * The one permission ask, in front of the sentence explaining it.
   *
   * Everything the app schedules is dead without this, and iOS gives one
   * chance per install — which is why it is here rather than fired from
   * whichever scheduling call happens to run first, with no context at all.
   */
  const allowReminders = useCallback(async () => {
    // Shown is counted separately from the two answers: a prompt nobody reaches
    // and a prompt everybody declines produce the same number of grants and
    // want opposite fixes.
    trackFunnel('notif_prompt_shown');
    const granted = await requestNotificationPermission();
    trackFunnel(granted ? 'notif_permission_granted' : 'notif_permission_denied');
    if (granted) {
      // Only now. Every scheduling call below no-ops without permission, and a
      // set of switches flipped on for reminders that cannot fire is exactly
      // the "settings screen describing something that does not happen" bug
      // this whole area already has.
      setRemindersOn(await applyReminderDefaults(focusAreas));
    }
    return granted;
  }, [focusAreas]);

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

        {current === 'learn' ? (
          <LearnStep focusAreas={focusAreas} onAllowReminders={allowReminders} onNext={goNext} />
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
          <ReadyStep
            name={name}
            seed={seed}
            remindersOn={remindersOn}
            onFinish={() => finish(lockChoice)}
          />
        ) : null}
      </Animated.View>
    </View>
  );
}
