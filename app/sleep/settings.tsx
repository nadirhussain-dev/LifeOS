import { set } from 'date-fns';
import { useRouter } from 'expo-router';
import { BellRing, Minus, Moon, Plus, Sun } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Switch, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { TimeField } from '@/features/sleep/components/time-field';
import { formatDuration } from '@/features/sleep/services/sleep-stats';
import { useSleepMutations } from '@/features/sleep/hooks/use-sleep-mutations';
import { useSleepSettings } from '@/features/sleep/hooks/use-sleep';
import { CategoryOffNotice } from '@/features/notifications/components/category-off-notice';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { notificationsAvailable } from '@/lib/notifications';

const MIN_GOAL = 240;
const MAX_GOAL = 720;
const STEP = 15;

/** Parses "HH:mm" into a carrier Date; falls back to a sensible default. */
function parseTime(value: string | null, fallbackHour: number): Date {
  if (value && /^\d{1,2}:\d{2}$/.test(value)) {
    const [h, m] = value.split(':').map(Number);
    return set(new Date(), { hours: h, minutes: m, seconds: 0, milliseconds: 0 });
  }
  return set(new Date(), { hours: fallbackHour, minutes: 0, seconds: 0, milliseconds: 0 });
}

function toHHmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export default function SleepSettingsScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const sleepTint = moduleTint('sleep', scheme);
  const { data: settings } = useSleepSettings();
  const { saveSettings } = useSleepMutations();

  const [goal, setGoal] = useState(settings?.goalMinutes ?? 480);
  const [bedtime, setBedtime] = useState(() => parseTime(settings?.targetBedtime ?? null, 23));
  const [wake, setWake] = useState(() => parseTime(settings?.targetWakeTime ?? null, 7));
  const [reminderEnabled, setReminderEnabled] = useState(settings?.reminderEnabled ?? false);
  const [seeded, setSeeded] = useState(false);

  if (settings && !seeded) {
    setGoal(settings.goalMinutes);
    setBedtime(parseTime(settings.targetBedtime, 23));
    setWake(parseTime(settings.targetWakeTime, 7));
    setReminderEnabled(settings.reminderEnabled);
    setSeeded(true);
  }

  const adjust = (delta: number) =>
    setGoal((g) => Math.min(MAX_GOAL, Math.max(MIN_GOAL, g + delta)));

  const save = () => {
    saveSettings.mutate({
      goalMinutes: goal,
      targetBedtime: toHHmm(bedtime),
      targetWakeTime: toHHmm(wake),
      reminderEnabled,
    });
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={t('sleep.goalTitle')} eyebrow={t('sleep.title')} tint={sleepTint} />

      <View className="gap-5 px-5 pt-3">
        <View className={cardClass({ padding: 'none', elevation: 'e1' }, 'items-center gap-4 p-6')}>
          <Text variant="micro">{t('sleep.nightlyGoal')}</Text>
          <View className="flex-row items-center gap-6">
            <Pressable
              accessibilityRole="button"
              onPress={() => adjust(-STEP)}
              className="h-12 w-12 items-center justify-center rounded-2xl border border-border bg-surface"
              accessibilityLabel={t('sleep.decreaseGoal')}
            >
              <Minus size={20} color={colors[scheme].foreground} />
            </Pressable>
            <Text
              className="font-sora-extrabold text-4xl text-sleep"
              style={{ minWidth: 130, textAlign: 'center', fontVariant: ['tabular-nums'] }}
            >
              {formatDuration(goal)}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => adjust(STEP)}
              className="h-12 w-12 items-center justify-center rounded-2xl bg-sleep"
              accessibilityLabel={t('sleep.increaseGoal')}
            >
              <Plus size={20} color="#ffffff" />
            </Pressable>
          </View>
          <Text variant="muted">{t('sleep.adultsHint')}</Text>
        </View>

        <View className="gap-3">
          <Text variant="micro">{t('sleep.targetSchedule')}</Text>
          <View className="flex-row gap-3">
            <TimeField
              icon={Moon}
              label={t('sleep.bedtime')}
              value={bedtime}
              onChange={setBedtime}
              tint={sleepTint}
            />
            <TimeField
              icon={Sun}
              label={t('sleep.wakeUp')}
              value={wake}
              onChange={setWake}
              tint="#f59e0b"
            />
          </View>
        </View>

        <View className="gap-2">
          <CategoryOffNotice category="sleep" />
          <View className={cardClass({ padding: 'rowLg' }, 'flex-row items-center gap-3')}>
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-sleep/10">
              <BellRing size={18} color={sleepTint} />
            </View>
            <View className="flex-1">
              <Text className="font-sora-semibold text-foreground">
                {t('sleep.bedtimeReminder')}
              </Text>
              <Text variant="caption">{t('sleep.reminderHint', { time: toHHmm(bedtime) })}</Text>
            </View>
            <Switch
              value={reminderEnabled}
              onValueChange={setReminderEnabled}
              trackColor={{ true: sleepTint, false: colors[scheme].border }}
              thumbColor="#ffffff"
            />
          </View>
          {reminderEnabled && !notificationsAvailable && (
            <Text variant="caption">{t('reminders.notAvailable')}</Text>
          )}
        </View>

        <Button label={t('sleep.saveGoal')} onPress={save} size="lg" variant="accent" />
      </View>
    </View>
  );
}
