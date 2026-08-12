import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ClipboardPaste } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import {
  acceptAlbumInvite,
  peekAlbumInvite,
  redeemAlbumInvite,
} from '@/features/private/services/album-invite';
import { PrivateScreen } from '@/features/private/components/private-screen';
import { usePrivateStore } from '@/features/private/store/private-store';
import { useTheme } from '@/hooks/use-theme';
import { toast } from '@/lib/toast-store';

/**
 * The target of `lifeos://private/albums/accept/<token>` — the Postgres
 * half of an album invite. The link is membership-only, deliberately: the
 * out-of-band code+payload that actually decrypt the album must travel
 * through a separate channel (spoken code, a second message, in person),
 * same discipline as transfer.tsx's vault-transfer screen. Folding both
 * halves into one link would mean a single intercepted link hands over full
 * decryption capability, not just membership — see invite.tsx's header.
 *
 * `PrivateScreen` already redirects to unlock/setup when the vault is
 * locked or never set up (see unlock.tsx), so by the time this screen
 * renders content the vault is guaranteed unlocked. If that detour was
 * needed, the token stays valid (it isn't consumed by a failed attempt) —
 * following the same link again after finishing setup picks up right here.
 */
type Phase = 'loading' | 'failed' | 'ready' | 'joining' | 'redeem' | 'redeeming' | 'done';

const FAILURE_KEYS: Record<string, string> = {
  invalid: 'private.inviteInvalid',
  expired: 'private.inviteExpired',
  already_accepted: 'private.inviteAlreadyAccepted',
  blocked: 'private.inviteBlocked',
  member_unavailable: 'private.inviteInvalid',
};

export default function AcceptAlbumInviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { c } = useTheme();
  const space = usePrivateStore((s) => s.space);
  const vaultKey = usePrivateStore((s) => s.key);

  const [phase, setPhase] = useState<Phase>('loading');
  const [failureKey, setFailureKey] = useState<string>('private.inviteError');
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [payload, setPayload] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setFailureKey('private.inviteInvalid');
      setPhase('failed');
      return;
    }
    let cancelled = false;
    peekAlbumInvite(token)
      .then((result) => {
        if (cancelled) return;
        if (result.status === 'ok') {
          setPhase('ready');
        } else {
          setFailureKey(FAILURE_KEYS[result.status] ?? 'private.inviteError');
          setPhase('failed');
        }
      })
      .catch(() => !cancelled && setPhase('failed'));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const attemptRedeem = async (
    payloadValue: string,
    codeValue: string,
    albumIdValue: string,
    memberIdValue: string,
  ) => {
    if (!vaultKey) return false;
    setPhase('redeeming');
    setError(null);
    const result = await redeemAlbumInvite({
      payload: payloadValue,
      code: codeValue,
      albumId: albumIdValue,
      memberId: memberIdValue,
      vaultKey,
    });
    if (!result.ok) {
      setError(
        result.reason === 'unsupported-version'
          ? t('receive.errorVersion')
          : result.reason === 'malformed'
            ? t('receive.errorPayload')
            : t('receive.errorCode'),
      );
      setPhase('redeem');
      return false;
    }
    toast.success(t('private.acceptAlbumDone'));
    router.replace(`/private/albums/${albumIdValue}`);
    return true;
  };

  const join = async () => {
    if (!token) return;
    setPhase('joining');
    try {
      const result = await acceptAlbumInvite(token);
      if (result.status !== 'ok' && result.status !== 'already_member') {
        setFailureKey(FAILURE_KEYS[result.status] ?? 'private.inviteError');
        setPhase('failed');
        return;
      }
      setAlbumId(result.albumId);
      setMemberId(result.memberId);
      setPhase('redeem');
    } catch {
      setFailureKey('private.inviteError');
      setPhase('failed');
    }
  };

  const redeem = async () => {
    if (!albumId || !memberId) return;
    await attemptRedeem(payload, code, albumId, memberId);
  };

  if (space !== 'real') {
    return (
      <PrivateScreen moduleId="shared-albums" title={t('private.acceptAlbumTitle')} tint={c.accent}>
        <Text variant="muted">{t('private.albumsRealSpaceOnly')}</Text>
      </PrivateScreen>
    );
  }

  if (phase === 'failed') {
    return (
      <PrivateScreen moduleId="shared-albums" title={t('private.acceptAlbumTitle')} tint={c.accent}>
        <Text variant="muted">{t(failureKey)}</Text>
      </PrivateScreen>
    );
  }

  if (phase === 'loading') {
    return (
      <PrivateScreen moduleId="shared-albums" title={t('private.acceptAlbumTitle')} tint={c.accent}>
        {null}
      </PrivateScreen>
    );
  }

  if (phase === 'ready' || phase === 'joining') {
    return (
      <PrivateScreen
        moduleId="shared-albums"
        title={t('private.acceptAlbumTitle')}
        tint={c.accent}
        footer={
          <Button
            variant="accent"
            size="lg"
            label={phase === 'joining' ? t('common.saving') : t('private.acceptAlbumFinish')}
            disabled={phase === 'joining'}
            onPress={() => void join()}
          />
        }
      >
        <Text variant="muted">{t('private.acceptAlbumManualIntro')}</Text>
      </PrivateScreen>
    );
  }

  return (
    <PrivateScreen
      moduleId="shared-albums"
      title={t('private.acceptAlbumTitle')}
      tint={c.accent}
      footer={
        <Button
          variant="accent"
          size="lg"
          label={phase === 'redeeming' ? t('receive.checking') : t('private.acceptAlbumFinish')}
          disabled={phase === 'redeeming' || payload.trim().length === 0 || code.trim().length < 8}
          onPress={() => void redeem()}
        />
      }
    >
      <ScrollView contentContainerClassName="gap-6 pb-6" showsVerticalScrollIndicator={false}>
        <Text variant="muted">{t('private.acceptAlbumManualIntro')}</Text>

        {error ? (
          <Text variant="caption" className="text-destructive">
            {error}
          </Text>
        ) : null}

        <View className="gap-3">
          <Text variant="micro">{t('receive.stepPayload')}</Text>
          <TextInput
            value={payload}
            onChangeText={setPayload}
            accessibilityLabel={t('receive.stepPayload')}
            placeholder={t('receive.payloadPlaceholder')}
            placeholderTextColor={c.mutedForeground}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            className={cardClass({ padding: 'none' }, 'px-4 py-3 text-foreground')}
            style={{ minHeight: 90, fontFamily: 'Sora_400Regular', fontSize: 13 }}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => void Clipboard.getStringAsync().then((text) => setPayload(text ?? ''))}
            className="flex-row items-center justify-center gap-2 rounded-full border py-3"
            style={{ borderColor: c.border }}
          >
            <ClipboardPaste size={15} color={c.foreground} />
            <Text className="font-sora-medium" style={{ color: c.foreground }}>
              {t('receive.paste')}
            </Text>
          </Pressable>
        </View>

        <View className="gap-3">
          <Text variant="micro">{t('receive.stepCode')}</Text>
          <Text variant="caption">{t('receive.codeHint')}</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            accessibilityLabel={t('receive.stepCode')}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            placeholderTextColor={c.mutedForeground}
            autoCapitalize="characters"
            autoCorrect={false}
            className={cardClass({ padding: 'none' }, 'px-4 py-4 text-foreground')}
            style={{ fontFamily: 'Sora_500Medium', fontSize: 17, letterSpacing: 1.5 }}
          />
        </View>
      </ScrollView>
    </PrivateScreen>
  );
}
