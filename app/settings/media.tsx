import { CloudUpload, HardDrive, Wifi } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Switch, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { cachedBytes, clearMediaCache } from '@/features/media-sync/services/media-cache';
import {
  countPendingMedia,
  refreshMediaUsage,
} from '@/features/media-sync/services/media-uploader';
import { useMediaSyncStore } from '@/features/media-sync/store/media-sync-store';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/dialog-store';

/**
 * Backing up the files themselves.
 *
 * Separate from Sync & Account because it is a materially different decision:
 * everything on that screen is text measured in kilobytes, and this is somebody's
 * photo library. It is off by default, it says what it will cost against the
 * quota, and it says plainly which parts of the app it does not cover.
 */
export default function MediaSettingsScreen() {
  const { t } = useTranslation();
  const { c } = useTheme();

  const session = useAuthStore((s) => s.session);
  const enabled = useMediaSyncStore((s) => s.enabled);
  const setEnabled = useMediaSyncStore((s) => s.setEnabled);
  const wifiOnly = useMediaSyncStore((s) => s.wifiOnly);
  const setWifiOnly = useMediaSyncStore((s) => s.setWifiOnly);
  const usage = useMediaSyncStore((s) => s.usage);
  const lastError = useMediaSyncStore((s) => s.lastError);

  const [pending, setPending] = useState(0);
  const [cached, setCached] = useState(0);

  useEffect(() => {
    setPending(countPendingMedia());
    setCached(cachedBytes());
    if (session) void refreshMediaUsage();
  }, [session, enabled]);

  const used = usage?.usedBytes ?? 0;
  const quota = usage?.quotaBytes ?? 0;
  const fraction = quota > 0 ? Math.min(1, used / quota) : 0;

  const handleClear = () =>
    void confirm({
      title: t('media.clearCacheTitle'),
      message: t('media.clearCacheBody'),
      confirmLabel: t('media.clearCache'),
      cancelLabel: t('common.cancel'),
    }).then((ok) => {
      if (!ok) return;
      clearMediaCache();
      setCached(0);
    });

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={t('media.title')} eyebrow={t('settings.syncAccount')} tint={c.accent} />

      <ScrollView
        contentContainerClassName="gap-6 px-5 pt-3 pb-10"
        showsVerticalScrollIndicator={false}
      >
        {/* Guests have nowhere to upload to. Saying so beats a switch that
            silently does nothing. */}
        {!session ? (
          <View className={cardClass({ padding: 'md' }, 'gap-2')}>
            <Text className="font-sora-medium text-foreground">{t('media.needsAccount')}</Text>
            <Text variant="caption">{t('media.needsAccountBody')}</Text>
          </View>
        ) : null}

        <View className={cardClass({ padding: 'md' }, 'gap-3')}>
          <View className="flex-row items-center gap-3">
            <CloudUpload size={18} color={c.accent} />
            <View className="flex-1">
              <Text className="font-sora-medium text-foreground">{t('media.backUpFiles')}</Text>
              <Text variant="caption">{t('media.backUpFilesHint')}</Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={setEnabled}
              disabled={!session}
              trackColor={{ true: c.accent, false: c.border }}
            />
          </View>

          {enabled ? (
            <View className="flex-row items-center gap-3 border-t border-border pt-3">
              <Wifi size={18} color={c.mutedForeground} />
              <View className="flex-1">
                <Text className="font-sora-medium text-foreground">{t('media.wifiOnly')}</Text>
                <Text variant="caption">{t('media.wifiOnlyHint')}</Text>
              </View>
              <Switch
                value={wifiOnly}
                onValueChange={setWifiOnly}
                trackColor={{ true: c.accent, false: c.border }}
              />
            </View>
          ) : null}
        </View>

        {enabled && usage ? (
          <View className={cardClass({ padding: 'md' }, 'gap-2')}>
            <Text variant="micro">{t('media.storageUsed')}</Text>
            <ProgressBar progress={fraction} color={fraction > 0.9 ? c.error : c.accent} />
            <Text variant="caption">
              {t('media.usageOf', { used: formatBytes(used), quota: formatBytes(quota) })}
            </Text>
            {pending > 0 ? (
              <Text variant="caption">{t('media.pendingCount', { count: pending })}</Text>
            ) : null}
            {lastError === 'quota' ? (
              <Text variant="caption" className="text-destructive">
                {t('media.quotaReached')}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View className={cardClass({ padding: 'md' }, 'gap-3')}>
          <View className="flex-row items-center gap-3">
            <HardDrive size={18} color={c.mutedForeground} />
            <View className="flex-1">
              <Text className="font-sora-medium text-foreground">{t('media.downloadedFiles')}</Text>
              <Text variant="caption">
                {t('media.downloadedFilesHint', { size: formatBytes(cached) })}
              </Text>
            </View>
          </View>
          <Button
            variant="secondary"
            label={t('media.clearCache')}
            disabled={cached === 0}
            onPress={handleClear}
          />
        </View>

        {/*
          The limits, said here rather than discovered. The private space is the
          one that matters: somebody who turns this on and assumes it covers
          everything would be wrong about the only part they would most mind
          being wrong about.
        */}
        <Text variant="caption">{t('media.limitsNote')}</Text>
      </ScrollView>
    </View>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
