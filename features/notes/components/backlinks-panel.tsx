import { useRouter } from 'expo-router';
import { Link2 } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import type { NoteBacklink } from '@/features/notes/types/note.types';

type Props = {
  backlinks: NoteBacklink[];
};

/** Notes whose body contains `[[This Note]]` — the always-visible seed of the knowledge graph. */
export function BacklinksPanel({ backlinks }: Props) {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';

  if (backlinks.length === 0) return null;

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-1.5">
        <Link2 size={13} color={colors[scheme].mutedForeground} />
        <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
          Linked mentions
        </Text>
      </View>
      <View className={cardClass({ padding: 'none' }, 'gap-1 px-4')}>
        {backlinks.map((backlink, index) => (
          <Pressable
            accessibilityRole="button"
            key={backlink.id}
            onPress={() => router.push(`/note/${backlink.id}`)}
            className={index === 0 ? 'py-3' : 'border-t border-border py-3'}
          >
            <Text className="font-sora-medium">{backlink.title}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
