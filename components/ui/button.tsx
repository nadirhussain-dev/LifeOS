import { cva, type VariantProps } from 'class-variance-authority';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, type PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { accentGlow, accentGradient } from '@/constants/design-tokens';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'flex-row items-center justify-center overflow-hidden rounded-full disabled:opacity-40',
  {
    variants: {
      variant: {
        primary: 'bg-primary',
        secondary: 'bg-secondary',
        ghost: 'bg-transparent',
        destructive: 'bg-destructive',
        // accent paints via a LinearGradient layer instead of a flat fill —
        // no bg-* class here, see the gradient rendered behind the label below.
        accent: '',
      },
      size: {
        sm: 'h-9 px-3',
        md: 'h-11 px-4',
        lg: 'h-14 px-6',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

const textVariants = cva('font-sora-semibold', {
  variants: {
    variant: {
      primary: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      ghost: 'text-foreground',
      destructive: 'text-destructive-foreground',
      accent: 'text-accent-foreground',
    },
    size: {
      sm: 'text-sm',
      md: 'text-base',
      lg: 'text-lg',
    },
  },
  defaultVariants: {
    variant: 'primary',
    size: 'md',
  },
});

const SHADOW_VARIANTS = new Set(['primary', 'accent', 'destructive']);

type Props = PressableProps &
  VariantProps<typeof buttonVariants> & {
    label: string;
    className?: string;
  };

// The scale animation lives on a wrapping Animated.View rather than the
// Pressable itself: Animated.createAnimatedComponent(Pressable) creates a
// component NativeWind hasn't registered className/style interop for, so a
// className passed directly to it is silently dropped (renders unstyled).
export function Button({
  label,
  variant = 'primary',
  size,
  className,
  disabled,
  onPressIn,
  onPressOut,
  ...props
}: Props) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const hasShadow = !disabled && SHADOW_VARIANTS.has(variant ?? 'primary');

  return (
    <Animated.View
      style={[
        animatedStyle,
        hasShadow && {
          shadowColor: variant === 'accent' ? accentGlow : '#000',
          shadowOpacity: 0.22,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 4,
        },
      ]}
    >
      <Pressable
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        className={cn(buttonVariants({ variant, size }), className)}
        onPressIn={(e) => {
          scale.value = withSpring(0.96, { damping: 16, stiffness: 400 });
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          scale.value = withSpring(1, { damping: 12, stiffness: 300 });
          onPressOut?.(e);
        }}
        {...props}
      >
        {variant === 'accent' && !disabled && (
          <LinearGradient
            colors={accentGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
        )}
        {variant === 'accent' && disabled && (
          <Animated.View className="absolute inset-0 bg-accent" />
        )}
        <Text className={textVariants({ variant, size })}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}
