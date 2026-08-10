import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  CheckCircle2,
  CloudUpload,
  CloudOff,
  GitMerge,
  LogOut,
  Trash2,
  TriangleAlert,
  UserCircle,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Switch, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { moduleTints } from '@/constants/design-tokens';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useUsageStore } from '@/features/analytics/store/usage-store';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { SYNC_MODULES } from '@/features/sync/config/sync-tables';
import { useSyncStatus } from '@/features/sync/hooks/use-sync';
import { useOpenConflictCount } from '@/features/sync/hooks/use-sync-conflicts';
import { syncNow } from '@/features/sync/services/sync-engine';
import { useSyncStore } from '@/features/sync/store/sync-store';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { envDiagnostics, isSupabaseConfigured } from '@/lib/env';
import { confirm } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

function SectionLabel({ children }: { children: string }) {
  return (
    <Text variant="caption" className="px-1 font-sora-semibold uppercase tracking-wide">
      {children}
    </Text>
  );
}

export default function SyncSettingsScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const theme = colors[scheme];

  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);

  const { status, lastSyncedAt, lastError } = useSyncStatus();
  const conflictCount = useOpenConflictCount();
  const autoSync = useSyncStore((s) => s.autoSync);
  const setAutoSync = useSyncStore((s) => s.setAutoSync);
  const modules = useSyncStore((s) => s.modules);
  const setModuleEnabled = useSyncStore((s) => s.setModuleEnabled);
  const usageEnabled = useUsageStore((s) => s.enabled);
  const setUsageEnabled = useUsageStore((s) => s.setEnabled);

  // Guest: no account — invite sign-in, explain data stays local.
  if (!session) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader
          title={t('sync.title')}
          eyebrow={t('sync.eyebrow')}
          tint={moduleTints.settings}
        />
        <ScrollView
          contentContainerClassName="gap-6 px-5 py-4 pb-12"
          showsVerticalScrollIndicator={false}
        >
          <View className={cardClass({ padding: 'none' }, 'items-center gap-3 p-6')}>
            <View
              className="h-14 w-14 items-center justify-center rounded-2xl"
              style={{ backgroundColor: theme.muted }}
            >
              <CloudOff size={26} color={theme.mutedForeground} />
            </View>
            <Text className="font-sora-semibold text-lg text-foreground">
              {t('sync.guestTitle')}
            </Text>
            <Text variant="muted" className="text-center">
              {t('sync.guestBody')}
            </Text>
            <Button
              label={t('sync.signInCreate')}
              variant="accent"
              size="lg"
              className="w-full"
              onPress={() => router.push('/(auth)/login')}
            />
          </View>

          {/* A build with no Supabase credentials can only ever be a guest, and
              until now said nothing about why — signing in simply failed. This
              names the missing variables and where each value came from, so an
              EAS credential problem is diagnosable from the phone rather than by
              rebuilding blind. */}
          {!isSupabaseConfigured && (
            <View className="gap-2">
              <SectionLabel>{t('sync.buildConfig')}</SectionLabel>
              <View className={cardClass({ padding: 'md' }, 'gap-2')}>
                <View className="flex-row items-center gap-2">
                  <TriangleAlert size={16} color={theme.destructive} />
                  <Text className="font-sora-semibold text-foreground">
                    {t('sync.notConfiguredTitle')}
                  </Text>
                </View>
                <Text variant="caption">{t('sync.notConfiguredBody')}</Text>
                <View className="gap-1 pt-1">
                  {envDiagnostics().entries.map((entry) => (
                    <View key={entry.key} className="flex-row items-center justify-between gap-3">
                      <Text variant="caption" className="flex-1 font-sora-medium" numberOfLines={1}>
                        {entry.key.replace('EXPO_PUBLIC_', '')}
                      </Text>
                      <Text
                        variant="caption"
                        style={{ color: entry.present ? theme.success : theme.destructive }}
                      >
                        {entry.present ? entry.preview : t('sync.envMissing')}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  const handleSyncNow = () => {
    Haptics.selectionAsync();
    // Forced: somebody who just pressed the button gets a request even if the
    // throttle or the post-failure backoff would have skipped this one.
    void syncNow({ force: true });
  };

  const handleSignOut = () => {
    void confirm({
      title: t('sync.signOutTitle'),
      message: t('sync.signOutBody'),
      confirmLabel: t('sync.signOut'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      void signOut();
    });
  };

  const handleDeleteAccount = () => {
    void confirm({
      title: t('sync.deleteAccountTitle'),
      message: t('sync.deleteAccountBody'),
      confirmLabel: t('sync.deleteAccount'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      const result = await deleteAccount();
      if (!result.ok) toast.error(result.error);
    });
  };

  const syncedLabel =
    status === 'syncing'
      ? t('sync.syncing')
      : status === 'error'
        ? (lastError ?? t('sync.syncFailed'))
        : lastSyncedAt
          ? t('sync.lastSynced', {
              time: formatDistanceToNow(lastSyncedAt, { addSuffix: true }),
            })
          : t('sync.notSyncedYet');

  const StatusIcon = status === 'error' ? TriangleAlert : CheckCircle2;
  const statusColor = status === 'error' ? theme.destructive : theme.accent;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('sync.title')}
        eyebrow={t('sync.eyebrow')}
        tint={moduleTints.settings}
      />
      <ScrollView
        contentContainerClassName="gap-6 px-5 py-4 pb-12"
        showsVerticalScrollIndicator={false}
      >
        {/* Account */}
        <View className="gap-2">
          <SectionLabel>{t('sync.account')}</SectionLabel>
          <View className={cardClass({ padding: 'md' }, 'flex-row items-center gap-3')}>
            <View
              className="h-11 w-11 items-center justify-center rounded-full"
              style={{ backgroundColor: theme.muted }}
            >
              <UserCircle size={24} color={theme.accent} />
            </View>
            <View className="flex-1">
              <Text className="font-sora-semibold text-foreground">
                {profile?.displayName || t('sync.yourAccount')}
              </Text>
              <Text variant="caption">{profile?.email ?? session.user.email}</Text>
            </View>
          </View>
        </View>

        {/* Sync status */}
        <View className="gap-2">
          <SectionLabel>{t('sync.sync')}</SectionLabel>
          <View className={cardClass({ padding: 'md' }, 'gap-3')}>
            <View className="flex-row items-center gap-2">
              <StatusIcon size={16} color={statusColor} />
              <Text className="flex-1 font-sora-medium text-foreground">{syncedLabel}</Text>
            </View>
            <Button
              label={status === 'syncing' ? t('sync.syncing') : t('sync.syncNow')}
              variant="secondary"
              onPress={handleSyncNow}
              disabled={status === 'syncing'}
            />
            <View className="flex-row items-center justify-between border-t border-border pt-3">
              <View className="flex-1 pe-3">
                <Text className="font-sora-medium text-foreground">{t('sync.autoSync')}</Text>
                <Text variant="caption">{t('sync.autoSyncDescription')}</Text>
              </View>
              <Switch
                value={autoSync}
                onValueChange={setAutoSync}
                trackColor={{ true: theme.accent, false: theme.border }}
              />
            </View>
          </View>

          {/*
            Only when there is something to say. A permanent "0 conflicts" row
            would be noise on a screen that is already dense, and it would teach
            people to ignore the one place this ever matters.
          */}
          {/* Its own screen, because it is a materially different decision:
              everything else here is text measured in kilobytes, and that is
              somebody's photo library. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/settings/media')}
            className={cardClass({ padding: 'md' }, 'flex-row items-center gap-3')}
          >
            <CloudUpload size={18} color={theme.mutedForeground} />
            <View className="flex-1">
              <Text className="font-sora-medium text-foreground">{t('media.title')}</Text>
              <Text variant="caption">{t('media.rowHint')}</Text>
            </View>
          </Pressable>

          {conflictCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/settings/sync-conflicts')}
              className={cardClass({ padding: 'md' }, 'flex-row items-center gap-3')}
            >
              <GitMerge size={18} color={theme.warning} />
              <View className="flex-1">
                <Text className="font-sora-medium text-foreground">
                  {t('sync.conflictsRow', { count: conflictCount })}
                </Text>
                <Text variant="caption">{t('sync.conflictsRowHint')}</Text>
              </View>
            </Pressable>
          ) : null}
        </View>

        {/* What syncs */}
        <View className="gap-2">
          <SectionLabel>{t('sync.whatSyncs')}</SectionLabel>
          <View className={cardClass({ padding: 'none' }, 'px-4')}>
            {SYNC_MODULES.map((mod, index) => (
              <View
                key={mod.key}
                className={
                  index === 0
                    ? 'flex-row items-center gap-3 py-3.5'
                    : 'flex-row items-center gap-3 border-t border-border py-3.5'
                }
              >
                <View className="flex-1">
                  <Text className="font-sora-medium text-foreground">{t(mod.labelKey)}</Text>
                </View>
                <Switch
                  value={modules[mod.key] ?? false}
                  onValueChange={(v) => setModuleEnabled(mod.key, v)}
                  trackColor={{ true: theme.accent, false: theme.border }}
                />
              </View>
            ))}
          </View>
          <Text variant="caption" className="px-1">
            {t('sync.whatSyncsNote')}
          </Text>
          {/* Said plainly, because "Gallery: on" otherwise reads as a promise
              that the photos themselves are backed up. They are not. */}
          <Text variant="caption" className="px-1">
            {t('sync.mediaNote')}
          </Text>
        </View>

        {/* Usage statistics — disclosed and switchable, per PRIVACY.md */}
        <View className="gap-2">
          <SectionLabel>{t('usage.title')}</SectionLabel>
          <View className={cardClass({ padding: 'rowLg' })}>
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pe-3">
                <Text className="font-sora-medium text-foreground">{t('usage.title')}</Text>
                <Text variant="caption">{t('usage.description')}</Text>
              </View>
              <Switch
                value={usageEnabled}
                onValueChange={setUsageEnabled}
                trackColor={{ true: theme.accent, false: theme.border }}
              />
            </View>
          </View>
        </View>

        {/* Sign out */}
        <Pressable
          onPress={handleSignOut}
          className="flex-row items-center justify-center gap-2 rounded-2xl border border-border py-3.5"
          accessibilityRole="button"
        >
          <LogOut size={18} color={theme.destructive} />
          <Text className="font-sora-medium" style={{ color: theme.destructive }}>
            {t('sync.signOut')}
          </Text>
        </Pressable>

        {/* Delete account (App/Play store requirement for account-based apps) */}
        <Pressable
          onPress={handleDeleteAccount}
          className="flex-row items-center justify-center gap-2 py-2"
          accessibilityRole="button"
        >
          <Trash2 size={16} color={theme.mutedForeground} />
          <Text
            variant="caption"
            className="font-sora-medium"
            style={{ color: theme.mutedForeground }}
          >
            {t('sync.deleteAccount')}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
