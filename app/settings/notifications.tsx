import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format, set } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { AlarmClock, BellRing, Send, Stethoscope } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, ScrollView, Switch, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { ScreenHeader } from '@/components/ui/screen-header';
import { moduleTints } from '@/constants/design-tokens';
import { Segmented } from '@/components/ui/segmented';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { applyDeliveryMode } from '@/features/notifications/services/delivery';
import { resyncAllReminders } from '@/features/notifications/services/reminder-scheduler';
import { formatQuietWindow } from '@/features/notifications/services/quiet-hours';
import {
  useNotificationsStore,
  type DeliveryMode,
} from '@/features/notifications/store/notifications-store';
import {
  CATEGORY_META,
  CONFIGURABLE_CATEGORIES,
  type NotificationCategory,
} from '@/features/notifications/types/notification.types';
import {
  cancelAllScheduled,
  cancelScheduledInCategory,
  exactAlarmSettingsAvailable,
  getNotificationDiagnostics,
  hasNotificationPermission,
  notificationsAvailable,
  openExactAlarmSettings,
  requestNotificationPermission,
  SCHEDULING_BUDGET,
  sendTestNotification,
  type NotificationDiagnostics,
} from '@/lib/notifications';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { confirm, notify } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

function SectionLabel({ children }: { children: string }) {
  return (
    <Text variant="caption" className="px-1 font-sora-semibold uppercase tracking-wide">
      {children}
    </Text>
  );
}

/** A labelled time value with the platform-appropriate picker (inline compact
 * on iOS, tap-to-open modal on Android). */
function TimeRow({
  label,
  minutes,
  onChange,
  borderTop,
}: {
  label: string;
  minutes: number;
  onChange: (minutes: number) => void;
  borderTop?: boolean;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const value = set(new Date(), {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
    seconds: 0,
    milliseconds: 0,
  });

  const handle = (event: DateTimePickerEvent, next?: Date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (event.type === 'set' && next) onChange(next.getHours() * 60 + next.getMinutes());
  };

  return (
    <View
      className={
        borderTop
          ? 'flex-row items-center justify-between border-t border-border py-3.5'
          : 'flex-row items-center justify-between py-3.5'
      }
    >
      <Text className="font-sora-medium text-foreground">{label}</Text>
      {Platform.OS === 'ios' ? (
        <DateTimePicker value={value} mode="time" display="compact" onChange={handle} />
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowPicker(true)}
            className="rounded-full border border-border px-3 py-1.5"
          >
            <Text variant="muted">{format(value, 'h:mm a')}</Text>
          </Pressable>
          {showPicker && (
            <DateTimePicker value={value} mode="time" display="default" onChange={handle} />
          )}
        </>
      )}
    </View>
  );
}

const DELIVERY_OPTIONS: { value: DeliveryMode; labelKey: string }[] = [
  { value: 'digest', labelKey: 'notif.deliveryDigest' },
  { value: 'individual', labelKey: 'notif.deliveryIndividual' },
];

export default function NotificationSettingsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const theme = colors[scheme];

  const store = useNotificationsStore();
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [diagnostics, setDiagnostics] = useState<NotificationDiagnostics | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    hasNotificationPermission().then(setPermissionGranted);
  }, []);

  const refreshDiagnostics = useCallback(async () => {
    setDiagnostics(await getNotificationDiagnostics());
  }, []);

  useEffect(() => {
    void refreshDiagnostics();
  }, [refreshDiagnostics]);

  /** Posts a real notification through the real pipeline. When reminders aren't
   * arriving this is the one check that separates "LifeOS never scheduled it"
   * from "Android is dropping it", which look identical from the outside. */
  const handleTest = async () => {
    setTesting(true);
    Haptics.selectionAsync();
    const result = await sendTestNotification({
      title: t('notif.testTitle'),
      body: t('notif.testBody'),
    });
    setTesting(false);
    await refreshDiagnostics();

    if (result.ok) {
      // A modal to confirm the thing the user just asked for, which they can
      // also see arrive in the shade, was pure interruption.
      toast.success(t('notif.testSentBody'));
      return;
    }
    // Denied is the only reason with a fix the user can act on, so it is the
    // only one that offers a way to act. The others are a statement of fact.
    if (result.reason === 'denied') {
      void confirm({
        title: t('notif.testFailedTitle'),
        message: t('notif.testFailedDenied'),
        confirmLabel: t('notif.openSystemSettings'),
        cancelLabel: t('common.cancel'),
      }).then((ok) => ok && void Linking.openSettings());
      return;
    }
    void notify({
      title: t('notif.testFailedTitle'),
      message:
        result.reason === 'unavailable' ? t('notif.notAvailable') : t('notif.testFailedError'),
      confirmLabel: t('common.ok'),
    });
  };

  // Any change to delivery mode, digest time, quiet hours or the master switch
  // can change which reminders should be queued and whether/when the morning
  // digest fires — reconcile scheduled notifications and the digest.
  const resyncDigest = () => {
    void applyDeliveryMode();
  };

  /**
   * Rebuilds every reminder in the app.
   *
   * Each of these switches used to be one-way: turning a category (or the
   * master switch) off cancelled its queued reminders, and turning it back on
   * scheduled nothing — the reminders only returned if the user happened to
   * re-save every task, habit and note they owned. Same for granting permission
   * after the fact, and for switching out of digest mode.
   */
  const rebuildReminders = () => {
    void resyncAllReminders().then(() => void refreshDiagnostics());
  };

  const handleMasterToggle = async (enabled: boolean) => {
    Haptics.selectionAsync();
    if (enabled && !permissionGranted) {
      const granted = await requestNotificationPermission();
      setPermissionGranted(granted);
    }
    store.setMasterEnabled(enabled);
    if (enabled) {
      resyncDigest();
      // Puts back everything the "off" branch cancelled.
      rebuildReminders();
    } else {
      // True kill switch: silence everything already queued, not just future
      // scheduling.
      store.setDigestNotificationId(null);
      await cancelAllScheduled();
      await refreshDiagnostics();
    }
  };

  const handleCategoryToggle = (category: NotificationCategory, enabled: boolean) => {
    store.setCategoryEnabled(category, enabled);
    if (enabled) {
      // Was a no-op, so a category switched off and back on stayed silent.
      rebuildReminders();
    } else {
      // Clear the category's already-queued reminders immediately.
      void cancelScheduledInCategory(category).then(() => void refreshDiagnostics());
    }
    if (category === 'digest') resyncDigest();
  };

  const disabled = !store.masterEnabled;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('notif.title')}
        eyebrow={t('notif.settingsEyebrow')}
        tint={moduleTints.settings}
      />
      <ScrollView
        contentContainerClassName="gap-6 px-5 py-4 pb-12"
        showsVerticalScrollIndicator={false}
      >
        {/* Master */}
        <View className={cardClass({ padding: 'none' }, 'px-4')}>
          <View className="flex-row items-center gap-3 py-3.5">
            <View
              className="h-9 w-9 items-center justify-center rounded-xl"
              style={{ backgroundColor: theme.muted }}
            >
              <BellRing size={18} color={theme.accent} />
            </View>
            <View className="flex-1">
              <Text className="font-sora-semibold text-foreground">
                {t('notif.allNotifications')}
              </Text>
              <Text variant="caption">{t('notif.masterDescription')}</Text>
            </View>
            <Switch
              value={store.masterEnabled}
              onValueChange={handleMasterToggle}
              trackColor={{ true: theme.accent, false: theme.border }}
            />
          </View>
        </View>

        {!notificationsAvailable && (
          <Text variant="caption" className="px-1">
            {t('notif.notAvailable')}
          </Text>
        )}
        {notificationsAvailable && store.masterEnabled && !permissionGranted && (
          <Text variant="caption" className="px-1" style={{ color: theme.destructive }}>
            {t('notif.systemOff')}
          </Text>
        )}

        {/* Delivery mode */}
        <View
          className="gap-2"
          style={{ opacity: disabled ? 0.5 : 1 }}
          pointerEvents={disabled ? 'none' : 'auto'}
        >
          <SectionLabel>{t('notif.delivery')}</SectionLabel>
          <Segmented
            options={DELIVERY_OPTIONS.map((option) => ({ ...option, label: t(option.labelKey) }))}
            value={store.deliveryMode}
            onChange={(mode) => {
              store.setDeliveryMode(mode);
              resyncDigest();
            }}
            activeColor={theme.accent}
          />
          <Text variant="caption" className="px-1">
            {store.deliveryMode === 'digest'
              ? t('notif.digestDescription')
              : t('notif.individualDescription')}
          </Text>
          {store.deliveryMode === 'digest' && (
            <View className={cardClass({ padding: 'none' }, 'px-4')}>
              <TimeRow
                label={t('notif.digestTime')}
                minutes={store.digestHour * 60 + store.digestMinute}
                onChange={(m) => {
                  store.setDigestTime(Math.floor(m / 60), m % 60);
                  resyncDigest();
                }}
              />
            </View>
          )}
        </View>

        {/* Quiet hours */}
        <View
          className="gap-2"
          style={{ opacity: disabled ? 0.5 : 1 }}
          pointerEvents={disabled ? 'none' : 'auto'}
        >
          <SectionLabel>{t('notif.quietHours')}</SectionLabel>
          <View className={cardClass({ padding: 'none' }, 'px-4')}>
            <View className="flex-row items-center justify-between py-3.5">
              <View className="flex-1 pe-3">
                <Text className="font-sora-medium text-foreground">
                  {t('notif.silenceOvernight')}
                </Text>
                <Text variant="caption">
                  {store.quietHoursEnabled
                    ? formatQuietWindow(store.quietStartMinutes, store.quietEndMinutes)
                    : t('notif.off')}
                </Text>
              </View>
              <Switch
                value={store.quietHoursEnabled}
                onValueChange={(v) => {
                  store.setQuietHoursEnabled(v);
                  resyncDigest();
                }}
                trackColor={{ true: theme.accent, false: theme.border }}
              />
            </View>
            {store.quietHoursEnabled && (
              <>
                <TimeRow
                  label={t('notif.from')}
                  minutes={store.quietStartMinutes}
                  borderTop
                  onChange={(m) => store.setQuietHours(m, store.quietEndMinutes)}
                />
                <TimeRow
                  label={t('notif.until')}
                  minutes={store.quietEndMinutes}
                  borderTop
                  onChange={(m) => store.setQuietHours(store.quietStartMinutes, m)}
                />
              </>
            )}
          </View>
          <Text variant="caption" className="px-1">
            {t('notif.quietNote')}
          </Text>
        </View>

        {/* Categories */}
        <View
          className="gap-2"
          style={{ opacity: disabled ? 0.5 : 1 }}
          pointerEvents={disabled ? 'none' : 'auto'}
        >
          <SectionLabel>{t('notif.whatYouHearAbout')}</SectionLabel>
          <View className={cardClass({ padding: 'none' }, 'px-4')}>
            {CONFIGURABLE_CATEGORIES.map((category, index) => {
              const meta = CATEGORY_META[category];
              const Icon = meta.icon;
              return (
                <View
                  key={category}
                  className={
                    index === 0
                      ? 'flex-row items-center gap-3 py-3.5'
                      : 'flex-row items-center gap-3 border-t border-border py-3.5'
                  }
                >
                  <View
                    className="h-9 w-9 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${meta.tint}22` }}
                  >
                    <Icon size={17} color={meta.tint} />
                  </View>
                  <View className="flex-1">
                    <Text className="font-sora-medium text-foreground">{t(meta.labelKey)}</Text>
                    <Text variant="caption">{t(meta.descriptionKey)}</Text>
                  </View>
                  <Switch
                    value={store.categories[category] ?? true}
                    onValueChange={(v) => handleCategoryToggle(category, v)}
                    trackColor={{ true: meta.tint, false: theme.border }}
                  />
                </View>
              );
            })}
          </View>
          <Text variant="caption" className="px-1">
            {t('notif.categoryNote')}
          </Text>
        </View>

        {/* Troubleshooting. Reminders can fail in three places the user can't
            see — permission, the Android channel's importance, and whether
            anything is actually queued — so each is surfaced directly rather
            than left to guesswork. */}
        <View className="gap-2">
          <SectionLabel>{t('notif.troubleshoot')}</SectionLabel>
          <View className={cardClass({ padding: 'none' }, 'px-4')}>
            <Pressable
              onPress={handleTest}
              disabled={testing || !notificationsAvailable}
              className="flex-row items-center gap-3 py-3.5"
              accessibilityRole="button"
              accessibilityLabel={t('notif.sendTest')}
              style={{ opacity: testing || !notificationsAvailable ? 0.5 : 1 }}
            >
              <View
                className="h-9 w-9 items-center justify-center rounded-xl"
                style={{ backgroundColor: theme.muted }}
              >
                <Send size={17} color={theme.accent} />
              </View>
              <View className="flex-1">
                <Text className="font-sora-medium text-foreground">{t('notif.sendTest')}</Text>
                <Text variant="caption">{t('notif.sendTestDescription')}</Text>
              </View>
            </Pressable>

            <View className="flex-row items-center gap-3 border-t border-border py-3.5">
              <View
                className="h-9 w-9 items-center justify-center rounded-xl"
                style={{ backgroundColor: theme.muted }}
              >
                <Stethoscope size={17} color={theme.mutedForeground} />
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="font-sora-medium text-foreground">{t('notif.status')}</Text>
                <Text variant="caption">
                  {t('notif.statusPermission')}:{' '}
                  {diagnostics?.permissionGranted ? t('notif.statusOn') : t('notif.statusOff')}
                </Text>
                <Text variant="caption">
                  {t('notif.statusQueued', { count: diagnostics?.scheduledCount ?? 0 })}
                </Text>
                {/* iOS keeps only 64 pending notifications across the whole
                    app and silently discards the rest — no error, and the app
                    does not get to choose which survive. The count above is the
                    only way to see it coming. */}
                {(diagnostics?.scheduledCount ?? 0) >= SCHEDULING_BUDGET ? (
                  <Text variant="caption" style={{ color: theme.destructive }}>
                    {t('notif.statusOverBudget', { limit: 64 })}
                  </Text>
                ) : null}
                {/* An Android channel the user (or an OEM battery optimiser) has
                    turned down reports importance < 3, which silences it no
                    matter what the app asks for. */}
                {diagnostics?.channels
                  .filter((channel) => channel.importance < 3)
                  .map((channel) => (
                    <Text key={channel.id} variant="caption" style={{ color: theme.destructive }}>
                      {t('notif.statusChannelQuiet', { name: channel.name })}
                    </Text>
                  ))}
              </View>
            </View>

            {/* Android 12+ only. Without the "Alarms & reminders" grant,
                expo-notifications silently downgrades timed reminders to inexact
                alarms and Doze can hold them back by a quarter of an hour. The
                grant state isn't readable from JS, so this offers the route
                rather than asserting whether it's currently on. */}
            {exactAlarmSettingsAvailable && (
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  void openExactAlarmSettings().then((opened) => {
                    if (!opened)
                      void notify({
                        title: t('notif.exactAlarmFailedTitle'),
                        message: t('notif.exactAlarmFailedBody'),
                        confirmLabel: t('common.ok'),
                      });
                  });
                }}
                className="flex-row items-center gap-3 border-t border-border py-3.5"
                accessibilityRole="button"
                accessibilityLabel={t('notif.exactAlarm')}
              >
                <View
                  className="h-9 w-9 items-center justify-center rounded-xl"
                  style={{ backgroundColor: theme.muted }}
                >
                  <AlarmClock size={17} color={theme.mutedForeground} />
                </View>
                <View className="flex-1">
                  <Text className="font-sora-medium text-foreground">{t('notif.exactAlarm')}</Text>
                  <Text variant="caption">{t('notif.exactAlarmDescription')}</Text>
                </View>
              </Pressable>
            )}

            {diagnostics?.permissionBlocked && (
              <Pressable
                onPress={() => void Linking.openSettings()}
                className="border-t border-border py-3.5"
                accessibilityRole="button"
                accessibilityLabel={t('notif.openSystemSettings')}
              >
                <Text className="font-sora-semibold" style={{ color: theme.accent }}>
                  {t('notif.openSystemSettings')}
                </Text>
                <Text variant="caption">{t('notif.permissionBlockedNote')}</Text>
              </Pressable>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
