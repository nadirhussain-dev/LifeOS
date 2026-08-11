import { LinearGradient } from 'expo-linear-gradient';
import { KeyRound, Lock } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import type { VaultTransitionMode } from '@/features/private/hooks/use-vault-transition';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { tintGradient } from '@/lib/color';

const AnimatedView = Animated.createAnimatedComponent(View);
const RING_SIZE = 128;
const STROKE = 4;
const RADIUS = (RING_SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type Props = {
  visible: boolean;
  mode: VaultTransitionMode;
};

/**
 * The moment the vault key is being derived, turned into something worth
 * watching instead of a frozen screen.
 *
 * This does not make PBKDF2 faster — see use-vault-transition.ts. It exists
 * because a deliberately slow operation with no feedback reads as broken,
 * and the honest fix for that is a good animation, not a weaker KDF.
 */
export function VaultSealTransition({ visible, mode }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();

  const spin = useSharedValue(0);
  const breathe = useSharedValue(1);

  useEffect(() => {
    if (visible) {
      spin.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.linear }), -1, false);
      breathe.value = withRepeat(
        withTiming(1.08, { duration: 620, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(spin);
      cancelAnimation(breathe);
      spin.value = 0;
      breathe.value = 1;
    }
    return () => {
      cancelAnimation(spin);
      cancelAnimation(breathe);
    };
  }, [visible, spin, breathe]);

  const ringStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  const orbStyle = useAnimatedStyle(() => ({ transform: [{ scale: breathe.value }] }));

  if (!visible) return null;

  const [g1, g2] = tintGradient(theme.accent);
  const Icon = mode === 'sealing' ? Lock : KeyRound;

  return (
    <View
      className="absolute inset-0 items-center justify-center gap-6"
      style={{ backgroundColor: theme.background, zIndex: 50, elevation: 50 }}
    >
      <View
        style={{
          width: RING_SIZE,
          height: RING_SIZE,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Indeterminate spinner: four dashes rotating continuously, rather
            than a determinate sweep — there is no real "progress" to report,
            only that work is happening. */}
        <AnimatedView
          style={[{ position: 'absolute', width: RING_SIZE, height: RING_SIZE }, ringStyle]}
        >
          <Svg width={RING_SIZE} height={RING_SIZE}>
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RADIUS}
              stroke={theme.accent}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${CIRCUMFERENCE * 0.16} ${CIRCUMFERENCE * 0.09}`}
              fill="none"
            />
          </Svg>
        </AnimatedView>

        <AnimatedView
          style={[{ width: 76, height: 76, borderRadius: 38, overflow: 'hidden' }, orbStyle]}
        >
          <LinearGradient
            colors={[g1, g2]}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon size={30} color="#ffffff" strokeWidth={1.8} />
          </LinearGradient>
        </AnimatedView>
      </View>

      <View className="items-center gap-1 px-10">
        <Text className="font-sora-semibold text-foreground">
          {mode === 'sealing' ? t('private.sealingSpace') : t('private.openingSpace')}
        </Text>
        <Text variant="caption" className="text-center">
          {t('private.sealingHint')}
        </Text>
      </View>
    </View>
  );
}
