import * as Haptics from 'expo-haptics';
import { format } from 'date-fns/format';
import { useKeepAwake } from 'expo-keep-awake';
import { useRouter, useSegments } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CelebrationOverlay } from '@/components/ui/celebration-overlay';
import { BellOff, Moon, Pause, Play, Square, SkipForward } from '@/components/ui/icons';
import { ProgressRing } from '@/components/ui/progress-ring';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { showInterstitial } from '@/features/ads/services/interstitial';
import { ReflectionSheet } from '@/features/study/components/reflection-sheet';
import {
  canOpenSystemDoNotDisturb,
  enterFocusMode,
  exitFocusMode,
  openSystemDoNotDisturb,
} from '@/features/study/services/focus-mode';
import { formatStudyDuration, formatTimer } from '@/features/study/services/study-stats';
import { useStudyMutations } from '@/features/study/hooks/use-study-mutations';
import { useStudySubjects } from '@/features/study/hooks/use-study';
import { useFocusModeStore } from '@/features/study/store/focus-mode-store';
import {
  elapsedInPhaseNow,
  focusSecondsNow,
  remainingSeconds,
  targetSeconds,
  useStudyTimerStore,
} from '@/features/study/store/study-timer-store';
import { contentTints, moduleTints, type TintPair } from '@/constants/design-tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

/**
 * The two phases.
 *
 * `focus` is the Study module's own tint, so a focus session looks like Study —
 * it used to be `#8b5cf6`, which is Study's *dark* value and Journal's *light*
 * one, so on light theme the timer wore Journal's violet. `break` is content
 * green (the `#22c55e` that was hardcoded, so unchanged on light) rather than
 * `success`: finishing a break is not an achievement, it is a phase.
 *
 * Pairs, not hexes, so both retune for dark like everything else.
 */
const PHASE_TINT = {
  focus: moduleTints.study,
  break: contentTints.green,
} as const satisfies Record<string, TintPair>;

export default function StudyTimerScreen() {
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const { resolve } = useTheme();
  const { t } = useTranslation();
  const store = useStudyTimerStore();
  const { logSession } = useStudyMutations();
  const { data: subjects = [] } = useStudySubjects();

  const [now, setNow] = useState(() => Date.now());
  const [celebrate, setCelebrate] = useState(false);
  const [reflectOpen, setReflectOpen] = useState(false);
  const [pendingFocusSecs, setPendingFocusSecs] = useState(0);
  const savedRef = useRef(false);
  const heldCount = useFocusModeStore((s) => s.heldTitles.length);

  // The countdown is only useful if it's visible — hold the screen on for as
  // long as this screen is mounted.
  useKeepAwake();

  // Bounce out if opened without an active session (mount-only).
  useEffect(() => {
    if (!useStudyTimerStore.getState().active) router.back();
  }, [router]);

  // 4Hz tick drives the countdown display and phase-completion checks.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, []);

  // Summary text for reminders held back during the block, so the notification
  // layer doesn't have to reach into i18n. Held in a ref as well: `t` changes
  // identity when the language does, and the effects below must not treat that
  // as a reason to tear the shield down mid-session.
  const summarizeHeld = useCallback(
    (count: number) => ({
      title: t('study.focusHeldTitle'),
      body: t('study.focusHeldBody', { count }),
    }),
    [t],
  );
  const summarizeRef = useRef(summarizeHeld);
  summarizeRef.current = summarizeHeld;

  // The interruption shield is raised only while a focus block is actually
  // running — a break, or a paused timer, is exactly when the user does want
  // their reminders and their music back.
  const shieldUp = store.active && store.running && store.phase === 'focus';
  useEffect(() => {
    if (shieldUp) enterFocusMode();
    else void exitFocusMode(summarizeRef.current);
  }, [shieldUp]);

  // Leaving the screen by any route must drop the shield — without this, an
  // abandoned session would keep swallowing reminders indefinitely. Empty deps
  // so this runs on unmount and nothing else.
  useEffect(() => {
    return () => {
      void exitFocusMode(summarizeRef.current);
    };
  }, []);

  // Ends the session: sub-minute sessions are discarded, otherwise the timer
  // is frozen and the reflection sheet collects an optional focus rating + note
  // before the session is saved.
  const requestFinish = () => {
    if (savedRef.current || reflectOpen) return;
    const s = useStudyTimerStore.getState();
    const focusSecs = Math.round(focusSecondsNow(s, Date.now()));
    if (focusSecs < 60) {
      savedRef.current = true;
      store.reset();
      router.back();
      return;
    }
    s.pause();
    setPendingFocusSecs(focusSecs);
    setReflectOpen(true);
  };

  // Android's back button is the one way out that isn't a deliberate tap on
  // "end session" — `gestureEnabled: false` covers the swipe, this covers the
  // button, so a focus block can't be lost by reflex.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (savedRef.current || reflectOpen) return false;
      if (!useStudyTimerStore.getState().active) return false;
      void confirm({
        title: t('study.leaveFocusTitle'),
        message: t('study.leaveFocusBody'),
        confirmLabel: t('study.endSession'),
        cancelLabel: t('study.keepFocusing'),
        destructive: true,
      }).then((ok) => ok && requestFinish());
      return true; // handled — don't pop the screen
    });
    return () => subscription.remove();
    // requestFinish closes over state that is re-read from the store when it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reflectOpen, t]);

  const commitReflection = (focusRating: number | null, note: string) => {
    if (savedRef.current) return;
    savedRef.current = true;
    const s = useStudyTimerStore.getState();
    logSession.mutate({
      subjectId: s.subjectId,
      logDate: format(new Date(), 'yyyy-MM-dd'),
      startedAt: s.startedAt ?? Date.now(),
      endedAt: Date.now(),
      durationSeconds: pendingFocusSecs,
      mode: s.mode,
      focusRating,
      note: note || null,
    });
    setReflectOpen(false);
    store.reset();
    router.back();
    // A finished study session is one of the few genuine breakpoints in this
    // app: the work is done, saved, and the user is on their way out. Every
    // gate is in `showInterstitial` — this call site decides nothing except
    // that this moment is a break, and it does not await the result because
    // nothing here depends on whether an ad appeared.
    void showInterstitial({ segments, breakpoint: 'study-session-end' });
  };

  const promptSystemDnd = () => {
    void confirm({
      title: t('study.silencePhoneTitle'),
      message: t('study.silencePhoneBody'),
      confirmLabel: t('study.openDndSettings'),
      cancelLabel: t('common.cancel'),
    }).then(async (ok) => {
      if (!ok) return;
      const opened = await openSystemDoNotDisturb();
      if (!opened) toast.info(t('study.dndUnavailableBody'));
    });
  };

  // Phase-completion handling.
  useEffect(() => {
    const s = useStudyTimerStore.getState();
    if (!s.active || !s.running) return;
    // Stopwatch counts up open-endedly — it never auto-completes.
    if (s.mode === 'stopwatch') return;
    if (remainingSeconds(s, now) > 0) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (s.phase === 'focus') {
      if (s.mode === 'pomodoro') {
        s.completeFocus();
        setCelebrate(true);
      } else {
        requestFinish();
      }
    } else {
      s.completeBreak();
    }
    // requestFinish / store actions are stable; now is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  if (!store.active) return null;

  const isStopwatch = store.mode === 'stopwatch';
  const isFocus = store.phase === 'focus';
  const tint = resolve(PHASE_TINT[isFocus ? 'focus' : 'break']);
  const target = targetSeconds(store);
  const elapsed = elapsedInPhaseNow(store, now);
  const remaining = remainingSeconds(store, now);
  // Stopwatch counts up (and its ring sweeps once per minute); timed modes count down.
  const displaySeconds = isStopwatch ? elapsed : remaining;
  const ratio = isStopwatch ? (elapsed % 60) / 60 : target > 0 ? Math.min(1, elapsed / target) : 0;
  const phaseLabel = isStopwatch
    ? t('study.modeStopwatch')
    : isFocus
      ? t('study.phaseFocus')
      : t('study.phaseBreak');
  const subject = subjects.find((s) => s.id === store.subjectId) ?? null;
  const totalFocus = focusSecondsNow(store, now);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top + 12 }}>
      <View className="flex-1 items-center justify-center gap-10 px-6">
        <View className="items-center gap-1.5">
          <View
            className="flex-row items-center gap-2 rounded-full px-3 py-1"
            style={{ backgroundColor: `${tint}1f` }}
          >
            <View className="h-2 w-2 rounded-full" style={{ backgroundColor: tint }} />
            <Text variant="sectionLabel" style={{ color: tint }}>
              {phaseLabel}
            </Text>
          </View>
          <Text variant="muted">{subject?.name ?? t('study.generalStudy')}</Text>
        </View>

        <ProgressRing
          progress={ratio}
          size={260}
          strokeWidth={16}
          color={tint}
          duration={300}
          gradient
        >
          <View className="items-center gap-1">
            <Text
              className="font-sora-extrabold text-6xl text-foreground"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatTimer(displaySeconds)}
            </Text>
            <Text variant="caption">
              {store.completedPomodoros > 0
                ? t('study.doneAndFocused', {
                    count: store.completedPomodoros,
                    duration: formatStudyDuration(totalFocus),
                  })
                : t('study.focused', { duration: formatStudyDuration(totalFocus) })}
            </Text>
          </View>
        </ProgressRing>

        <View className="w-full flex-row items-center justify-center gap-4">
          {isFocus ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={() => useStudyTimerStore.getState().completeBreak()}
              className="h-14 w-14 items-center justify-center rounded-full border border-border"
              accessibilityLabel={t('study.skipBreak')}
            >
              <SkipForward size={22} color={colors[scheme].foreground} />
            </Pressable>
          )}

          <Pressable
            accessibilityRole="button"
            onPress={() => (store.running ? store.pause() : store.resume())}
            className="h-20 w-20 items-center justify-center rounded-full"
            style={{ backgroundColor: tint }}
            accessibilityLabel={store.running ? t('study.pause') : t('study.resume')}
          >
            {store.running ? (
              <Pause size={30} color="#ffffff" fill="#ffffff" />
            ) : (
              <Play size={30} color="#ffffff" fill="#ffffff" />
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={requestFinish}
            className="h-14 w-14 items-center justify-center rounded-full border border-border"
            accessibilityLabel={t('study.endSession')}
          >
            <Square
              size={20}
              color={colors[scheme].destructive}
              fill={colors[scheme].destructive}
            />
          </Pressable>
        </View>

        <Text variant="caption" className="text-center">
          {isStopwatch
            ? t('study.hintStopwatch')
            : isFocus
              ? t('study.hintFocus')
              : t('study.hintBreak')}
        </Text>

        {/* Focus shield: what Daykeep is holding back, and the one thing it
            can't do on its own (silence the phone). */}
        {shieldUp && (
          <View className="w-full items-center gap-2.5">
            <View className="flex-row items-center gap-2">
              <BellOff size={14} color={colors[scheme].mutedForeground} />
              <Text variant="caption" className="text-center">
                {heldCount > 0
                  ? t('study.focusShieldHolding', { count: heldCount })
                  : t('study.focusShieldOn')}
              </Text>
            </View>

            {canOpenSystemDoNotDisturb() && (
              <Pressable
                onPress={promptSystemDnd}
                hitSlop={8}
                className="flex-row items-center gap-2 rounded-full border border-border px-3.5 py-2"
                accessibilityRole="button"
                accessibilityLabel={t('study.silencePhone')}
              >
                <Moon size={14} color={tint} />
                <Text variant="caption" className="font-sora-semibold" style={{ color: tint }}>
                  {t('study.silencePhone')}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      <CelebrationOverlay visible={celebrate} onDone={() => setCelebrate(false)} />
      <ReflectionSheet
        visible={reflectOpen}
        focusSeconds={pendingFocusSecs}
        onSave={commitReflection}
      />
    </View>
  );
}
