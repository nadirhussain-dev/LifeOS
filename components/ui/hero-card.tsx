import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

import { radius } from '@/constants/design-tokens';
import { alpha, glowShadow, tintGradientTriple } from '@/lib/color';

type Props = {
  /** Signature module tint the gradient + glow derive from. */
  tint: string;
  children: ReactNode;
  style?: ViewStyle;
  /** Soft colored glow beneath the card. Default on. */
  glow?: boolean;
  padded?: boolean;
};

/**
 * The signature hero surface of the premium design language: a rounded card
 * filled with a three-stop gradient derived from the module tint, a soft
 * colored glow, and two faint decorative orbs for depth. Content sits on top
 * and should use light/white text since the fill is saturated.
 */
export function HeroCard({ tint, children, style, glow = true, padded = true }: Props) {
  const [c1, c2, c3] = tintGradientTriple(tint);

  return (
    <View
      style={[
        { borderRadius: radius['2xl'], overflow: 'hidden' },
        glow && glowShadow(tint, 0.4),
        style,
      ]}
    >
      <LinearGradient
        colors={[c1, c2, c3]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: radius['2xl'] }}
      >
        {/* Decorative orbs — faint lighter circles for glassy depth. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -50,
            right: -30,
            width: 150,
            height: 150,
            borderRadius: 75,
            backgroundColor: alpha('#ffffff', 0.12),
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: -60,
            left: -20,
            width: 130,
            height: 130,
            borderRadius: 65,
            backgroundColor: alpha('#ffffff', 0.07),
          }}
        />
        <View style={padded ? { padding: 20 } : undefined}>{children}</View>
      </LinearGradient>
    </View>
  );
}
