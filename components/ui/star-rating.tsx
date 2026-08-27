import * as Haptics from 'expo-haptics';
import { Pressable, View } from 'react-native';

import { Star } from '@/components/ui/icons';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = {
  value: number | null;
  onChange: (value: number | null) => void;
  count?: number;
  size?: number;
  color?: string;
};

/** Tappable star row. Tapping the current rating again clears it (null), so a
 * rating stays optional. */
export function StarRating({ value, onChange, count = 5, size = 30, color = '#eab308' }: Props) {
  const scheme = useColorScheme() ?? 'light';

  return (
    <View className="flex-row items-center gap-2">
      {Array.from({ length: count }).map((_, index) => {
        const rating = index + 1;
        const filled = value !== null && rating <= value;
        return (
          <Pressable
            key={rating}
            onPress={() => {
              Haptics.selectionAsync();
              onChange(value === rating ? null : rating);
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${rating} star${rating > 1 ? 's' : ''}`}
          >
            <Star
              size={size}
              color={filled ? color : colors[scheme].border}
              fill={filled ? color : 'transparent'}
              strokeWidth={2}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
