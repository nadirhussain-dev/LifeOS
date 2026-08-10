import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { Copy, KeyRound, Link as LinkIcon, Share2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Share, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import {
  useAlbumDetail,
  useAlbumKey,
  useSharedAlbumMutations,
} from '@/features/private/hooks/use-shared-albums';
import { PrivateScreen } from '@/features/private/components/private-screen';
import { resendAlbumKey } from '@/features/private/services/album-invite';
import { useTheme } from '@/hooks/use-theme';
import { toast } from '@/lib/toast-store';

/**
 * Sharing an album with someone — two channels kept apart, mirroring
 * transfer.tsx's own vault-transfer screen almost exactly, plus a third
 * channel Split-style invites have and the vault transfer does not: an
 * actual Postgres membership link, since here the two things being handed
 * over are genuinely independent (see album-invite.ts and migration 0027's
 * header) rather than two halves of one secret.
 *
 * Reached two ways: a brand-new placeholder member (no token exists yet, so
 * this mints one alongside the key transfer) or "resend key" for somebody
 * already a member but still shown as waiting — see [id]/members.tsx. The
 * second case only re-runs the out-of-band half; there is no new link to
 * generate, because their Postgres membership already exists.
 */
export default function AlbumInviteScreen() {
  const { id, memberId } = useLocalSearchParams<{ id: string; memberId: string }>();
  const { t } = useTranslation();
  const { c } = useTheme();

  const { data } = useAlbumDetail(id);
  const { data: albumKey } = useAlbumKey(id);
  const { invite } = useSharedAlbumMutations(id);

  const member = data?.members.find((m) => m.id === memberId) ?? null;
  const isResend = !!member?.userId;

  const [bundle, setBundle] = useState<{ code: string; payload: string; token?: string } | null>(
    null,
  );
  const [generating, setGenerating] = useState(false);

  const generate = async () => {
    if (!albumKey || !member || !id) return;
    setGenerating(true);
    try {
      if (isResend) {
        const b = await resendAlbumKey(albumKey);
        setBundle(b);
      } else {
        const b = await invite.mutateAsync({
          memberId: member.id,
          email: member.email ?? '',
          albumKey,
        });
        setBundle(b);
      }
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    void generate();
    // Re-run only when the target member or the key changes, not on every
    // render — a fresh code/payload each render would make the one already
    // shared with the previous render worthless the moment the screen redraws.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, albumKey]);

  if (!albumKey) {
    return (
      <PrivateScreen title={t('private.invite')} tint={c.accent}>
        <Text variant="muted">{t('private.albumLockedBody')}</Text>
      </PrivateScreen>
    );
  }

  const link = bundle?.token ? Linking.createURL(`/private/albums/accept/${bundle.token}`) : null;

  return (
    <PrivateScreen title={t('private.invite')} tint={c.accent}>
      <ScrollView contentContainerClassName="gap-6 pb-10" showsVerticalScrollIndicator={false}>
        <Text variant="muted">{t('private.inviteIntro')}</Text>

        <View className={cardClass({ padding: 'md' }, 'gap-2')}>
          <View className="flex-row items-center gap-2">
            <KeyRound size={16} color={c.accent} />
            <Text variant="micro">{t('transfer.stepCode')}</Text>
          </View>
          <Text
            className="font-sora-bold text-foreground"
            style={{ fontSize: 20, letterSpacing: 2 }}
            selectable
          >
            {generating ? '…' : bundle?.code ?? '…'}
          </Text>
          <Text variant="caption">{t('transfer.codeHint')}</Text>
        </View>

        <View className={cardClass({ padding: 'md' }, 'gap-3')}>
          <View className="flex-row items-center gap-2">
            <Share2 size={16} color={c.accent} />
            <Text variant="micro">{t('transfer.stepPayload')}</Text>
          </View>
          <Text variant="caption">{t('transfer.payloadHint')}</Text>

          <Pressable
            accessibilityRole="button"
            disabled={!bundle}
            onPress={() => {
              if (!bundle) return;
              void Clipboard.setStringAsync(bundle.payload).then(() =>
                toast.success(t('transfer.copied')),
              );
            }}
            className="flex-row items-center justify-center gap-2 rounded-full border py-3"
            style={{ borderColor: c.border, opacity: bundle ? 1 : 0.5 }}
          >
            <Copy size={15} color={c.foreground} />
            <Text className="font-sora-medium" style={{ color: c.foreground }}>
              {t('transfer.copyPayload')}
            </Text>
          </Pressable>
        </View>

        {link ? (
          <View className={cardClass({ padding: 'md' }, 'gap-3')}>
            <View className="flex-row items-center gap-2">
              <LinkIcon size={16} color={c.accent} />
              <Text variant="micro">{t('private.inviteStepLink')}</Text>
            </View>
            <Text variant="caption">{t('private.inviteLinkHint')}</Text>

            <View className="flex-row gap-2">
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  void Clipboard.setStringAsync(link).then(() => toast.success(t('transfer.copied')))
                }
                className="flex-1 flex-row items-center justify-center gap-2 rounded-full border py-3"
                style={{ borderColor: c.border }}
              >
                <Copy size={15} color={c.foreground} />
                <Text className="font-sora-medium" style={{ color: c.foreground }}>
                  {t('private.copyLink')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void Share.share({ message: link })}
                className="flex-1 flex-row items-center justify-center gap-2 rounded-full border py-3"
                style={{ borderColor: c.border }}
              >
                <Share2 size={15} color={c.foreground} />
                <Text className="font-sora-medium" style={{ color: c.foreground }}>
                  {t('private.shareInvite')}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View
          className="rounded-2xl border p-4"
          style={{ borderColor: c.warning, backgroundColor: `${c.warning}14` }}
        >
          <Text className="font-sora-semibold" style={{ color: c.foreground }}>
            {t('transfer.warnTitle')}
          </Text>
          <Text variant="caption" className="mt-1">
            {t('transfer.warnBody')}
          </Text>
        </View>

        <Button
          variant="secondary"
          size="lg"
          label={generating ? t('common.saving') : t('private.resendKey')}
          onPress={() => void generate()}
          disabled={generating}
        />
      </ScrollView>
    </PrivateScreen>
  );
}
