import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format, set } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Bell, CalendarClock, Clock } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, Switch, View } from 'react-native';

import { AttributeRow } from '@/components/ui/attribute-row';
import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { syncGoalReminders } from '@/features/goals/services/goal-reminders';
import {
  GOAL_REMINDER_DAY_OPTIONS,
  useGoalReminderStore,
} from '@/features/goals/store/goal-reminder-store';
import { CategoryOffNotice } from '@/features/notifications/components/category-off-notice';
import { useTheme } from '@/hooks/use-theme';
import { notify } from '@/lib/dialog-store';
import { notificationsAvailable } from '@/lib/notifications';

export default function GoalReminderSettingsScreen() {
  const router = useRouter();
  const { c, scheme } = useTheme();
  const { t } = useTranslation();
  const tint = moduleTint('goals', scheme);

  const settings = useGoalReminderStore((state) => state.settings);
  const [draft, setDraft] = useState(settings);
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const time = set(new Date(), {
    hours: draft.hour,
    minutes: draft.minute,
    seconds: 0,
    milliseconds: 0,
  });

  const handleTimeChange = (event: DateTimePickerEvent, next?: Date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (event.type === 'set' && next) {
      setDraft((prev) => ({ ...prev, hour: next.getHours(), minute: next.getMinutes() }));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    // syncGoalReminders cancels the previous set and stores the new ids itself —
    // one notification per goal makes cancel-then-rebuild the only correct
    // update, so there is nothing for this screen to reconcile.
    const ids = await syncGoalReminders(draft);
    setSaving(false);

    // Zero ids with the toggle on is ambiguous — it can mean permission was
    // refused, or simply that no active goal has a due date in range. Only the
    // first is worth interrupting somebody about.
    if (draft.enabled && ids.length === 0 && !notificationsAvailable) {
      void notify({
        title: t('reminders.notificationsUnavailable'),
        message: t('reminders.notAvailable'),
        confirmLabel: t('common.ok'),
      });
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('goals.reminderTitle')}
        eyebrow={t('hubModule.goalsTitle')}
        tint={tint}
      />

      <ScrollView
        contentContainerClassName="gap-6 px-5 pt-3 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <CategoryOffNotice category="goals" />

        <View className={cardClass({ padding: 'none', elevation: 'e1' }, 'px-4')}>
          <AttributeRow icon={Bell} label={t('goals.reminderRowLabel')} isFirst>
            <View className="flex-row items-center justify-between">
              <Text variant="muted">{t('goals.deadlineNudge')}</Text>
              <Switch
                value={draft.enabled}
                onValueChange={(enabled) => setDraft((prev) => ({ ...prev, enabled }))}
                trackColor={{ true: tint, false: c.border }}
              />
            </View>
          </AttributeRow>

          {draft.enabled && (
            <AttributeRow icon={CalendarClock} label={t('goals.howFarAhead')}>
              <View className="flex-row flex-wrap gap-2">
                {GOAL_REMINDER_DAY_OPTIONS.map((days) => {
                  const selected = draft.daysBefore === days;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      key={days}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setDraft((prev) => ({ ...prev, daysBefore: days }));
                      }}
                      className="rounded-full border px-3 py-1.5"
                      style={{
                        borderColor: selected ? tint : c.border,
                        backgroundColor: selected ? tint : 'transparent',
                      }}
                    >
                      <Text
                        variant="caption"
                        className="font-sora-medium"
                        style={{ color: selected ? c.accentForeground : c.mutedForeground }}
                      >
                        {days === 0 ? t('goals.onTheDay') : t('goals.daysBefore', { count: days })}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </AttributeRow>
          )}

          {draft.enabled && (
            <AttributeRow icon={Clock} label={t('reminders.time')}>
              {Platform.OS === 'ios' ? (
                <DateTimePicker
                  value={time}
                  mode="time"
                  display="compact"
                  onChange={handleTimeChange}
                />
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setShowPicker(true)}
                  className="flex-row items-center gap-1.5 self-start rounded-full border border-border px-3 py-1.5"
                >
                  <Clock size={14} color={c.mutedForeground} />
                  <Text variant="muted">{format(time, 'h:mm a')}</Text>
                </Pressable>
              )}
            </AttributeRow>
          )}
        </View>

        {draft.enabled && (
          <Text variant="muted">
            {draft.daysBefore === 0
              ? t('goals.reminderSummaryToday', { time: format(time, 'h:mm a') })
              : t('goals.reminderSummary', {
                  count: draft.daysBefore,
                  time: format(time, 'h:mm a'),
                })}
          </Text>
        )}

        {/* Stated because it is a real limit and the alternative is somebody
            concluding the feature is broken. A local notification cannot check
            anything when it fires, so overdue goals are deliberately silent. */}
        <Text variant="caption">{t('goals.reminderNote')}</Text>

        {Platform.OS === 'android' && showPicker ? (
          <DateTimePicker value={time} mode="time" display="default" onChange={handleTimeChange} />
        ) : null}

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
