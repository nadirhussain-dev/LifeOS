import { formatDistanceToNowStrict } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { Send, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { moduleTints, resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { PrivateScreen } from '@/features/private/components/private-screen';
import { privateModule } from '@/features/private/config/private-modules';
import { nextCheckInPrompt } from '@/features/private/services/check-in-prompts';
import { useAlbumNoteMutations, useAlbumNotes } from '@/features/private/hooks/use-album-notes';
import {
  useAlbumDetail,
  useAlbumKey,
  useAlbumRealtime,
  useMyAlbumMembership,
} from '@/features/private/hooks/use-shared-albums';
import { usePrivateStore } from '@/features/private/store/private-store';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

const TINT = privateModule('shared-albums')?.tint ?? moduleTints.albums;

/**
 * A freeform shared-thoughts feed — distinct from per-photo comments and
 * from the album's own chat (migration 0040). The composer's placeholder is
 * today's check-in prompt (check-in-prompts.ts); that's the entire "check-in"
 * feature, there's no separate backend concept for it. Gated by allow_notes,
 * same shape as chat's allow_chat — toggled from members.tsx.
 */
export default function AlbumNotesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const tint = resolveTint(TINT, scheme);
  const { t } = useTranslation();

  const space = usePrivateStore((s) => s.space);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  useAlbumRealtime(id);
  const { data } = useAlbumDetail(id);
  const { data: albumKey } = useAlbumKey(id);
  const { isOwner } = useMyAlbumMembership(data);
  const { data: notes = [] } = useAlbumNotes(id, albumKey ?? null);
  const { addNote, removeNote } = useAlbumNoteMutations(id);

  const [draft, setDraft] = useState('');
  const canSend = isOwner || !!data?.album?.allowNotes;
  const prompt = t(nextCheckInPrompt());

  if (space !== 'real') {
    return (
      <PrivateScreen moduleId="shared-albums" title={t('private.notesTitle')} tint={tint}>
        <Text variant="muted">{t('private.albumsRealSpaceOnly')}</Text>
      </PrivateScreen>
    );
  }

  const send = () => {
    const body = draft.trim();
    if (!body || !albumKey) return;
    addNote.mutate({ body, albumKey }, { onSuccess: () => void Haptics.selectionAsync() });
    setDraft('');
  };

  return (
    <PrivateScreen
      moduleId="shared-albums"
      title={t('private.notesTitle')}
      subtitle={t('private.notesSubtitle')}
      tint={tint}
      footer={
        canSend ? (
          <View
            className="flex-row items-center gap-2 rounded-2xl border border-border px-3 py-2"
          >
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={prompt}
              placeholderTextColor={theme.mutedForeground}
              multiline
              maxLength={2000}
              className="flex-1 text-foreground"
              style={{ maxHeight: 90 }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('private.postComment')}
              disabled={!draft.trim() || addNote.isPending}
              onPress={send}
              className="h-9 w-9 items-center justify-center rounded-full"
              style={{ backgroundColor: alpha(tint, draft.trim() ? 0.9 : 0.3) }}
            >
              <Send size={15} color="#ffffff" />
            </Pressable>
          </View>
        ) : (
          <Text variant="caption" className="text-center">
            {t('private.notesOff')}
          </Text>
        )
      }
    >
      {notes.length === 0 ? (
        <View className="items-center gap-2 py-16">
          <Text variant="subheading">{t('private.notesEmptyTitle')}</Text>
          <Text variant="caption" className="text-center">
            {prompt}
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          {notes.map((note) => {
            const mine = note.authorId === userId;
            return (
              <View key={note.id} className="flex-row items-start gap-2.5">
                <View
                  className="h-8 w-8 items-center justify-center rounded-full"
                  style={{ backgroundColor: alpha(tint, 0.16) }}
                >
                  <Text className="font-sora-semibold text-xs" style={{ color: tint }}>
                    {(note.authorName ?? '?').slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View className="flex-1 gap-0.5">
                  <View className="flex-row items-center gap-2">
                    <Text className="font-sora-medium text-sm text-foreground">
                      {note.authorName ?? t('moderation.someone')}
                    </Text>
                    <Text variant="caption">
                      {formatDistanceToNowStrict(new Date(note.createdAt), { addSuffix: true })}
                    </Text>
                  </View>
                  <Text className="text-foreground">{note.body ?? t('private.commentLocked')}</Text>
                </View>
                {mine || isOwner ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('common.delete')}
                    hitSlop={8}
                    onPress={() => removeNote.mutate(note.id)}
                  >
                    <Trash2 size={14} color={theme.mutedForeground} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </PrivateScreen>
  );
}
