import * as Haptics from 'expo-haptics';
import { Pressable, View } from 'react-native';
import { Bold, Code, Italic, ListChecks } from '@/components/ui/icons';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { colors } from '@/constants/theme';

type Selection = { start: number; end: number };

type Props = {
  value: string;
  selection: Selection;
  onChange: (value: string, selection: Selection) => void;
};

function lineStart(text: string, position: number): number {
  const lastNewline = text.lastIndexOf('\n', position - 1);
  return lastNewline + 1;
}

function wrapSelection(text: string, selection: Selection, wrapper: string, placeholder: string) {
  const hasSelection = selection.end > selection.start;
  const inner = hasSelection ? text.slice(selection.start, selection.end) : placeholder;
  const next =
    text.slice(0, selection.start) + wrapper + inner + wrapper + text.slice(selection.end);
  const cursor = selection.start + wrapper.length;
  return { text: next, selection: { start: cursor, end: cursor + inner.length } };
}

function prefixLine(text: string, selection: Selection, prefix: string) {
  const start = lineStart(text, selection.start);
  const next = text.slice(0, start) + prefix + text.slice(start);
  const shift = prefix.length;
  return { text: next, selection: { start: selection.start + shift, end: selection.end + shift } };
}

function insertCodeBlock(text: string, selection: Selection) {
  const hasSelection = selection.end > selection.start;
  const inner = hasSelection ? text.slice(selection.start, selection.end) : 'code';
  const block = `\`\`\`\n${inner}\n\`\`\``;
  const next = text.slice(0, selection.start) + block + text.slice(selection.end);
  const cursor = selection.start + 4;
  return { text: next, selection: { start: cursor, end: cursor + inner.length } };
}

export function MarkdownToolbar({ value, selection, onChange }: Props) {
  const scheme = useColorScheme() ?? 'light';

  const buttons = [
    {
      icon: Bold,
      label: 'Bold',
      onPress: () => onChange(...toArgs(wrapSelection(value, selection, '**', 'bold'))),
    },
    {
      icon: Italic,
      label: 'Italic',
      onPress: () => onChange(...toArgs(wrapSelection(value, selection, '*', 'italic'))),
    },
    {
      icon: ListChecks,
      label: 'Checklist',
      onPress: () => onChange(...toArgs(prefixLine(value, selection, '- [ ] '))),
    },
    {
      icon: Code,
      label: 'Code',
      onPress: () => onChange(...toArgs(insertCodeBlock(value, selection))),
    },
  ];

  function toArgs(result: { text: string; selection: Selection }): [string, Selection] {
    return [result.text, result.selection];
  }

  return (
    <View className="flex-row gap-1 border-t border-border bg-card px-2 py-1.5">
      {buttons.map((button) => (
        <Pressable
          accessibilityRole="button"
          key={button.label}
          onPress={() => {
            Haptics.selectionAsync();
            button.onPress();
          }}
          accessibilityLabel={button.label}
          hitSlop={6}
          className="h-9 w-9 items-center justify-center rounded-lg active:bg-muted"
        >
          <button.icon size={17} color={colors[scheme].foreground} />
        </Pressable>
      ))}
    </View>
  );
}
