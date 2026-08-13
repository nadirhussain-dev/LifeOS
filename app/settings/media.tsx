import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Check, CloudUpload, HardDrive, Sparkles, Smartphone, Wifi, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Switch, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { ProgressRing } from '@/components/ui/progress-ring';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { formatPrice, periodI18nKey, type StoragePlan } from '@/features/billing/config/plans';
import {
  useCancelSubscriptionMutation,
  useCreateCheckoutMutation,
  useMySubscription,
  usePendingRenewalConfirmation,
  usePlan,
  usePlans,
} from '@/features/billing/hooks/use-billing';
import { cachedBytes, clearMediaCache } from '@/features/media-sync/services/media-cache';
import {
  countPendingMedia,
  refreshMediaUsage,
} from '@/features/media-sync/services/media-uploader';
import { useMediaSyncStore } from '@/features/media-sync/store/media-sync-store';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';
import { confirm, notify } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

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
  const { planId, isPlus } = usePlan();
  const { data: plans = [] } = usePlans();
  const { data: subscription = null } = useMySubscription();
  const needsRenewalConfirmation = usePendingRenewalConfirmation(subscription);
  const checkout = useCreateCheckoutMutation();
  const cancelSubscription = useCancelSubscriptionMutation();
  const [couponCode, setCouponCode] = useState('');

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

  /**
   * The server refuses this outright for a free account (0035's
   * `enforce_media_quota` — "media backup requires a paid plan"), not just
   * quota-limits it. The switch reflects that instead of letting someone
   * turn it on and find out from a failed upload later.
   */
  const toggleBackup = (next: boolean) => {
    if (next && !isPlus) {
      // The plan cards are already on this same screen, just below — this
      // is a one-button notice, not a confirm with somewhere else to send
      // them.
      void notify({
        title: t('media.backupUpsellTitle'),
        message: t('media.backupUpsellBody'),
        confirmLabel: t('common.ok'),
      });
      return;
    }
    setEnabled(next);
  };

  /**
   * A real Safepay checkout, opened the same way Google sign-in already is
   * (`features/auth/services/oauth.ts`) — `WebBrowser.openAuthSessionAsync`
   * against the `lifeos` scheme, no new native config needed. The plan does
   * NOT change here: this only starts a subscription, `safepay-webhook`
   * confirms it, and `useBillingSync`'s foreground refresh (already running
   * at the root) picks that up once the browser sheet closes.
   */
  const choosePlan = (plan: StoragePlan) => {
    if (!session || plan.id === planId || checkout.isPending) return;

    if (plan.period === 'free') {
      if (!isPlus) return;
      void confirm({
        title: t('billing.cancelTitle'),
        message: t('billing.cancelBody'),
        confirmLabel: t('billing.cancelAction'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      }).then((ok) => {
        if (!ok) return;
        cancelSubscription.mutate(undefined, {
          onSuccess: () => toast.success(t('billing.cancelRequested')),
          onError: () => toast.error(t('errors.unknown')),
        });
      });
      return;
    }

    // Safepay has no "modify an active subscription" call — only fixed-price
    // Plans and a fresh checkout (safepay.ts's own header). A plan already
    // active going straight into a second checkout would leave the FIRST
    // Safepay subscription running untouched: `subscriptions.user_id` is
    // this app's own primary key, so the new subscription.created webhook
    // just upserts over the row and this app loses track of the old
    // safepay_subscription_id — but Safepay itself was never told to stop
    // billing it. That is a silent second recurring charge with no way back
    // into the app to find or cancel it. So a plan-to-plan switch has to go
    // through Free first: cancel, let that webhook land, then subscribe to
    // the new plan from a clean slate.
    if (isPlus) {
      void notify({
        title: t('billing.switchPlanTitle'),
        message: t('billing.switchPlanBody'),
        confirmLabel: t('common.ok'),
      });
      return;
    }

    void confirm({
      title: t('billing.confirmTitle'),
      message: t('billing.confirmBody'),
      confirmLabel: t('billing.confirmAction'),
      cancelLabel: t('common.cancel'),
    }).then((ok) => {
      if (!ok) return;
      checkout.mutate(
        { plan, couponCode },
        {
          onSuccess: async (url) => {
            const result = await WebBrowser.openAuthSessionAsync(
              url,
              Linking.createURL('/billing/callback'),
            );
            if (result.type === 'success') toast.success(t('billing.checkoutProcessing'));
          },
          onError: (error) =>
            toast.error(error instanceof Error ? error.message : t('errors.unknown')),
        },
      );
    });
  };

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
              <Text variant="caption">
                {isPlus ? t('media.backUpFilesHint') : t('media.backUpFilesPlusOnly')}
              </Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={toggleBackup}
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

        {/*
          Shown for any signed-in account with a reading, not only once
          personal file backup is switched on — `media_bytes_used()` bills
          shared-album photos against this same quota (0037's own header),
          which every plan can use regardless of this screen's toggle. Gating
          the ring on `enabled` used to mean a free account actively filling
          up their shared-album allowance had no way to see it happening.
        */}
        {session && usage ? (
          <View className={cardClass({ padding: 'md' }, 'items-center gap-3')}>
            <Text variant="micro" className="self-start">
              {t('media.storageUsed')}
            </Text>
            <ProgressRing
              progress={fraction}
              size={140}
              strokeWidth={12}
              color={fraction > 0.9 ? c.error : c.accent}
              gradient
            >
              <View className="items-center">
                <Text className="font-sora-extrabold text-3xl" style={{ color: c.foreground }}>
                  {Math.round(fraction * 100)}%
                </Text>
                <Text variant="caption">{t('media.storageUsedLabel')}</Text>
              </View>
            </ProgressRing>
            <Text className="font-sora-medium text-foreground">
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

        {/*
          Stated plainly, not just implied by a switch that doesn't move:
          everything that ISN'T a photo/video/audio file — habits, tasks,
          journal, budget, your profile picture — keeps syncing free,
          forever, on every plan. Media backup is the one thing that costs
          real, unbounded money per account, and it's the one thing gated.
        */}
        <View className={cardClass({ padding: 'md' }, 'gap-2')}>
          <View className="flex-row items-center gap-2">
            <Smartphone size={16} color={c.mutedForeground} />
            <Text variant="micro">{t('media.alwaysFreeTitle')}</Text>
          </View>
          <Text variant="caption">{t('media.alwaysFreeBody')}</Text>
        </View>

        {/*
          Real billing (0047/0048): choosing a paid plan opens a Safepay
          checkout, choosing Free while already on a paid plan cancels the
          live subscription. Neither branch of `choosePlan` changes `planId`
          directly — see its own header for why.
        */}
        {needsRenewalConfirmation ? (
          <View className={cardClass({ padding: 'md' }, 'gap-2')} style={{ borderColor: c.accent }}>
            <Text className="font-sora-medium text-foreground">{t('billing.renewalTitle')}</Text>
            <Text variant="caption">{t('billing.renewalBody')}</Text>
            <Button
              label={t('billing.renewalAction')}
              disabled={checkout.isPending}
              onPress={() => {
                const plan = plans.find((p) => p.id === subscription?.planId);
                if (plan) choosePlan(plan);
              }}
            />
          </View>
        ) : null}

        <View className={cardClass({ padding: 'md' }, 'gap-3')}>
          <View className="flex-row items-center gap-2">
            <Sparkles size={16} color={c.accent} />
            <Text variant="micro">{t('billing.plans')}</Text>
          </View>

          {!isPlus ? (
            <TextInput
              value={couponCode}
              onChangeText={setCouponCode}
              placeholder={t('billing.couponPlaceholder')}
              placeholderTextColor={c.mutedForeground}
              autoCapitalize="characters"
              autoCorrect={false}
              className={cardClass({ padding: 'none' }, 'px-4 py-3 text-foreground')}
              style={{ fontFamily: 'Sora_400Regular' }}
            />
          ) : null}

          <View className="gap-2">
            {plans.map((plan) => {
              const active = plan.id === planId;
              return (
                <Pressable
                  key={plan.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active, disabled: !session }}
                  disabled={!session || checkout.isPending || cancelSubscription.isPending}
                  onPress={() => choosePlan(plan)}
                  className="flex-row items-center gap-3 rounded-2xl border px-4 py-3"
                  style={{
                    borderColor: active ? c.accent : c.border,
                    backgroundColor: active ? alpha(c.accent, 0.08) : 'transparent',
                    opacity: !session ? 0.5 : 1,
                  }}
                >
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="font-sora-medium text-foreground">
                        {formatBytes(plan.storageBytes)}
                      </Text>
                      {plan.badge ? (
                        <View
                          className="rounded-full px-2 py-0.5"
                          style={{ backgroundColor: alpha(c.accent, 0.16) }}
                        >
                          <Text
                            variant="caption"
                            className="font-sora-semibold"
                            style={{ color: c.accent }}
                          >
                            {plan.badge === 'best_value' ? t('billing.bestValue') : plan.badge}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text variant="caption">
                      {formatPrice(plan.priceCents, plan.currency)} {t(periodI18nKey(plan.period))}
                    </Text>
                  </View>
                  {active ? <Check size={18} color={c.accent} /> : null}
                </Pressable>
              );
            })}
          </View>

          {/* What each tier actually means, in plain bullets — static copy,
              not database-driven: this is marketing text about the two
              tiers, not another storage/price field on billing_plans. */}
          <View className="gap-1.5 border-t border-border pt-3">
            <PerkRow icon={X} label={t('billing.perkFreeAds')} muted />
            <PerkRow icon={X} label={t('billing.perkFreeLocalOnly')} muted />
            <PerkRow icon={Check} label={t('billing.perkPlusNoAds')} />
            <PerkRow icon={Check} label={t('billing.perkPlusBackup')} />
            <PerkRow icon={Check} label={t('billing.perkPlusAlbums')} />
            <PerkRow icon={Check} label={t('billing.perkPlusInsights')} />
          </View>

          {isPlus && subscription?.currentPeriodEnd ? (
            <View className="gap-2 border-t border-border pt-3">
              <Text variant="caption">
                {t('billing.renewsOn', {
                  date: new Date(subscription.currentPeriodEnd).toLocaleDateString(),
                })}
              </Text>
              {subscription.status !== 'cancelled' ? (
                <Button
                  variant="secondary"
                  label={t('billing.cancelAction')}
                  disabled={cancelSubscription.isPending}
                  onPress={() =>
                    void confirm({
                      title: t('billing.cancelTitle'),
                      message: t('billing.cancelBody'),
                      confirmLabel: t('billing.cancelAction'),
                      cancelLabel: t('common.cancel'),
                      destructive: true,
                    }).then((ok) => {
                      if (!ok) return;
                      cancelSubscription.mutate(undefined, {
                        onSuccess: () => toast.success(t('billing.cancelRequested')),
                        onError: () => toast.error(t('errors.unknown')),
                      });
                    })
                  }
                />
              ) : null}
            </View>
          ) : (
            <Text variant="caption">{t('billing.chargedNote')}</Text>
          )}
        </View>

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

function PerkRow({
  icon: Icon,
  label,
  muted,
}: {
  icon: typeof Check;
  label: string;
  muted?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View className="flex-row items-center gap-2">
      <Icon size={14} color={muted ? c.mutedForeground : c.accent} />
      <Text variant="caption" style={muted ? undefined : { color: c.foreground }}>
        {label}
      </Text>
    </View>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
