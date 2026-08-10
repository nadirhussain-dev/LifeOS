import * as Haptics from 'expo-haptics';
import { type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { resolveTint, type TintPair } from '@/constants/design-tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Item = { id: string; label: string; icon: LucideIcon; tint: TintPair };

type Props = {
  items: Item[];
  value: string;
  onChange: (id: string) => void;
};

/** Wrapping grid of category chips (icon + label). The selected chip fills with
 * its category tint. Used for both expense and income category selection. */
export function CategoryGrid({ items, value, onChange }: Props) {
  const scheme = useColorScheme() ?? 'light';
  return (
    <View className="flex-row flex-wrap gap-2">
      {items.map((item) => {
        const selected = item.id === value;
        const tint = resolveTint(item.tint, scheme);
        const Icon = item.icon;
        return (
          <Pressable
            key={item.id}
            onPress={() => {
              Haptics.selectionAsync();
              onChange(item.id);
            }}
            style={selected ? { backgroundColor: tint, borderColor: tint } : undefined}
            className="flex-row items-center gap-1.5 rounded-full border border-border px-3 py-2"
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Icon size={15} color={selected ? '#ffffff' : tint} strokeWidth={2.2} />
            <Text className={selected ? 'font-sora-medium text-white' : 'text-muted-foreground'}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
