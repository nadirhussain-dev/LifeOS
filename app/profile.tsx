import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Camera, LogOut, ShieldCheck, Trash2, UserCircle } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { moduleTints } from '@/constants/design-tokens';
import { SettingsRow } from '@/components/ui/settings-row';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { useAccountStanding } from '@/features/moderation/hooks/use-account-standing';
import {
  avatarUrl,
  initialsFor,
  pickAndUploadAvatar,
  removeAvatar,
} from '@/features/profile/services/avatar';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { confirm } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

/**
 * The account's own profile.
 *
 * A screen rather than a sixth tab: the bottom bar deliberately carries four
 * daily drivers plus the Hub launcher (see features/hub/config/modules.ts), and
 * a profile is somewhere you go occasionally, not somewhere you live. It is
 * reachable from the Hub header and from Settings.
 *
 * Guests get the sign-in pitch instead — there is no profile without an
 * account, and pretending otherwise means an avatar that syncs nowhere.
 */
export default function ProfileScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();

  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const updateDisplayName = useAuthStore((s) => s.updateDisplayName);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const signOut = useAuthStore((s) => s.signOut);
  const { status } = useAccountStanding();

  const [name, setName] = useState(profile?.displayName ?? '');
  const [busy, setBusy] = useState(false);

  const url = avatarUrl(profile?.avatarPath ?? null, profile?.avatarUpdatedAt ?? null);
  const initials = initialsFor(profile?.displayName ?? null, profile?.email ?? null);

  const changeAvatar = async () => {
    setBusy(true);
    const result = await pickAndUploadAvatar();
    if (result.ok) await refreshProfile();
    else if (result.error === 'upload-failed') {
      toast.error(t('profile.avatarFailedBody'));
    }
    setBusy(false);
  };

  const clearAvatar = () =>
    void confirm({
      title: t('profile.removePhoto'),
      message: t('profile.removePhotoBody'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      void (async () => {
        setBusy(true);
        if (await removeAvatar()) await refreshProfile();
        setBusy(false);
      })();
    });

  const saveName = async () => {
    if (!name.trim() || name.trim() === profile?.displayName) return;
    setBusy(true);
    await updateDisplayName(name);
    setBusy(false);
  };

  if (!session) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader
          title={t('profile.title')}
          eyebrow={t('settings.eyebrow')}
          tint={moduleTints.settings}
        />
        <View className="flex-1 items-center justify-center gap-5 px-8">
          <View className="h-20 w-20 items-center justify-center rounded-3xl bg-surface">
            <UserCircle size={36} color={theme.mutedForeground} strokeWidth={1.6} />
          </View>
          <View className="items-center gap-2">
            <Text variant="subheading">{t('profile.guestTitle')}</Text>
            <Text variant="muted" className="text-center">
              {t('profile.guestBody')}
            </Text>
          </View>
          <Button
            variant="accent"
            size="lg"
            label={t('sync.signInCreate')}
            onPress={() => router.push('/(auth)/login')}
          />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('profile.title')}
        eyebrow={t('settings.eyebrow')}
        tint={moduleTints.settings}
      />
      <ScrollView
        contentContainerClassName="gap-6 px-5 py-4 pb-12"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="items-center gap-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('profile.changePhoto')}
            onPress={() => void changeAvatar()}
            disabled={busy}
            className="h-28 w-28 items-center justify-center overflow-hidden rounded-full"
            style={{ backgroundColor: alpha(theme.accent, 0.14), opacity: busy ? 0.6 : 1 }}
          >
            {url ? (
              <Image
                source={{ uri: url }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
              />
            ) : (
              // Initials rather than a generic silhouette: a profile without a
              // picture should still read as a person.
              <Text className="font-sora-extrabold text-3xl" style={{ color: theme.accent }}>
                {initials}
              </Text>
            )}
          </Pressable>

          <View className="flex-row items-center gap-3">
            <Pressable
              accessibilityRole="button"
              onPress={() => void changeAvatar()}
              disabled={busy}
              className="flex-row items-center gap-1.5"
            >
              <Camera size={15} color={theme.accent} />
              <Text className="font-sora-medium text-sm" style={{ color: theme.accent }}>
                {t('profile.changePhoto')}
              </Text>
            </Pressable>
            {profile?.avatarPath ? (
              <Pressable accessibilityRole="button" onPress={clearAvatar} disabled={busy}>
                <Text variant="caption">{t('profile.removePhoto')}</Text>
              </Pressable>
            ) : null}
          </View>

          {/* Says out loud that this one thing is public, because everything
              else in the app is emphatically not. */}
          <Text variant="caption" className="text-center">
            {t('profile.photoVisibility')}
          </Text>
        </View>

        <View className="gap-2">
          <Text variant="micro">{t('profile.displayName')}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            onBlur={() => void saveName()}
            placeholder={t('onboarding.yourName')}
            placeholderTextColor={theme.mutedForeground}
            className={cardClass({ padding: 'rowLg' }, 'text-foreground')}
            style={{ fontFamily: 'Sora_400Regular' }}
          />
        </View>

        <View className="gap-2">
          <Text variant="micro">{t('profile.account')}</Text>
          <View className={cardClass({ padding: 'none' }, 'px-4')}>
            <SettingsRow
              icon={UserCircle}
              label={t('profile.username')}
              value={profile?.username ? `@${profile.username}` : t('profile.noUsername')}
              isFirst
              chevron={false}
            />
            <SettingsRow
              icon={UserCircle}
              label={t('profile.email')}
              value={profile?.email ?? '—'}
              chevron={false}
            />
            <SettingsRow
              icon={ShieldCheck}
              label={t('profile.standing')}
              value={t(`profile.standing_${status}`)}
              chevron={false}
            />
          </View>
        </View>

        <View className="gap-2">
          <Text variant="micro">{t('settings.privacy')}</Text>
          <View className={cardClass({ padding: 'none' }, 'px-4')}>
            <SettingsRow
              icon={ShieldCheck}
              label={t('sync.title')}
              subtitle={t('settings.syncAccountSubtitle')}
              isFirst
              onPress={() => router.push('/settings/sync')}
            />
            <SettingsRow
              icon={LogOut}
              label={t('sync.signOut')}
              chevron={false}
              onPress={() =>
                void confirm({
                  title: t('sync.signOutTitle'),
                  message: t('sync.signOutBody'),
                  confirmLabel: t('sync.signOut'),
                  cancelLabel: t('common.cancel'),
                }).then(async (ok) => {
                  if (!ok) return;
                  void signOut();
                })
              }
            />
            <SettingsRow
              icon={Trash2}
              label={t('sync.deleteAccount')}
              destructive
              chevron={false}
              onPress={() => router.push('/settings/sync')}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
