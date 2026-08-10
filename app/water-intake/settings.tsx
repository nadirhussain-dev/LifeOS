import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Bell, Minus, Plus, Target } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { cardClass } from '@/components/ui/card';
import { AttributeRow } from '@/components/ui/attribute-row';
import { Button } from '@/components/ui/button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { CategoryOffNotice } from '@/features/notifications/components/category-off-notice';
import {
  cancelWaterReminders,
  scheduleWaterReminders,
} from '@/features/water-intake/services/water-reminders';
import {
  GOAL_PRESETS_ML,
  useWaterSettingsStore,
} from '@/features/water-intake/store/water-settings-store';
import { REMINDER_INTERVALS_MIN } from '@/features/water-intake/types/water-intake.types';
import { notificationsAvailable } from '@/lib/notifications';
import { notify } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

function formatHour(hour: number) {
  const period = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:00 ${period}`;
}

function HourStepper({
  label,
  hour,
  onChange,
}: {
  label: string;
  hour: number;
  onChange: (hour: number) => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  return (
    <View className="flex-1 items-center gap-1.5">
      <Text variant="caption">{label}</Text>
      <View className="flex-row items-center gap-2">
        <Pressable
          accessibilityRole="button"
          onPress={() => onChange(Math.max(0, hour - 1))}
          className="h-8 w-8 items-center justify-center rounded-full border border-border"
        >
          <Minus size={14} color={colors[scheme].foreground} />
        </Pressable>
        <Text className="w-20 text-center font-sora-semibold">{formatHour(hour)}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => onChange(Math.min(23, hour + 1))}
          className="h-8 w-8 items-center justify-center rounded-full border border-border"
        >
          <Plus size={14} color={colors[scheme].foreground} />
        </Pressable>
      </View>
    </View>
  );
}

export default function WaterSettingsScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const waterTint = moduleTint('water', scheme);

  const goalMl = useWaterSettingsStore((state) => state.goalMl);
  const setGoal = useWaterSettingsStore((state) => state.setGoal);
  const reminders = useWaterSettingsStore((state) => state.reminders);
  const scheduledNotificationIds = useWaterSettingsStore((state) => state.scheduledNotificationIds);
  const setReminders = useWaterSettingsStore((state) => state.setReminders);

  const [draft, setDraft] = useState(reminders);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (draft.enabled && draft.startHour >= draft.endHour) {
      toast.error(t('water.checkTimesBody'));
      return;
    }

    setSaving(true);
    await cancelWaterReminders(scheduledNotificationIds);
    const newIds = await scheduleWaterReminders(draft);
    setSaving(false);

    if (draft.enabled && newIds.length === 0) {
      void notify({
        title: notificationsAvailable
          ? t('reminders.notificationsDisabled')
          : t('reminders.notificationsUnavailable'),
        message: notificationsAvailable
          ? t('water.enableForReminders')
          : t('reminders.notAvailable'),
        confirmLabel: t('common.ok'),
      });
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setReminders(draft, newIds);
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={t('water.settingsTitle')} eyebrow={t('water.title')} tint={waterTint} />

      <ScrollView
        contentContainerClassName="gap-6 px-5 pt-3 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <CategoryOffNotice category="water" />
        <View className={cardClass({ padding: 'none', elevation: 'e1' }, 'px-4')}>
          <AttributeRow icon={Target} label={t('water.dailyGoal')} isFirst>
            <View className="flex-row flex-wrap gap-2">
              {GOAL_PRESETS_ML.map((ml) => {
                const selected = ml === goalMl;
                return (
                  <Pressable
                    accessibilityRole="button"
                    key={ml}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setGoal(ml);
                    }}
                    className="rounded-full border px-3 py-1.5"
                    style={{
                      borderColor: selected ? waterTint : colors[scheme].border,
                      backgroundColor: selected ? waterTint : 'transparent',
                    }}
                  >
                    <Text
                      variant="caption"
                      className="font-sora-medium"
                      style={{ color: selected ? '#ffffff' : colors[scheme].mutedForeground }}
                    >
                      {(ml / 1000).toFixed(1)}L
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </AttributeRow>
        </View>

        <View className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-3')}>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Bell size={16} color={colors[scheme].mutedForeground} />
              <Text className="font-sora-semibold">{t('water.reminders')}</Text>
            </View>
            <Switch
              value={draft.enabled}
              onValueChange={(enabled) => setDraft((prev) => ({ ...prev, enabled }))}
              trackColor={{ true: waterTint, false: colors[scheme].border }}
            />
          </View>

          {draft.enabled && (
            <View className="gap-4 pt-1">
              <View className="gap-1.5">
                <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
                  {t('water.remindEvery')}
                </Text>
                <View className="flex-row gap-2">
                  {REMINDER_INTERVALS_MIN.map((minutes) => {
                    const selected = draft.intervalMinutes === minutes;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        key={minutes}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setDraft((prev) => ({ ...prev, intervalMinutes: minutes }));
                        }}
                        className="flex-1 items-center rounded-full border py-1.5"
                        style={{
                          borderColor: selected ? waterTint : colors[scheme].border,
                          backgroundColor: selected ? waterTint : 'transparent',
                        }}
                      >
                        <Text
                          variant="caption"
                          className="font-sora-medium"
                          style={{ color: selected ? '#ffffff' : colors[scheme].mutedForeground }}
                        >
                          {minutes < 60
                            ? t('water.minutesShort', { minutes })
                            : t('water.hoursShort', { hours: minutes / 60 })}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View className="flex-row gap-3">
                <HourStepper
                  label={t('water.from')}
                  hour={draft.startHour}
                  onChange={(startHour) => setDraft((prev) => ({ ...prev, startHour }))}
                />
                <HourStepper
                  label={t('water.until')}
                  hour={draft.endHour}
                  onChange={(endHour) => setDraft((prev) => ({ ...prev, endHour }))}
                />
              </View>

              <Text variant="muted">
                {t('water.nudgeSummary', {
                  interval:
                    draft.intervalMinutes < 60
                      ? t('water.intervalMinutes', { count: draft.intervalMinutes })
                      : t('water.intervalHours', { count: draft.intervalMinutes / 60 }),
                  start: formatHour(draft.startHour),
                  end: formatHour(draft.endHour),
                })}
              </Text>
            </View>
          )}
        </View>

        <Button
          label={saving ? t('common.saving') : t('common.save')}
          onPress={handleSave}
          disabled={saving}
          size="lg"
          variant="accent"
        />
      </ScrollView>
    </View>
  );
}
