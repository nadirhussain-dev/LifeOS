import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format, set } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Bell, Clock } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { cardClass } from '@/components/ui/card';
import { AttributeRow } from '@/components/ui/attribute-row';
import { Button } from '@/components/ui/button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import {
  cancelJournalReminder,
  scheduleJournalReminder,
} from '@/features/journal/services/journal-reminders';
import { useJournalReminderStore } from '@/features/journal/store/journal-reminder-store';
import { CategoryOffNotice } from '@/features/notifications/components/category-off-notice';
import { notificationsAvailable } from '@/lib/notifications';
import { notify } from '@/lib/dialog-store';

export default function JournalReminderSettingsScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();

  const settings = useJournalReminderStore((state) => state.settings);
  const scheduledNotificationId = useJournalReminderStore((state) => state.scheduledNotificationId);
  const setReminder = useJournalReminderStore((state) => state.setReminder);

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
    await cancelJournalReminder(scheduledNotificationId);
    const newId = await scheduleJournalReminder(draft);
    setSaving(false);

    if (draft.enabled && !newId) {
      void notify({
        title: notificationsAvailable
          ? t('reminders.notificationsDisabled')
          : t('reminders.notificationsUnavailable'),
        message: notificationsAvailable
          ? t('journal.enableNotifBody')
          : t('reminders.notAvailable'),
        confirmLabel: t('common.ok'),
      });
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setReminder(draft, newId);
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('journal.reminderTitle')}
        eyebrow={t('tabs.journal')}
        tint={moduleTint('journal', scheme)}
      />

      <ScrollView
        contentContainerClassName="gap-6 px-5 pt-3 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <CategoryOffNotice category="journal" />
        <View className={cardClass({ padding: 'none', elevation: 'e1' }, 'px-4')}>
          <AttributeRow icon={Bell} label={t('reminders.dailyReminder')} isFirst>
            <View className="flex-row items-center justify-between">
              <Text variant="muted">{t('journal.nudgeToWrite')}</Text>
              <Switch
                value={draft.enabled}
                onValueChange={(enabled) => setDraft((prev) => ({ ...prev, enabled }))}
                trackColor={{ true: moduleTint('journal', scheme), false: colors[scheme].border }}
              />
            </View>
          </AttributeRow>

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
                  <Clock size={14} color={colors[scheme].mutedForeground} />
                  <Text variant="muted">{format(time, 'h:mm a')}</Text>
                </Pressable>
              )}
            </AttributeRow>
          )}
        </View>

        {draft.enabled && (
          <Text variant="muted">
            {t('journal.reminderSummary', { time: format(time, 'h:mm a') })}
          </Text>
        )}

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
