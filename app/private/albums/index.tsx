import { useRouter } from 'expo-router';
import { Images, Mail, Plus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { moduleTints, resolveTint } from '@/constants/design-tokens';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { FREE_ALBUM_LIMIT } from '@/features/billing/config/plans';
import { usePlan } from '@/features/billing/hooks/use-billing';
import { privateModule } from '@/features/private/config/private-modules';
import { PrivateScreen } from '@/features/private/components/private-screen';
import { useMyAlbumInvitations } from '@/features/private/hooks/use-album-invites';
import { useAlbumName, useAlbums } from '@/features/private/hooks/use-shared-albums';
import { usePrivateStore } from '@/features/private/store/private-store';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { confirm } from '@/lib/dialog-store';

const TINT = privateModule('shared-albums')?.tint ?? moduleTints.albums;

/**
 * The album list.
 *
 * Real space only — see private-modules.ts's header. `PrivateScreen` already
 * redirects out when the vault is locked; this adds the one check it cannot
 * make for us, because a shared album's membership is visible to the server
 * independent of which local key unlocked this device.
 *
 * Also requires a signed-in account, checked here rather than left to fail
 * server-side: `create_shared_album` and friends are granted to `authenticated`
 * only (migration 0027), so a guest's mutate call was reaching the server and
 * coming back as a raw Postgres permission error — "you do not have access to
 * this", worded for an RLS refusal on someone else's album, shown to someone
 * who was never a member of anything and was just never signed in. Gating the
 * one shared entry point (this screen and together.tsx's, which routes here
 * for its own "create an album" action) means every write underneath —
 * new.tsx, invite.tsx, members.tsx — never gets a guest's tap in the first
 * place, same as split's index.tsx for the same reason.
 */
export default function SharedAlbumsScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const tint = resolveTint(TINT, scheme);
  const { t } = useTranslation();

  const space = usePrivateStore((s) => s.space);
  const session = useAuthStore((s) => s.session);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: albums = [] } = useAlbums();
  const { isPlus } = usePlan();
  // Pending invitations addressed to this account — see use-album-invites.ts.
  // The hook call stays unconditional (Rules of Hooks); it no-ops until
  // signed in (`useMyAlbumInvitations`'s own `enabled` guard), same as
  // useAlbums() below.
  const { data: invites = [] } = useMyAlbumInvitations();

  if (space !== 'real') {
    return (
      <PrivateScreen moduleId="shared-albums" title={t('private.sharedAlbumsTitle')} tint={tint}>
        <Text variant="muted">{t('private.albumsRealSpaceOnly')}</Text>
      </PrivateScreen>
    );
  }

  if (!session) {
    return (
      <PrivateScreen moduleId="shared-albums" title={t('private.sharedAlbumsTitle')} tint={tint}>
        <View className="items-center gap-3 py-10">
          <Text variant="subheading" className="text-center">
            {t('private.albumsSignInTitle')}
          </Text>
          <Text variant="muted" className="text-center">
            {t('private.albumsSignInBody')}
          </Text>
          <Button
            variant="accent"
            label={t('sync.signInCreate')}
            onPress={() => router.push('/(auth)/login')}
          />
        </View>
      </PrivateScreen>
    );
  }

  // Free plan: one OWNED album — being a member of somebody else's doesn't
  // count against it. Migration 0032's trigger is the real enforcement;
  // this only avoids sending someone to a form that would fail.
  const ownedCount = albums.filter((a) => a.createdBy === userId).length;
  const atFreeLimit = !isPlus && ownedCount >= FREE_ALBUM_LIMIT;

  const startNewAlbum = () => {
    if (!atFreeLimit) {
      router.push('/private/albums/new');
      return;
    }
    void confirm({
      title: t('billing.albumLimitTitle'),
      message: t('billing.albumLimitBody', { count: FREE_ALBUM_LIMIT }),
      confirmLabel: t('billing.seePlans'),
      cancelLabel: t('common.cancel'),
    }).then((ok) => {
      if (ok) router.push('/settings/media');
    });
  };

  return (
    <PrivateScreen
      moduleId="shared-albums"
      title={t('private.sharedAlbumsTitle')}
      subtitle={t('private.itemCount', { count: albums.length })}
      tint={tint}
      footer={
        <Pressable
          accessibilityRole="button"
          onPress={startNewAlbum}
          className="flex-row items-center justify-center gap-2 rounded-2xl py-4"
          style={{ backgroundColor: alpha(tint, 0.16) }}
        >
          <Plus size={19} color={tint} strokeWidth={1.9} />
          <Text className="font-sora-medium" style={{ color: tint }}>
            {t('private.newAlbum')}
          </Text>
        </Pressable>
      }
    >
      {invites.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/private/albums/invites')}
          className={cardClass({ padding: 'none' }, 'flex-row items-center gap-3.5 px-4 py-4')}
        >
          <View
            className="h-12 w-12 items-center justify-center rounded-2xl"
            style={{ backgroundColor: alpha(tint, 0.16) }}
          >
            <Mail size={20} color={tint} strokeWidth={1.9} />
          </View>
          <Text className="flex-1 font-sora-medium text-foreground" numberOfLines={1}>
            {t('private.invitesBannerTitle', { count: invites.length })}
          </Text>
        </Pressable>
      ) : null}

      {albums.length === 0 ? (
        <View className="items-center gap-2 py-16">
          <Images size={28} color={alpha(tint, 0.5)} strokeWidth={1.6} />
          <Text variant="subheading">{t('private.albumsEmptyTitle')}</Text>
          <Text variant="muted" className="text-center">
            {t('private.albumsEmptyBody')}
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          {albums.map((album) => (
            <AlbumRow
              key={album.id}
              id={album.id}
              nameCiphertext={album.nameCiphertext}
              tint={tint}
              onPress={() => router.push(`/private/albums/${album.id}`)}
            />
          ))}
        </View>
      )}
    </PrivateScreen>
  );
}

function AlbumRow({
  id,
  nameCiphertext,
  tint,
  onPress,
}: {
  id: string;
  nameCiphertext: string;
  tint: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { name, locked } = useAlbumName(id, nameCiphertext);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={cardClass({ padding: 'none' }, 'flex-row items-center gap-3.5 px-4 py-4')}
    >
      <View
        className="h-12 w-12 items-center justify-center rounded-2xl"
        style={{ backgroundColor: alpha(tint, 0.16) }}
      >
        <Images size={20} color={tint} strokeWidth={1.9} />
      </View>
      <View className="flex-1">
        <Text className="font-sora-medium text-foreground" numberOfLines={1}>
          {locked ? t('private.albumLockedTitle') : name}
        </Text>
        {locked ? (
          <Text variant="caption" numberOfLines={1}>
            {t('private.albumLockedBody')}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
