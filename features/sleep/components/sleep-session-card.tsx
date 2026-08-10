import { format, parseISO } from 'date-fns';
import { Moon, Star, Sun } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { ArrowForward } from '@/components/ui/directional-icon';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { formatClock, formatDuration, minutesOfDay } from '@/features/sleep/services/sleep-stats';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { asleepMinutes, type SleepSession } from '@/features/sleep/types/sleep.types';

type Props = {
  session: SleepSession;
  goalMinutes: number;
  onPress: (session: SleepSession) => void;
};

export function SleepSessionCard({ session, goalMinutes, onPress }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const sleepTint = moduleTint('sleep', scheme);
  const metGoal = session.durationMinutes >= goalMinutes;

  return (
    <Pressable
      onPress={() => onPress(session)}
      className={cardClass({ padding: 'md' }, 'flex-row items-center gap-3')}
      accessibilityRole="button"
      accessibilityLabel={t('sleep.sessionA11y', { date: session.logDate })}
    >
      <View
        className="h-11 w-11 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${sleepTint}1f` }}
      >
        <Moon size={20} color={sleepTint} />
      </View>

      <View className="flex-1 gap-1">
        <View className="flex-row items-center gap-2">
          <Text className="font-sora-semibold text-foreground">
            {format(parseISO(session.logDate), 'EEE, MMM d')}
          </Text>
          {metGoal && (
            <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#22c55e' }} />
          )}
        </View>
        <View className="flex-row items-center gap-1.5">
          <Moon size={12} color={colors[scheme].mutedForeground} />
          <Text variant="caption">{formatClock(minutesOfDay(session.bedtime))}</Text>
          <ArrowForward size={11} color={colors[scheme].mutedForeground} />
          <Sun size={12} color={colors[scheme].mutedForeground} />
          <Text variant="caption">{formatClock(minutesOfDay(session.wakeTime))}</Text>
        </View>
        {session.fellAsleepMinutes != null && (
          <Text variant="caption">
            {t('sleep.asleepAndNodOff', {
              duration: formatDuration(asleepMinutes(session)),
              minutes: session.fellAsleepMinutes,
            })}
          </Text>
        )}
      </View>

      <View className="items-end gap-1">
        <Text
          className="font-sora-bold"
          style={{ color: metGoal ? colors[scheme].success : colors[scheme].foreground }}
        >
          {formatDuration(session.durationMinutes)}
        </Text>
        {session.quality ? (
          <View className="flex-row items-center gap-0.5">
            <Star size={11} color="#eab308" fill="#eab308" />
            <Text variant="caption">{session.quality}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
