import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { GradientButton } from '@/components/ui/gradient-button';
import { HeroCard } from '@/components/ui/hero-card';
import { Moon, Sunrise } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { formatClock, formatDuration, minutesOfDay } from '@/features/sleep/services/sleep-stats';
import { useSleepTrackerStore } from '@/features/sleep/store/sleep-tracker-store';
import { alpha } from '@/lib/color';
import { useTheme } from '@/hooks/use-theme';

/** The live bedtime tracker: tap "Going to bed" to stamp the start of sleep,
 * then "I'm awake" on waking — it hands the captured bed→wake span straight to
 * the log form so the user never has to remember or calculate their times. */
export function SleepTrackerCard() {
  const { tint } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { sleepingSince, startSleep, cancelSleep } = useSleepTrackerStore();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!sleepingSince) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [sleepingSince]);

  if (sleepingSince) {
    const elapsedMinutes = Math.max(0, Math.round((now - sleepingSince) / 60000));
    const wake = () => {
      const bedtimeTs = sleepingSince;
      const wakeTs = Date.now();
      cancelSleep();
      router.push(`/sleep/log?bedtimeTs=${bedtimeTs}&wakeTs=${wakeTs}`);
    };

    return (
      <HeroCard tint={tint('sleep')}>
        <View className="gap-4">
          <View className="flex-row items-center gap-2">
            <Moon size={16} color="#ffffff" />
            <Text variant="sectionLabel" style={{ color: alpha('#ffffff', 0.85) }}>
              {t('sleep.sleepingSince', { time: formatClock(minutesOfDay(sleepingSince)) })}
            </Text>
          </View>
          <View className="items-center gap-0.5">
            <Text className="font-sora-extrabold text-4xl" style={{ color: '#ffffff' }}>
              {formatDuration(elapsedMinutes)}
            </Text>
            <Text style={{ color: alpha('#ffffff', 0.85), fontSize: 12 }}>
              {t('sleep.inBedSoFar')}
            </Text>
          </View>
          <GradientButton label={t('sleep.imAwake')} tint="#f59e0b" icon={Sunrise} onPress={wake} />
          <Pressable
            accessibilityRole="button"
            onPress={cancelSleep}
            hitSlop={8}
            className="items-center"
          >
            <Text
              style={{ color: alpha('#ffffff', 0.8), fontSize: 12 }}
              className="font-sora-medium"
            >
              {t('sleep.cancelDidntSleep')}
            </Text>
          </Pressable>
        </View>
      </HeroCard>
    );
  }

  return (
    <View className={cardClass({ padding: 'md' }, 'gap-3')}>
      <View className="flex-row items-center gap-3">
        <View
          className="h-11 w-11 items-center justify-center rounded-2xl"
          style={{ backgroundColor: alpha(tint('sleep'), 0.14) }}
        >
          <Moon size={22} color={tint('sleep')} />
        </View>
        <View className="flex-1">
          <Text className="font-sora-semibold text-foreground">{t('sleep.goingToSleep')}</Text>
          <Text variant="caption">{t('sleep.trackerHint')}</Text>
        </View>
      </View>
      <GradientButton
        label={t('sleep.goingToBed')}
        tint={tint('sleep')}
        icon={Moon}
        onPress={startSleep}
      />
    </View>
  );
}
