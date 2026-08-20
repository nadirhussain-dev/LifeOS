import '@/global.css';
import i18n from '@/lib/i18n';

import {
  Literata_400Regular,
  Literata_400Regular_Italic,
  Literata_500Medium,
  Literata_600SemiBold,
} from '@expo-google-fonts/literata';
import {
  Sora_400Regular,
  Sora_500Medium,
  Sora_600SemiBold,
  Sora_700Bold,
  Sora_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/sora';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Text as RNText, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnimatedSplash } from '@/components/animated-splash';
import { initDatabase } from '@/database/client';
import { reportError } from '@/lib/error-reporting';
import { ErrorBoundary } from '@/components/error-boundary';
import { NotificationBanner } from '@/components/ui/notification-banner';
import { ToastHost } from '@/components/ui/toast';
import { DevErrorBanner } from '@/components/dev/dev-error-banner';
import { MiniPlayerBar } from '@/features/music/components/mini-player-bar';
import { useNotificationCenter } from '@/features/notifications/hooks/use-notification-center';
import { useNotificationNavigation } from '@/features/notifications/hooks/use-notification-navigation';
import { applyDeliveryMode } from '@/features/notifications/services/delivery';
import { resyncAllReminders } from '@/features/notifications/services/reminder-scheduler';
import { syncTodayWidget } from '@/features/widgets/services/widget-data';
import { useWidgetSync } from '@/features/widgets/hooks/use-widget-sync';
import { useProfileStore } from '@/features/profile/store/profile-store';
import {
  registerPushToken,
  unregisterPushToken,
} from '@/features/split/services/push-registration';
import { useLanguageStore } from '@/features/settings/store/language-store';
import { AppLockOverlay } from '@/features/security/components/app-lock-overlay';
import { useAppLock } from '@/features/security/hooks/use-app-lock';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { useAuthGate } from '@/features/auth/hooks/use-auth-gate';
import { useDeviceSessionSync } from '@/features/auth/hooks/use-device-session';
import { DeviceGateOverlay } from '@/features/auth/components/device-gate-overlay';
import { useUsageReporter } from '@/features/analytics/hooks/use-usage-reporter';
import { useAdSession } from '@/features/ads/hooks/use-ad-session';
import { useChallengeTracking } from '@/features/challenge/hooks/use-challenge-tracking';
import { AmbientBackground } from '@/components/ui/ambient-background';
import { DialogHost } from '@/components/ui/dialog-host';
import { Grain } from '@/components/ui/grain';
import { SystemBarsBridge } from '@/components/ui/system-bars';
import { UsageConsentCard } from '@/features/analytics/components/usage-consent-card';
import { BlockedOverlay } from '@/features/moderation/components/blocked-overlay';
import { useBillingSync } from '@/features/billing/hooks/use-billing';
import { useAccountStandingSync } from '@/features/moderation/hooks/use-account-standing';
import {
  useModuleFlagsSync,
  useModuleRouteGuard,
} from '@/features/module-flags/hooks/use-module-access';
import { usePrivateAutoLock } from '@/features/private/hooks/use-private-lock';
import { syncCycleReminders } from '@/features/private/services/cycle-reminders';
// Side-effect only: registers Together's and Cycle's reminders into
// resyncAllReminders() without that file ever importing features/private
// directly — see register-reminders.ts and reminder-scheduler.ts's own
// comment on why.
import '@/features/private/services/register-reminders';
import '@/features/insights/services/register-reminders';
// Likewise for the streak reminders, which were the one scheduler the launch
// rebuild could not see — so its cancel-all deleted them and nothing put them
// back. See features/challenge/services/register-reminders.ts.
import '@/features/challenge/services/register-reminders';
import { usePrivateStore } from '@/features/private/store/private-store';
import { useSplashStore } from '@/hooks/use-splash-store';
import { useSyncTrigger } from '@/features/sync/hooks/use-sync';
import { SyncStatusBridge } from '@/features/sync/components/sync-status-bridge';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { initAds } from '@/lib/ads-init';
import { configureAndroidChannels, configureNotificationHandler } from '@/lib/notifications';
import { queryClient } from '@/lib/query-client';
import { initSentry } from '@/lib/sentry';

SplashScreen.preventAutoHideAsync();

// Route caught errors to Sentry when a DSN is configured (no-op otherwise).
initSentry();

// Google Mobile Ads SDK — see features/ads/config.ts for the placement
// rules and lib/ads-init.ts for why this is safe to call unconditionally.
initAds();

// Without a handler, expo-notifications suppresses notifications delivered
// while the app is foregrounded — water reminders should still show even if
// the app happens to be open at the time.
configureNotificationHandler();
// Start creating the Android notification channels. The schedulers await the
// same promise before posting anything, so a reminder can't land on Android's
// generic fallback channel by racing this. Caught here because the promise
// rejects on failure (so the next caller retries rather than inheriting a
// permanently-failed cache) and this call site has nowhere to report it.
void configureAndroidChannels().catch(() => undefined);

/** Lives inside the router + query provider so it can deep-link on notification
 * taps and mark inbox rows read. Renders nothing. */
function NotificationNavigationBridge() {
  useNotificationNavigation();
  return null;
}

/** Records arriving notifications in the in-app inbox and raises the in-app
 * banner (the OS banner is suppressed while foregrounded). Renders nothing. */
function NotificationCenterBridge() {
  useNotificationCenter();
  return null;
}

/** Redirects between the auth flow and the app. Must live inside the navigation
 * tree (uses router/segments). Renders nothing. */
function AuthGate() {
  useAuthGate();
  return null;
}

/**
 * Keeps every screen's content clear of the Android navigation bar.
 *
 * `edgeToEdgeEnabled` (app.json) means the system bars are drawn *over* the
 * app, so the bottom ~48dp of every scene is behind the navigation bar unless
 * something accounts for it. `ScreenHeader` has always handled the top inset;
 * nothing handled the bottom one, and the result was the last line of content
 * on a scrolled screen sliced in half by the bar — on Settings, the paragraph
 * explaining where per-item reminders live.
 *
 * Applied to the navigator rather than to each screen, because the alternative
 * was fifty separate `pb-*` values that all had to be right and stay right:
 * exactly six screens in the app read `insets.bottom` today, and every one of
 * the other fifty was wrong the same way. A rule here cannot be forgotten by
 * the next screen somebody adds.
 *
 * The existing `pb-10`-style padding inside each ScrollView is left alone. It
 * was never nav-bar clearance — it is breathing room under the last card, and
 * it still reads as that once the bar is no longer on top of it.
 *
 * Two exclusions, both deliberate:
 *  - `(tabs)`, because `TabBar` already insets itself (`Math.max(insets.bottom,
 *    10)`) and padding the scene as well would lift the bar off the edge.
 *  - the full-screen photo story, which is meant to run edge to edge; letterboxing
 *    an immersive viewer is a regression, not a fix.
 */
function useSceneBottomInset() {
  const insets = useSafeAreaInsets();
  return insets.bottom;
}

/** Drives automatic local↔cloud sync while signed in. Renders nothing. */
function SyncTrigger() {
  useSyncTrigger();
  return null;
}

/** Refreshes the home-screen widget when tasks/habits/water change. Renders nothing. */
function WidgetSync() {
  useWidgetSync();
  return null;
}

/** Counts which modules get opened, and flushes the rollup on background. Must
 * live inside the router (reads the pathname). Renders nothing. */
function UsageReporter() {
  useUsageReporter();
  return null;
}

/** Observes database writes and hands the day's evidence to the server. Only
 *  does anything once somebody is actually in a run. Renders nothing. */
function ChallengeTracking() {
  useChallengeTracking();
  return null;
}

/** Marks ad-session boundaries and keeps one interstitial preloaded, so the
 *  session cap and the launch guard share one idea of when a session began.
 *  Renders nothing. */
function AdSession() {
  useAdSession();
  return null;
}

/** Keeps the account's moderation standing fresh, so an expired restriction
 * clears itself and a blocked account can be told why. Renders nothing. */
function AccountStandingBridge() {
  useAccountStandingSync();
  return null;
}

/** Claims the account for this device and notices when another one takes it —
 *  see migration 0047 and use-device-session.ts. Renders nothing. */
function DeviceSessionBridge() {
  useDeviceSessionSync();
  return null;
}

/** Keeps the plan cache fresh — see use-billing.ts's useBillingSync. Renders
 *  nothing. */
function BillingSyncBridge() {
  useBillingSync();
  return null;
}

/** Applies the persisted language to i18next once the store hydrates / changes. */
/** Registers this device for group push once there is a session, and releases
 *  it on sign-out so a shared phone stops receiving a previous account's
 *  group notifications. Only shared features need a server-side token — every
 *  other reminder is scheduled locally. */
function PushRegistrationBridge() {
  const session = useAuthStore((s) => s.session);
  useEffect(() => {
    if (session) void registerPushToken();
    else void unregisterPushToken();
  }, [session]);
  return null;
}

function LanguageBridge() {
  const language = useLanguageStore((s) => s.language);
  useEffect(() => {
    void i18n.changeLanguage(language);
  }, [language]);
  return null;
}

/** Raises the app-lock shield on cold start / when returning from background. */
function AppLockController() {
  useAppLock();
  return null;
}

/** Drops the private space's key when the app leaves the foreground. Separate
 * from the app lock on purpose: unlocking the app must not unlock the vault. */
function PrivateAutoLock() {
  usePrivateAutoLock();
  return null;
}

/** Rebuilds the Cycle "period expected soon" reminder the moment the vault
 * unlocks — resyncAllReminders() alone never sees cycle data at cold launch,
 * since that runs before a PIN has been entered. See cycle-reminders.ts's
 * header. Renders nothing. */
function CycleReminderBridge() {
  const key = usePrivateStore((s) => s.key);
  useEffect(() => {
    if (key) void syncCycleReminders();
  }, [key]);
  return null;
}

/** Pulls the operator's module switches on launch and each foreground, so a
 * module can be withdrawn without an app-store round trip. Renders nothing. */
function ModuleFlagsBridge() {
  useModuleFlagsSync();
  return null;
}

/** Redirects off any module that is switched off or kept private and locked.
 * Must live inside the router (reads the pathname). Renders nothing. */
function ModuleRouteGuard() {
  useModuleRouteGuard();
  return null;
}

/**
 * Shown when the encrypted database cannot be opened, which is the one failure
 * the app has nothing to fall back to — every screen reads from it.
 *
 * Deliberately plain `View`/`Text` with inline styles: this renders before
 * fonts have loaded and outside the ErrorBoundary (which lives further down
 * this tree and so cannot catch a throw from RootLayout itself), so it must not
 * depend on anything that might also be broken.
 */
function DatabaseUnavailable({ message, background }: { message: string; background: string }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        gap: 12,
        backgroundColor: background,
      }}
    >
      <RNText style={{ fontSize: 18, fontWeight: '700', color: '#ef4444', textAlign: 'center' }}>
        Daykeep can’t open its database
      </RNText>
      <RNText style={{ fontSize: 14, color: '#6b7280', textAlign: 'center' }}>{message}</RNText>
    </View>
  );
}

/** Every route in the app, with the scene padding that keeps content clear of
 *  the Android navigation bar — see useSceneBottomInset. */
function AppNavigator({ background }: { background: string }) {
  const bottom = useSceneBottomInset();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: background, paddingBottom: bottom },
      }}
    >
      <Stack.Screen name="(auth)" />
      {/* Where a provider sign-in lands when the OS delivers the
            redirect to the app rather than to the browser session that
            opened it. Outside `(auth)` because the path is fixed by
            `oauthRedirectUrl()` and allow-listed on the Supabase
            project — see app/auth/callback.tsx. */}
      <Stack.Screen name="auth/callback" />
      <Stack.Screen name="(onboarding)" />
      {/* The tab bar insets itself; padding the scene too would lift it off the edge. */}
      <Stack.Screen name="(tabs)" options={{ contentStyle: { backgroundColor: background } }} />
      <Stack.Screen name="notes" />
      <Stack.Screen name="music" />
      <Stack.Screen name="insights/index" />
      <Stack.Screen name="challenge/index" />
      <Stack.Screen name="challenge/join" options={{ presentation: 'modal' }} />
      <Stack.Screen name="challenge/swap" options={{ presentation: 'modal' }} />
      <Stack.Screen name="challenge/timeline" />
      <Stack.Screen name="goals/index" />
      <Stack.Screen name="goals/[id]" />
      <Stack.Screen name="goals/[id]/edit" options={{ presentation: 'modal' }} />
      <Stack.Screen name="goals/[id]/log" options={{ presentation: 'modal' }} />
      <Stack.Screen name="goals/reminder-settings" />
      <Stack.Screen name="sleep/index" />
      <Stack.Screen name="sleep/settings" />
      <Stack.Screen name="sleep/insights" />
      <Stack.Screen name="study/index" />
      <Stack.Screen name="study/settings" />
      <Stack.Screen name="study/reminder-settings" />
      <Stack.Screen name="study/insights" />
      <Stack.Screen name="study/timer" options={{ gestureEnabled: false }} />
      <Stack.Screen name="budget/index" />
      <Stack.Screen name="budget/transactions" />
      <Stack.Screen name="budget/reports" />
      <Stack.Screen name="budget/settings" />
      <Stack.Screen name="budget/savings/[id]" />
      <Stack.Screen name="budget/debts/index" />
      <Stack.Screen name="budget/debts/[id]" />
      <Stack.Screen name="join/[token]" />
      <Stack.Screen name="split/index" />
      <Stack.Screen name="split/[id]" />
      <Stack.Screen name="split/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="split/[id]/expense" options={{ presentation: 'modal' }} />
      <Stack.Screen name="split/[id]/settle" options={{ presentation: 'modal' }} />
      <Stack.Screen name="split/[id]/members" options={{ presentation: 'modal' }} />
      <Stack.Screen name="gallery/index" />
      <Stack.Screen name="gallery/all" />
      <Stack.Screen name="gallery/compare" />
      <Stack.Screen name="gallery/album/[id]" />
      <Stack.Screen name="gallery/photo/[id]" />
      {/* Immersive by design — letterboxing it would be a regression, not a fix. */}
      <Stack.Screen
        name="gallery/story/[period]"
        options={{
          presentation: 'fullScreenModal',
          animation: 'fade',
          contentStyle: { backgroundColor: background },
        }}
      />
      <Stack.Screen name="profile" />
      <Stack.Screen name="settings/index" />
      <Stack.Screen name="settings/notifications" />
      <Stack.Screen name="settings/notification-sound" />
      <Stack.Screen name="settings/sync" />
      <Stack.Screen name="settings/sync-conflicts" />
      <Stack.Screen name="settings/media" />
      <Stack.Screen name="settings/operator" />
      <Stack.Screen name="settings/blocked" />
      {/* The private space brings its own layout (screenshot block,
            no swipe-back), so it is registered as one route here. */}
      <Stack.Screen name="private" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="search" options={{ presentation: 'modal' }} />
      <Stack.Screen name="task/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="note/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="habit/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="routine/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="timeline/event/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="music/playlist/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="music/now-playing" options={{ presentation: 'modal' }} />
      <Stack.Screen name="goals/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="sleep/log" options={{ presentation: 'modal' }} />
      <Stack.Screen name="study/log" options={{ presentation: 'modal' }} />
      <Stack.Screen name="budget/transaction" options={{ presentation: 'modal' }} />
      <Stack.Screen name="budget/savings/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="budget/debts/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="gallery/album/new" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const init = useAuthStore((state) => state.init);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const profileHydrated = useProfileStore((state) => state.hydrated);
  const scheme = useColorScheme() ?? 'light';
  const [splashDone, setSplashDone] = useState(false);
  /**
   * The database is opened here rather than on first use, because the
   * SQLCipher key comes from the keystore and that is async — see
   * database/client.ts. Nothing below may touch the database until this is
   * true, which is why the effect that rebuilds reminders waits on it too.
   */
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    initDatabase().then(
      () => setDbReady(true),
      (error: unknown) => {
        reportError(error, { scope: 'database-init' });
        setDbError(error instanceof Error ? error.message : String(error));
      },
    );
  }, []);
  const [fontsLoaded] = useFonts({
    Sora_400Regular,
    Sora_500Medium,
    Sora_600SemiBold,
    Sora_700Bold,
    Sora_800ExtraBold,
    Literata_400Regular,
    Literata_400Regular_Italic,
    Literata_500Medium,
    Literata_600SemiBold,
  });

  useEffect(() => {
    // Every call below reads the database, so none of them may run before it
    // is open. This effect re-runs once `dbReady` flips.
    if (!dbReady) return;
    init();
    // Reconcile scheduled reminders with the delivery mode, then rebuild every
    // reminder from the database.
    //
    // Strictly in that order, and that is the reason for the `void
    // (async () => …)` rather than two bare calls. Both are async and both
    // rewrite the OS queue: `applyDeliveryMode` cancels whole categories, the
    // rebuild re-creates them. Started concurrently they interleave, and the
    // cancel lands in the middle of the rebuild — silently deleting reminders
    // that had just been re-queued, on a launch that looked completely normal.
    //
    // The rebuild exists because scheduling can silently produce nothing
    // (permission not yet granted, category off, digest mode, master switch)
    // and nothing ever retried — so a reminder lost that way stayed lost until
    // its item happened to be edited again. It no-ops without permission.
    void (async () => {
      await applyDeliveryMode();
      await resyncAllReminders();
    })();
    // Refresh the home-screen widget's snapshot with today's counts (Android).
    syncTodayWidget();
  }, [init, dbReady]);

  useEffect(() => {
    // `dbError` hides the splash too, or the failure screen below would sit
    // invisible behind it and the app would look like it hung.
    if ((fontsLoaded && isInitialized && profileHydrated && dbReady) || dbError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, isInitialized, profileHydrated, dbReady, dbError]);

  // The app's ground color. Applied to the root view + every navigator scene
  // (contentStyle below) so boot and screen transitions never flash the
  // default white scene — the bug this replaced, worst in dark mode.
  const c = colors[scheme];

  if (dbError) return <DatabaseUnavailable message={dbError} background={c.background} />;

  // Wait for fonts, the initial session check, the persisted profile and the
  // encrypted database so the gate can route to auth / onboarding / app without
  // a flash of the wrong one — and so no screen queries a database that is not
  // open yet.
  if (!fontsLoaded || !isInitialized || !profileHydrated || !dbReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.background }}>
      {/* Never configured before — the OS default status bar style doesn't
          follow the app's theme, so the clock/battery/signal icons could land
          dark-on-dark (or light-on-light) and go unreadable depending on which
          way the device theme leaned. Tied to the same `scheme` every screen
          already reads, so it always has 4.5:1+ against whatever's under it. */}
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {/* The same job for the bottom of the screen — see system-bars.tsx for
          why the navigation bar needs its own call rather than following the
          status bar's. */}
      <SystemBarsBridge />
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <BottomSheetModalProvider>
            <ErrorBoundary>
              <AppNavigator background={c.background} />
              <AuthGate />
              <SyncTrigger />
              <SyncStatusBridge />
              <AccountStandingBridge />
              <DeviceSessionBridge />
              <BillingSyncBridge />
              <UsageReporter />
              <ChallengeTracking />
              <AdSession />
              <WidgetSync />
              <LanguageBridge />
              <PushRegistrationBridge />
              <AppLockController />
              <PrivateAutoLock />
              <CycleReminderBridge />
              <ModuleFlagsBridge />
              <ModuleRouteGuard />
              <NotificationNavigationBridge />
              <NotificationCenterBridge />
              <MiniPlayerBar />
              <DevErrorBanner />
            </ErrorBoundary>
            {/* Two ambient layers, both directly above the navigator and below
                every overlay. They are properties of the app's surface, so they
                sit over content but must never fall across a dialog, a toast or
                the lock shield — those are separate planes in front of them.

                Overlays rather than backdrops on purpose: every screen paints an
                opaque `bg-background`, so anything mounted behind the navigator
                would be invisible. The wash goes first and the grain on top, so
                the grain dithers the wash's own gradient as well as the app's. */}
            <AmbientBackground />
            <Grain />
            {/* Above the navigator so a toast raised by a delete outlives the
                router.back() that immediately follows it. */}
            <ToastHost />
            {/* Above the toast: a dialog asks a question and a toast reports an
                answer, so a toast must never cover the thing it is waiting on. */}
            <DialogHost />
            {/* Top of the screen, where the OS banner would have been. */}
            <NotificationBanner />
            {/* Below the overlays and above the app: nothing is collected until
                it is answered, so it never needs to interrupt anything. */}
            <UsageConsentCard />
            {/* On top of everything: the block notice, the lock shield, then the
                cold-start splash. Blocked sits under the lock deliberately —
                the device's owner still authenticates first. */}
            <BlockedOverlay />
            {/* Under the block and the lock, above everything else. A blocked
                account has a bigger problem than which phone it is on, and the
                device's owner still authenticates before either is shown. */}
            <DeviceGateOverlay />
            <AppLockOverlay />
            {!splashDone && (
              <AnimatedSplash
                onFinish={() => {
                  setSplashDone(true);
                  // Release the cold-start autofocus guard so login/onboarding
                  // fields no longer keep the keyboard down.
                  useSplashStore.getState().setComplete();
                }}
              />
            )}
          </BottomSheetModalProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
