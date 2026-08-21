import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Text } from '@/components/ui/text';
import { colors, habitDoneColor } from '@/constants/theme';
import { parseInlineTokens, parseMarkdownLines } from '@/features/notes/services/markdown';

function InlineText({ text, className }: { text: string; className?: string }) {
  const tokens = parseInlineTokens(text);
  return (
    <Text className={className}>
      {tokens.map((token, index) => (
        <Text
          key={index}
          className={[token.bold && 'font-sora-bold', token.italic && 'italic']
            .filter(Boolean)
            .join(' ')}
        >
          {token.text}
        </Text>
      ))}
    </Text>
  );
}

type Props = {
  body: string;
  onToggleChecklist: (checklistIndex: number) => void;
};

export function NoteBodyView({ body, onToggleChecklist }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const doneColor = habitDoneColor[scheme];
  const { t } = useTranslation();
  const lines = parseMarkdownLines(body);
  let checklistIndex = -1;

  if (!body.trim()) {
    return <Text variant="muted">{t('notes.nothingWritten')}</Text>;
  }

  return (
    <View className="gap-2">
      {lines.map((line, index) => {
        if (line.type === 'heading1') {
          return (
            <Text key={index} style={{ fontSize: 22 }} className="font-sora-bold text-foreground">
              {line.text}
            </Text>
          );
        }
        if (line.type === 'heading2') {
          return (
            <Text
              key={index}
              style={{ fontSize: 18 }}
              className="font-sora-semibold text-foreground"
            >
              {line.text}
            </Text>
          );
        }
        if (line.type === 'checklist') {
          checklistIndex += 1;
          const thisIndex = checklistIndex;
          return (
            <Pressable
              key={index}
              onPress={() => {
                Haptics.selectionAsync();
                onToggleChecklist(thisIndex);
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: line.checked }}
              className="flex-row items-center gap-2.5"
            >
              <View
                className="h-5 w-5 items-center justify-center rounded-md border"
                style={{
                  borderColor: line.checked ? doneColor : colors[scheme].border,
                  backgroundColor: line.checked ? doneColor : 'transparent',
                }}
              >
                {line.checked && <Check size={12} color="#ffffff" />}
              </View>
              <InlineText
                text={line.text}
                className={line.checked ? 'flex-1 text-muted-foreground line-through' : 'flex-1'}
              />
            </Pressable>
          );
        }
        if (line.type === 'bullet') {
          return (
            <View key={index} className="flex-row gap-2 ps-1">
              <Text variant="muted">•</Text>
              <InlineText text={line.text} className="flex-1" />
            </View>
          );
        }
        if (line.type === 'quote') {
          return (
            <View key={index} className="border-l-2 border-border ps-3">
              <InlineText text={line.text} className="italic text-muted-foreground" />
            </View>
          );
        }
        if (line.type === 'code') {
          return (
            <View key={index} className="rounded-xl bg-muted p-3">
              <Text
                style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13 }}
                className="text-foreground"
              >
                {line.text}
              </Text>
            </View>
          );
        }
        if (!line.text) return <View key={index} className="h-1" />;
        return <InlineText key={index} text={line.text} />;
      })}
    </View>
  );
}
