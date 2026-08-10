import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format, set } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Bell, CalendarDays, Clock } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, Switch, View } from 'react-native';

import { AttributeRow } from '@/components/ui/attribute-row';
import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { WeekdayPicker } from '@/components/ui/weekday-picker';
import { moduleTint } from '@/constants/design-tokens';
import { CategoryOffNotice } from '@/features/notifications/components/category-off-notice';
import { syncStudyReminders } from '@/features/study/services/study-reminders';
import { useStudyReminderStore } from '@/features/study/store/study-reminder-store';
import { useTheme } from '@/hooks/use-theme';
import { notify } from '@/lib/dialog-store';
import { notificationsAvailable } from '@/lib/notifications';

export default function StudyReminderSettingsScreen() {
  const router = useRouter();
  const { c, scheme } = useTheme();
  const { t } = useTranslation();
  const tint = moduleTint('study', scheme);

  const settings = useStudyReminderStore((state) => state.settings);
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
    const ids = await syncStudyReminders(draft);
    setSaving(false);

    if (draft.enabled && draft.days.length > 0 && ids.length === 0) {
      void notify({
        title: notificationsAvailable
          ? t('reminders.notificationsDisabled')
          : t('reminders.notificationsUnavailable'),
        message: notificationsAvailable ? t('study.enableNotifBody') : t('reminders.notAvailable'),
        confirmLabel: t('common.ok'),
      });
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  // Enabled with no days selected would silently schedule nothing, so the save
  // button says so rather than appearing to work.
  const noDays = draft.enabled && draft.days.length === 0;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('study.reminderTitle')}
        eyebrow={t('hubModule.studyTitle')}
        tint={tint}
      />

      <ScrollView
        contentContainerClassName="gap-6 px-5 pt-3 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <CategoryOffNotice category="study" />

        <View className={cardClass({ padding: 'none', elevation: 'e1' }, 'px-4')}>
          <AttributeRow icon={Bell} label={t('study.reminderRowLabel')} isFirst>
            <View className="flex-row items-center justify-between">
              <Text variant="muted">{t('study.nudgeToStudy')}</Text>
              <Switch
                value={draft.enabled}
                onValueChange={(enabled) => setDraft((prev) => ({ ...prev, enabled }))}
                trackColor={{ true: tint, false: c.border }}
              />
            </View>
          </AttributeRow>

          {draft.enabled && (
            <AttributeRow icon={CalendarDays} label={t('study.whichDays')}>
              <WeekdayPicker
                value={draft.days}
                onChange={(days) => setDraft((prev) => ({ ...prev, days }))}
                tint={tint}
              />
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

        {noDays ? (
          <Text variant="caption" className="text-warning">
            {t('study.pickADay')}
          </Text>
        ) : null}

        {draft.enabled && !noDays && (
          <Text variant="muted">
            {t('study.reminderSummary', {
              count: draft.days.length,
              time: format(time, 'h:mm a'),
            })}
          </Text>
        )}

        {/* The honest caveat. A local notification's text is fixed when it is
            scheduled, so this cannot know you already studied — which is why the
            copy invites rather than accuses. */}
        <Text variant="caption">{t('study.reminderNote')}</Text>

        {Platform.OS === 'android' && showPicker ? (
          <DateTimePicker value={time} mode="time" display="default" onChange={handleTimeChange} />
        ) : null}

        <Button
          label={saving ? t('common.saving') : t('common.save')}
          onPress={handleSave}
          disabled={saving || noDays}
          size="lg"
          variant="accent"
        />
      </ScrollView>
    </View>
  );
}
