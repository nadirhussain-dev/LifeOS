import * as Haptics from 'expo-haptics';
import { Battery, Moon, Target, Waves } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { moduleTint, resolveTint, type TintPair } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { MOOD_EMOJI, MOOD_LABEL_KEY, MOOD_TINT } from '@/features/journal/constants';
import { alpha } from '@/lib/color';
import { MOOD_REASONS, type MoodOption } from '@/features/journal/types/journal.types';

const MOODS: { value: MoodOption; emoji: string; labelKey: string; tint: TintPair }[] = (
  ['great', 'good', 'okay', 'low', 'rough'] as const
).map((value) => ({
  value,
  emoji: MOOD_EMOJI[value],
  labelKey: MOOD_LABEL_KEY[value],
  tint: MOOD_TINT[value],
}));

const ENERGY_LABELS = ['mood.energy1', 'mood.energy2', 'mood.energy3', 'mood.energy4', 'mood.energy5'] as const; // prettier-ignore
const STRESS_LABELS = ['mood.stress1', 'mood.stress2', 'mood.stress3', 'mood.stress4', 'mood.stress5'] as const; // prettier-ignore
const FOCUS_LABELS = ['mood.focus1', 'mood.focus2', 'mood.focus3', 'mood.focus4', 'mood.focus5'] as const; // prettier-ignore
const SLEEP_QUALITY_LABELS = ['mood.sleep1', 'mood.sleep2', 'mood.sleep3', 'mood.sleep4', 'mood.sleep5'] as const; // prettier-ignore

const ENERGY_TINT = '#22c55e';
const STRESS_TINT = '#f97316';
const FOCUS_TINT = '#0ea5e9';
const SLEEP_TINT = '#8b5cf6';

function MoodButton({
  option,
  selected,
  onPress,
}: {
  option: (typeof MOODS)[number];
  selected: boolean;
  onPress: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const scale = useSharedValue(1);
  const isMounted = useRef(false);

  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    if (selected)
      scale.value = withSequence(
        withSpring(1.25, { damping: 7, stiffness: 400 }),
        withSpring(1, { damping: 9, stiffness: 300 }),
      );
  }, [selected, scale]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={t(option.labelKey)}
      className="items-center gap-1.5 rounded-2xl px-2 py-3"
      style={{
        backgroundColor: selected ? alpha(resolveTint(option.tint, scheme), 0.12) : 'transparent',
      }}
    >
      <Animated.View
        style={[{ height: 40, alignItems: 'center', justifyContent: 'center' }, animatedStyle]}
      >
        <Text style={{ fontSize: 28, lineHeight: 34 }}>{option.emoji}</Text>
      </Animated.View>
      <Text
        variant="caption"
        className="font-sora-medium"
        style={{
          color: selected ? resolveTint(option.tint, scheme) : colors[scheme].mutedForeground,
        }}
      >
        {t(option.labelKey)}
      </Text>
    </Pressable>
  );
}

type ScaleRowProps = {
  icon: typeof Battery;
  label: string;
  value: number | null;
  levelLabels: readonly string[];
  tint: string;
  onChange: (value: number) => void;
};

function ScaleRow({ icon: Icon, label, value, levelLabels, tint, onChange }: ScaleRowProps) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const descriptor = value ? t(levelLabels[value - 1]) : null;

  return (
    <View className="gap-1.5">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1.5">
          <Icon size={13} color={tint} />
          <Text variant="micro" className="font-sora-semibold">
            {label}
          </Text>
        </View>
        <Text
          variant="caption"
          className="font-sora-medium"
          style={{ color: descriptor ? tint : colors[scheme].mutedForeground }}
        >
          {descriptor ?? t('mood.notSet')}
        </Text>
      </View>
      <View className="flex-row gap-2">
        {[1, 2, 3, 4, 5].map((level) => {
          const selected = value !== null && level <= value;
          const isCurrent = value === level;
          return (
            <Pressable
              key={level}
              onPress={() => {
                Haptics.selectionAsync();
                onChange(level);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: isCurrent }}
              accessibilityLabel={`${label}: ${t(levelLabels[level - 1])}`}
              className="h-9 flex-1 items-center justify-center rounded-full border"
              style={{
                borderColor: selected ? tint : colors[scheme].border,
                backgroundColor: selected ? tint : 'transparent',
              }}
            >
              <Text
                variant="caption"
                className="font-sora-semibold"
                style={{ color: selected ? '#ffffff' : colors[scheme].mutedForeground }}
              >
                {level}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

type Props = {
  mood: MoodOption | null;
  energy: number | null;
  stress: number | null;
  focus: number | null;
  sleepHours: number | null;
  sleepQuality: number | null;
  moodReasons: string[] | null;
  onChangeMood: (mood: MoodOption) => void;
  onChangeEnergy: (value: number) => void;
  onChangeStress: (value: number) => void;
  onChangeFocus: (value: number) => void;
  onChangeSleepHours: (value: number | null) => void;
  onChangeSleepQuality: (value: number) => void;
  onToggleReason: (reason: string) => void;
};

export function MoodCheckin({
  mood,
  energy,
  stress,
  focus,
  sleepHours,
  sleepQuality,
  moodReasons,
  onChangeMood,
  onChangeEnergy,
  onChangeStress,
  onChangeFocus,
  onChangeSleepHours,
  onChangeSleepQuality,
  onToggleReason,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const [sleepHoursText, setSleepHoursText] = useState(
    sleepHours !== null ? String(sleepHours) : '',
  );
  const reasons = new Set(moodReasons ?? []);

  return (
    <View className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-5')}>
      <View className="flex-row justify-between" accessibilityRole="radiogroup">
        {MOODS.map((option) => (
          <MoodButton
            key={option.value}
            option={option}
            selected={mood === option.value}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onChangeMood(option.value);
            }}
          />
        ))}
      </View>

      <ScaleRow
        icon={Battery}
        label={t('mood.energyLabel')}
        value={energy}
        levelLabels={ENERGY_LABELS}
        tint={ENERGY_TINT}
        onChange={onChangeEnergy}
      />
      <ScaleRow
        icon={Waves}
        label={t('mood.stressLabel')}
        value={stress}
        levelLabels={STRESS_LABELS}
        tint={STRESS_TINT}
        onChange={onChangeStress}
      />
      <ScaleRow
        icon={Target}
        label={t('mood.focusLabel')}
        value={focus}
        levelLabels={FOCUS_LABELS}
        tint={FOCUS_TINT}
        onChange={onChangeFocus}
      />
      <ScaleRow
        icon={Moon}
        label={t('mood.sleepQualityLabel')}
        value={sleepQuality}
        levelLabels={SLEEP_QUALITY_LABELS}
        tint={SLEEP_TINT}
        onChange={onChangeSleepQuality}
      />

      <View className="flex-row items-center gap-2">
        <Moon size={13} color={SLEEP_TINT} />
        <Text variant="micro" className="font-sora-semibold">
          {t('mood.hoursSlept')}
        </Text>
        <TextInput
          value={sleepHoursText}
          onChangeText={(text) => {
            setSleepHoursText(text);
            const parsed = parseFloat(text);
            onChangeSleepHours(Number.isFinite(parsed) ? parsed : null);
          }}
          keyboardType="decimal-pad"
          placeholder="7.5"
          placeholderTextColor={colors[scheme].mutedForeground}
          className="w-16 rounded-lg border border-border px-2 py-1.5 text-center text-foreground"
        />
      </View>

      <View className="gap-1.5">
        <Text variant="micro" className="font-sora-semibold">
          {t('mood.whatInfluenced')}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {MOOD_REASONS.map((reason) => {
            const selected = reasons.has(reason);
            return (
              <Pressable
                accessibilityRole="button"
                key={reason}
                onPress={() => {
                  Haptics.selectionAsync();
                  onToggleReason(reason);
                }}
                className="rounded-full border px-3 py-1.5"
                style={{
                  borderColor: selected ? moduleTint('journal', scheme) : colors[scheme].border,
                  backgroundColor: selected ? moduleTint('journal', scheme) : 'transparent',
                }}
              >
                <Text
                  variant="caption"
                  className="font-sora-medium"
                  style={{ color: selected ? '#ffffff' : colors[scheme].mutedForeground }}
                >
                  {t(`mood.reasons.${reason}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
