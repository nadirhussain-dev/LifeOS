import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/ui/query-error';
import { Text } from '@/components/ui/text';
import { moduleTints, resolveTint } from '@/constants/design-tokens';
import { PrivateScreen } from '@/features/private/components/private-screen';
import { privateModule } from '@/features/private/config/private-modules';
import { useSharedAlbumMutations } from '@/features/private/hooks/use-shared-albums';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { colors } from '@/constants/theme';
import { toast } from '@/lib/toast-store';

const TINT = privateModule('shared-albums')?.tint ?? moduleTints.albums;

/**
 * Creates an album and this device's own copy of its key, in one step — the
 * owner never goes through the out-of-band exchange for an album they made
 * themselves (see use-shared-albums.ts's `createAlbum`).
 */
export default function NewSharedAlbumScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const tint = resolveTint(TINT, scheme);
  const { t } = useTranslation();
  const { createAlbum } = useSharedAlbumMutations();

  const [name, setName] = useState('');
  const canSave = name.trim().length > 0 && !createAlbum.isPending;

  const save = () => {
    if (!canSave) return;
    createAlbum.mutate(name.trim(), {
      onSuccess: (albumId) => {
        toast.success(t('private.createAlbum'));
        router.replace(`/private/albums/${albumId}`);
      },
    });
  };

  return (
    <PrivateScreen title={t('private.newAlbum')} tint={tint}>
      <View className="gap-4">
        <TextInput
          value={name}
          onChangeText={setName}
          accessibilityLabel={t('private.albumNamePlaceholder')}
          placeholder={t('private.albumNamePlaceholder')}
          placeholderTextColor={theme.mutedForeground}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={save}
          maxLength={60}
          style={{ fontSize: 22, fontFamily: 'Sora_700Bold', color: theme.foreground }}
        />

        {createAlbum.isError ? <InlineError error={createAlbum.error} /> : null}

        <Button
          label={createAlbum.isPending ? t('common.saving') : t('private.createAlbum')}
          onPress={save}
          disabled={!canSave}
          size="lg"
          variant="accent"
        />
      </View>
    </PrivateScreen>
  );
}
