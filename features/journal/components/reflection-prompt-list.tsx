import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import type { JournalPrompt, JournalReflection } from '@/features/journal/types/journal.types';

const AUTOSAVE_DELAY_MS = 500;

function PromptField({
  prompt,
  initialAnswer,
  onSave,
}: {
  prompt: JournalPrompt;
  initialAnswer: string;
  onSave: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [answer, setAnswer] = useState(initialAnswer);

  useEffect(() => setAnswer(initialAnswer), [initialAnswer]);

  useEffect(() => {
    if (answer === initialAnswer) return;
    const timeout = setTimeout(() => onSave(answer), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [answer]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View className="gap-2">
      <Text className="font-journal-italic text-[15px] text-muted-foreground">{prompt.text}</Text>
      <Input
        surface="bare"
        value={answer}
        onChangeText={setAnswer}
        multiline
        accessibilityLabel={prompt.text}
        placeholder={t('journal.writeAFewWords')}
        style={{ fontFamily: 'Literata_400Regular', fontSize: 16, lineHeight: 23 }}
        className="min-h-11 rounded-xl border border-border bg-card p-3 text-foreground"
        textAlignVertical="top"
      />
    </View>
  );
}

type Props = {
  prompts: JournalPrompt[];
  reflections: JournalReflection[];
  onAnswer: (promptId: string, text: string) => void;
};

export function ReflectionPromptList({ prompts, reflections, onAnswer }: Props) {
  const answerByPrompt = new Map(
    reflections.map((reflection) => [reflection.promptId, reflection.answerText]),
  );

  return (
    <View className="gap-4">
      {prompts.map((prompt) => (
        <PromptField
          key={prompt.id}
          prompt={prompt}
          initialAnswer={answerByPrompt.get(prompt.id) ?? ''}
          onSave={(text) => onAnswer(prompt.id, text)}
        />
      ))}
    </View>
  );
}
