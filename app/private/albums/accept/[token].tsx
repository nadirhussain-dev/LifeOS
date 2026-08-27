import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { ClipboardPaste } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useAuthStore } from '@/features/auth/services/auth-store';
import {
  acceptAlbumInvite,
  peekAlbumInvite,
  redeemAlbumInvite,
  type RedeemAlbumKeyResult,
} from '@/features/private/services/album-invite';
import { PrivateScreen } from '@/features/private/components/private-screen';
import { usePrivateStore } from '@/features/private/store/private-store';
import { useTheme } from '@/hooks/use-theme';
import { toast } from '@/lib/toast-store';

/**
 * The target of `daykeep://private/albums/accept/<token>` — the Postgres
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
 *
 * That local-vault gate is a separate axis from having a Supabase account,
 * though: a guest can set up a fully local private space with no sign-in at
 * all, follow this link, and reach `join()` — which calls
 * `accept_album_invitation`, granted to `authenticated` only (migration
 * 0027). `peek_album_invitation` is granted to `anon` too, so the status
 * check above always works; only the join step needs an account, so that's
 * the one branch that checks `session` and offers sign-in instead of letting
 * the mutation fail server-side. Same shape as `app/join/[token].tsx`'s
 * split-invite screen.
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
  const session = useAuthStore((s) => s.session);

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
    let result: RedeemAlbumKeyResult;
    try {
      result = await redeemAlbumInvite({
        payload: payloadValue,
        code: codeValue,
        albumId: albumIdValue,
        memberId: memberIdValue,
        vaultKey,
      });
    } catch {
      // The key may already be stored locally even if the server-side
      // confirm_album_key call above failed (network drop, etc.) — that call
      // is only a UX hint, never a gate (see album-invite.ts's header), so
      // this is safe to retry rather than treat as fatal.
      setError(t('receive.errorCode'));
      setPhase('redeem');
      return false;
    }
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
    // The token stays valid either way (see this screen's header) — it isn't
    // consumed by peeking, so returning here after signing in resumes the
    // same invitation.
    if (!session) {
      return (
        <PrivateScreen
          moduleId="shared-albums"
          title={t('private.acceptAlbumTitle')}
          tint={c.accent}
          footer={
            <Button
              variant="accent"
              size="lg"
              label={t('sync.signInCreate')}
              onPress={() => router.push('/(auth)/login')}
            />
          }
        >
          <Text variant="muted">{t('private.acceptAlbumNeedsAccount')}</Text>
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
          <Input
            value={payload}
            onChangeText={setPayload}
            accessibilityLabel={t('receive.stepPayload')}
            placeholder={t('receive.payloadPlaceholder')}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            surface="card"
            cardPadding="none"
            className="px-4 py-3"
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
          <Input
            value={code}
            onChangeText={setCode}
            accessibilityLabel={t('receive.stepCode')}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            autoCapitalize="characters"
            autoCorrect={false}
            surface="card"
            cardPadding="none"
            className="px-4 py-4"
            style={{ fontFamily: 'Sora_500Medium', fontSize: 17, letterSpacing: 1.5 }}
          />
        </View>
      </ScrollView>
    </PrivateScreen>
  );
}
