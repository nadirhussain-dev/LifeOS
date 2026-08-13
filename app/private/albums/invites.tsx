import { formatDistanceToNowStrict } from 'date-fns';
import { useRouter } from 'expo-router';
import { Mail, MailX } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { moduleTints, resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { PrivateScreen } from '@/features/private/components/private-screen';
import { privateModule } from '@/features/private/config/private-modules';
import {
  useDeclineAlbumInvite,
  useMyAlbumInvitations,
} from '@/features/private/hooks/use-album-invites';
import type { MyAlbumInvite } from '@/features/private/services/album-invite';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { confirm } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

const TINT = privateModule('shared-albums')?.tint ?? moduleTints.albums;

/**
 * Invitations addressed to this account, discoverable without needing the
 * link/token handed over out of band — see album-invite.ts's
 * `listMyAlbumInvitations` and migration 0045's read-by-email policy.
 *
 * No album name here, same constraint as the token-based accept screen: it
 * is still ciphertext this device has no key for until membership (and
 * separately, the key) is actually granted. Accepting routes into that
 * exact screen rather than duplicating its redeem flow; declining is the one
 * thing this screen does on its own.
 */
export default function AlbumInvitesScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const tint = resolveTint(TINT, scheme);
  const { t } = useTranslation();

  const { data: invites = [], isLoading } = useMyAlbumInvitations();
  const decline = useDeclineAlbumInvite();

  const declineOne = (invite: MyAlbumInvite) =>
    void confirm({
      title: t('private.declineInviteTitle'),
      message: t('private.declineInviteBody'),
      confirmLabel: t('private.declineInvite'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      decline.mutate(invite.token, {
        onSuccess: () => toast.success(t('private.inviteDeclined')),
      });
    });

  return (
    <PrivateScreen moduleId="shared-albums" title={t('private.invitesTitle')} tint={tint}>
      {!isLoading && invites.length === 0 ? (
        <View className="items-center gap-2 py-16">
          <Mail size={28} color={alpha(tint, 0.5)} strokeWidth={1.6} />
          <Text variant="subheading">{t('private.invitesEmpty')}</Text>
        </View>
      ) : (
        <View className="gap-3">
          {invites.map((invite) => (
            <View
              key={invite.id}
              className={cardClass({ padding: 'none' }, 'flex-row items-center gap-3.5 px-4 py-4')}
            >
              <View
                className="h-12 w-12 items-center justify-center rounded-2xl"
                style={{ backgroundColor: alpha(tint, 0.16) }}
              >
                <Mail size={20} color={tint} strokeWidth={1.9} />
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="font-sora-medium text-foreground" numberOfLines={1}>
                  {t('private.sharedAlbumsTitle')}
                </Text>
                <Text variant="caption">
                  {formatDistanceToNowStrict(new Date(invite.createdAt), { addSuffix: true })}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/private/albums/accept/${invite.token}`)}
                className="rounded-full px-3.5 py-2"
                style={{ backgroundColor: alpha(tint, 0.16) }}
              >
                <Text className="font-sora-medium text-sm" style={{ color: tint }}>
                  {t('private.acceptAlbumFinish')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('private.declineInvite')}
                onPress={() => declineOne(invite)}
                hitSlop={8}
                className="h-9 w-9 items-center justify-center"
              >
                <MailX size={17} color={theme.mutedForeground} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </PrivateScreen>
  );
}
