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
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplash } from '@/components/animated-splash';
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
import { useUsageReporter } from '@/features/analytics/hooks/use-usage-reporter';
import { AmbientBackground } from '@/components/ui/ambient-background';
import { DialogHost } from '@/components/ui/dialog-host';
import { Grain } from '@/components/ui/grain';
import { UsageConsentCard } from '@/features/analytics/components/usage-consent-card';
import { BlockedOverlay } from '@/features/moderation/components/blocked-overlay';
import { useAccountStandingSync } from '@/features/moderation/hooks/use-account-standing';
import {
  useModuleFlagsSync,
  useModuleRouteGuard,
} from '@/features/module-flags/hooks/use-module-access';
import { usePrivateAutoLock } from '@/features/private/hooks/use-private-lock';
import { useSplashStore } from '@/hooks/use-splash-store';
import { useSyncTrigger } from '@/features/sync/hooks/use-sync';
import { SyncStatusBridge } from '@/features/sync/components/sync-status-bridge';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { configureAndroidChannels, configureNotificationHandler } from '@/lib/notifications';
import { queryClient } from '@/lib/query-client';
import { initSentry } from '@/lib/sentry';

SplashScreen.preventAutoHideAsync();

// Route caught errors to Sentry when a DSN is configured (no-op otherwise).
initSentry();

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

/** Keeps the account's moderation standing fresh, so an expired restriction
 * clears itself and a blocked account can be told why. Renders nothing. */
function AccountStandingBridge() {
  useAccountStandingSync();
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

export default function RootLayout() {
  const init = useAuthStore((state) => state.init);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const profileHydrated = useProfileStore((state) => state.hydrated);
  const scheme = useColorScheme() ?? 'light';
  const [splashDone, setSplashDone] = useState(false);
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
    init();
    // Reconcile scheduled reminders with the delivery mode and refresh the
    // morning digest with today's counts on every launch — local notifications
    // carry fixed text, so this is how it stays current.
    applyDeliveryMode();
    // Rebuild every reminder from the database. Scheduling can silently produce
    // nothing (permission not yet granted, category off, digest mode, master
    // switch), and nothing ever retried — so a reminder lost that way stayed
    // lost until its item happened to be edited again. No-ops without permission.
    void resyncAllReminders();
    // Refresh the home-screen widget's snapshot with today's counts (Android).
    syncTodayWidget();
  }, [init]);

  useEffect(() => {
    if (fontsLoaded && isInitialized && profileHydrated) SplashScreen.hideAsync();
  }, [fontsLoaded, isInitialized, profileHydrated]);

  // The app's ground color. Applied to the root view + every navigator scene
  // (contentStyle below) so boot and screen transitions never flash the
  // default white scene — the bug this replaced, worst in dark mode.
  const c = colors[scheme];

  // Wait for fonts, the initial session check, and the persisted profile so the
  // gate can route to auth / onboarding / app without a flash of the wrong one.
  if (!fontsLoaded || !isInitialized || !profileHydrated) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.background }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <BottomSheetModalProvider>
            <ErrorBoundary>
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: c.background },
                }}
              >
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(onboarding)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="notes" />
                <Stack.Screen name="music" />
                <Stack.Screen name="goals/index" />
                <Stack.Screen name="goals/[id]" />
                <Stack.Screen name="goals/[id]/edit" options={{ presentation: 'modal' }} />
                <Stack.Screen name="goals/[id]/log" options={{ presentation: 'modal' }} />
                <Stack.Screen name="goals/reminder-settings" />
                <Stack.Screen name="sleep/index" />
                <Stack.Screen name="sleep/settings" />
                <Stack.Screen name="study/index" />
                <Stack.Screen name="study/settings" />
                <Stack.Screen name="study/reminder-settings" />
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
                <Stack.Screen
                  name="gallery/story/[period]"
                  options={{ presentation: 'fullScreenModal', animation: 'fade' }}
                />
                <Stack.Screen name="profile" />
                <Stack.Screen name="settings/index" />
                <Stack.Screen name="settings/notifications" />
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
              <AuthGate />
              <SyncTrigger />
              <SyncStatusBridge />
              <AccountStandingBridge />
              <UsageReporter />
              <WidgetSync />
              <LanguageBridge />
              <PushRegistrationBridge />
              <AppLockController />
              <PrivateAutoLock />
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
