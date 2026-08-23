import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/ui/query-error';
import { moduleTints, resolveTint } from '@/constants/design-tokens';
import { PrivateScreen } from '@/features/private/components/private-screen';
import { privateModule } from '@/features/private/config/private-modules';
import { useSharedAlbumMutations } from '@/features/private/hooks/use-shared-albums';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
import { colors } from '@/constants/theme';
import { toast } from '@/lib/toast-store';

/** 0032's trigger message when a free account is already at its owned-album
 *  limit — matched the same way album-uploader.ts matches "quota" for
 *  photos, so a race with another device (rather than the precheck on the
 *  album list) still gets a useful toast instead of a generic error. */
const PLAN_LIMIT_PATTERN = /free plan allows one shared album/i;

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
  const release = useUnsavedChanges(name.trim() !== '');

  const save = () => {
    if (!canSave) return;
    release();
    createAlbum.mutate(name.trim(), {
      onSuccess: (albumId) => {
        toast.success(t('private.createAlbum'));
        router.replace(`/private/albums/${albumId}`);
      },
      onError: (error) => {
        if (PLAN_LIMIT_PATTERN.test(error instanceof Error ? error.message : '')) {
          toast.error(t('billing.albumLimitToast'));
          router.back();
        }
      },
    });
  };

  return (
    <PrivateScreen moduleId="shared-albums" title={t('private.newAlbum')} tint={tint}>
      <View className="gap-4">
        <Input
          surface="bare"
          value={name}
          onChangeText={setName}
          accessibilityLabel={t('private.albumNamePlaceholder')}
          placeholder={t('private.albumNamePlaceholder')}
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
