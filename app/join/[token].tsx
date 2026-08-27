import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { CircleCheck, TriangleAlert, Users } from '@/components/ui/icons';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { moduleTint, colors as dsColors } from '@/constants/design-tokens';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { acceptInvitation, peekInvitation } from '@/features/split/services/split-repository';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Invitation landing screen — the target of `daykeep://join/<token>` and of the
 * https link in the invitation email.
 *
 * The token is the whole authority here, so the screen shows as little as
 * possible before sign-in: `peek_group_invitation` returns the group's name and
 * a status, never its contents. An invalid token and an expired one look the
 * same from outside, which is deliberate.
 */
export default function JoinGroupScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const tint = moduleTint('budget', scheme);
  const session = useAuthStore((s) => s.session);

  const [groupName, setGroupName] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('loading');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      return;
    }
    let cancelled = false;
    peekInvitation(token)
      .then((result) => {
        if (cancelled) return;
        setGroupName(result.groupName);
        setStatus(result.status);
      })
      .catch(() => !cancelled && setStatus('invalid'));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const join = async () => {
    if (!token) return;
    setJoining(true);
    try {
      const result = await acceptInvitation(token);
      if (result === 'ok' || result === 'already_member') {
        // Straight into the group — the point of following the link.
        router.replace('/split');
        return;
      }
      setStatus(result);
    } catch {
      setStatus('error');
    } finally {
      setJoining(false);
    }
  };

  // `blocked` (0021): you blocked whoever sent this. The token is deliberately
  // NOT consumed by that refusal, so unblocking and following the link again
  // still works — which is why the copy names the way back rather than reading
  // as a dead link.
  const failed = [
    'invalid',
    'expired',
    'already_accepted',
    'member_unavailable',
    'blocked',
    'error',
  ].includes(status);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={t('split.joinTitle')} eyebrow={t('split.title')} tint={tint} />

      <View className="flex-1 items-center justify-center gap-5 px-8">
        {status === 'loading' ? (
          <Skeleton className="h-24 w-full rounded-2xl" />
        ) : failed ? (
          <>
            <View className="h-16 w-16 items-center justify-center rounded-2xl bg-surface">
              <TriangleAlert size={28} color={dsColors[scheme].warning} />
            </View>
            <View className="items-center gap-1">
              <Text variant="heading">{t('split.joinFailedTitle')}</Text>
              <Text variant="muted" className="text-center">
                {t(`split.joinStatus.${status}`)}
              </Text>
            </View>
            <Button
              label={t('split.backToGroups')}
              variant="secondary"
              onPress={() => router.replace('/split')}
            />
          </>
        ) : (
          <>
            <View
              className="h-16 w-16 items-center justify-center rounded-2xl"
              style={{ backgroundColor: `${tint}1f` }}
            >
              {session ? <Users size={28} color={tint} /> : <CircleCheck size={28} color={tint} />}
            </View>
            <View className="items-center gap-1">
              <Text variant="heading" className="text-center">
                {groupName ?? t('split.aGroup')}
              </Text>
              <Text variant="muted" className="text-center">
                {session ? t('split.joinBody') : t('split.joinNeedsAccount')}
              </Text>
            </View>

            {session ? (
              <Button
                label={joining ? t('common.saving') : t('split.joinGroup')}
                variant="accent"
                size="lg"
                disabled={joining}
                onPress={() => void join()}
                className="w-full"
              />
            ) : (
              // The token stays in the URL, so returning here after sign-in
              // resumes the same invitation.
              <Button
                label={t('sync.signInCreate')}
                variant="accent"
                size="lg"
                onPress={() => router.push('/(auth)/login')}
                className="w-full"
              />
            )}
          </>
        )}
      </View>
    </View>
  );
}
