import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { X } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

type Props = {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Previously-used tags not already selected, offered as one-tap adds.
   *  Omit or leave empty for no suggestion row. */
  suggestions?: string[];
  tint: string;
  placeholder: string;
};

/**
 * A free-text chip input: type, press done or a trailing comma to add a
 * chip, tap a chip's × to remove it.
 *
 * Deliberately not `components/ui/category-picker.tsx` — that component is
 * backed by a persisted category repository (Tasks/Notes each have their
 * own). This has no registry at all: `value` is just the array of strings
 * this one entry holds, and `suggestions` (if given) comes from whatever the
 * caller has already seen elsewhere, not a table.
 */
export function TagInput({ value, onChange, suggestions = [], tint, placeholder }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const [text, setText] = useState('');

  const add = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const exists = value.some((t) => t.toLowerCase() === trimmed.toLowerCase());
    if (!exists) onChange([...value, trimmed]);
    setText('');
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  // A trailing comma commits the chip immediately, the same "type and
  // punctuate" idiom people already use for tags elsewhere.
  const handleChangeText = (next: string) => {
    if (next.endsWith(',')) {
      add(next.slice(0, -1));
      return;
    }
    setText(next);
  };

  const unusedSuggestions = suggestions
    .filter((s) => !value.some((t) => t.toLowerCase() === s.toLowerCase()))
    .slice(0, 6);

  return (
    <View className="gap-2">
      {value.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {value.map((tag) => (
            <View
              key={tag}
              className="flex-row items-center gap-1 rounded-full border px-3 py-1.5"
              style={{ borderColor: tint, backgroundColor: alpha(tint, 0.12) }}
            >
              <Text className="font-sora-medium text-sm" style={{ color: tint }}>
                {tag}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => remove(tag)} hitSlop={6}>
                <X size={13} color={tint} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <Input
        value={text}
        onChangeText={handleChangeText}
        onSubmitEditing={() => add(text)}
        placeholder={placeholder}
        style={{ fontFamily: 'Sora_400Regular' }}
        returnKeyType="done"
        blurOnSubmit={false}
      />

      {unusedSuggestions.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-1.5"
        >
          {unusedSuggestions.map((s) => (
            <Pressable
              key={s}
              accessibilityRole="button"
              onPress={() => add(s)}
              className="rounded-full border border-dashed px-2.5 py-1"
              style={{ borderColor: theme.border }}
            >
              <Text variant="caption">{s}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
