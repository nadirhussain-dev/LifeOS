import { useLocalSearchParams } from 'expo-router';
import { CheckCircle2, ShieldAlert, ShieldX, XCircle } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { Input } from '@/components/ui/input';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { HUB_SECTIONS } from '@/features/hub/config/modules';
import {
  clearUserModule,
  fetchUserDetail,
  fetchUserReports,
  resolveReport,
  setAccountStatus,
  setUserModule,
  type OperatorReport,
  type UserDetail,
} from '@/features/operator/services/operator-repository';
import {
  PRIVATE_MODULES,
  PRIVATE_SPACE_SWITCH,
} from '@/features/private/config/private-modules';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

// Hub modules plus private-space modules (Cycle, Vault, …) — module_flags
// (0011_module_flags.sql) was always designed to key on either id, but until
// now this list only ever offered the Hub half, so an operator had no way to
// target `cycle`/`recovery`/`vault`/`intimacy`/`shared-albums` at all.
//
// `PRIVATE_SPACE_SWITCH` is the door those five sit behind, and per-account is
// where it earns its keep: 0024's staged-rollout case is exactly "open this
// for one account while it stays shut for everybody else", and without the
// umbrella an operator could only have granted the rooms — inside a space the
// global flag still refuses to open.
const MODULES: { id: string; titleKey: string }[] = [
  ...HUB_SECTIONS.flatMap((section) => section.modules),
  PRIVATE_SPACE_SWITCH,
  ...PRIVATE_MODULES,
];

/**
 * One account, as far as the operator console goes: what a report says,
 * what its standing is, and a per-account module override — the three
 * things `app/settings/operator.tsx`'s own comments named as "the next
 * screen this console wants" rather than a uuid field bolted to a list.
 *
 * Nothing here is a new privilege. Every action was already a callable RPC
 * (`admin_resolve_report`, `admin_set_account_status`,
 * `admin_set_user_module` / `_clear_`) — this is the account-shaped view
 * over them the report queue always meant to grow into.
 */
export default function OperatorAccountScreen() {
  const { userId, label } = useLocalSearchParams<{ userId: string; label?: string }>();
  const { t } = useTranslation();
  const { c } = useTheme();

  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [reports, setReports] = useState<OperatorReport[]>([]);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    if (!userId || reason.trim().length < 8) return;
    setLoading(true);
    const [detailResult, reportsResult] = await Promise.all([
      fetchUserDetail(userId),
      fetchUserReports(userId, reason.trim()),
    ]);
    setLoading(false);
    setLoaded(true);
    // Staff can see reports without full detail (0012's admin_user_detail is
    // admin-tier only) — surfacing that gap rather than treating it as a
    // failure of the whole screen.
    setDetail(detailResult.ok ? detailResult.data : null);
    setDetailError(detailResult.ok ? null : detailResult.error);
    setReports(reportsResult.ok ? reportsResult.data : []);
    if (!reportsResult.ok) toast.error(reportsResult.error);
  };

  const doResolve = async (report: OperatorReport, status: 'actioned' | 'dismissed') => {
    setBusy(report.id);
    const result = await resolveReport(report.id, status, reason.trim());
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t(`operator.resolved_${status}`));
    setReports((prev) => prev.map((r) => (r.id === report.id ? { ...r, status } : r)));
  };

  const doSetStatus = (status: 'active' | 'restricted' | 'blocked') =>
    void confirm({
      title: t(`operator.setStatus_${status}Title`),
      message: t('operator.setStatusBody'),
      confirmLabel: t(`operator.setStatus_${status}Confirm`),
      cancelLabel: t('common.cancel'),
      destructive: status !== 'active',
    }).then(async (ok) => {
      if (!ok || !userId) return;
      setBusy(status);
      const result = await setAccountStatus(userId, status, reason.trim(), null);
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t('operator.statusUpdated'));
      setDetail((d) => (d ? { ...d, status } : d));
    });

  const doModule = async (moduleId: string, action: 'enable' | 'disable' | 'clear') => {
    if (!userId) return;
    setBusy(`${moduleId}:${action}`);
    const result =
      action === 'clear'
        ? await clearUserModule(userId, moduleId)
        : await setUserModule(userId, moduleId, action === 'enable', reason.trim() || null);
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t('operator.moduleOverrideSaved'));
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        eyebrow={t('operator.eyebrow')}
        title={detail?.displayName ?? detail?.username ?? label ?? userId}
        subtitle={userId}
        tint={c.error}
      />

      <ScrollView contentContainerClassName="gap-6 px-5 pb-10" showsVerticalScrollIndicator={false}>
        <View className="gap-2">
          <Text variant="micro">{t('operator.reasonLabel')}</Text>
          <Input
            value={reason}
            onChangeText={setReason}
            placeholder={t('operator.reasonPlaceholder')}
            multiline
            style={{ fontFamily: 'Sora_400Regular', minHeight: 52 }}
          />
          <Text variant="caption">{t('operator.reasonHint')}</Text>
          <Button
            label={loading ? t('common.loadingEllipsis') : t('operator.loadAccount')}
            onPress={() => void load()}
            disabled={reason.trim().length < 8 || loading}
          />
        </View>

        {loaded ? (
          <>
            {detail ? (
              <View className={cardClass({ padding: 'md' }, 'gap-2')}>
                <Text variant="micro">{t('operator.currentStanding')}</Text>
                <Text className="font-sora-semibold text-foreground">{detail.status}</Text>
                {detail.statusReason ? <Text variant="caption">{detail.statusReason}</Text> : null}
                {detail.statusAuto ? (
                  <Text variant="caption">{t('operator.automaticRule')}</Text>
                ) : null}
              </View>
            ) : detailError ? (
              <Text variant="caption">{detailError}</Text>
            ) : null}

            <View className="gap-2">
              <Text variant="micro">{t('operator.setStandingTitle')}</Text>
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Button
                    variant="secondary"
                    label={t('operator.statusActive')}
                    disabled={busy !== null}
                    onPress={() => doSetStatus('active')}
                  />
                </View>
                <View className="flex-1">
                  <Button
                    variant="secondary"
                    label={t('operator.statusRestricted')}
                    disabled={busy !== null}
                    onPress={() => doSetStatus('restricted')}
                  />
                </View>
                <View className="flex-1">
                  <Button
                    variant="destructive"
                    label={t('operator.statusBlocked')}
                    disabled={busy !== null}
                    onPress={() => doSetStatus('blocked')}
                  />
                </View>
              </View>
            </View>

            <View className="gap-3">
              <Text variant="micro">{t('operator.reportsForAccount')}</Text>
              {reports.length === 0 ? (
                <Text variant="muted">{t('operator.noReportsForAccount')}</Text>
              ) : (
                reports.map((report) => (
                  <View key={report.id} className={cardClass({ padding: 'md' }, 'gap-2')}>
                    <View className="flex-row items-center gap-2">
                      <ShieldAlert size={15} color={c.error} />
                      <Text className="flex-1 font-sora-medium text-foreground">
                        {report.surface} · {report.reason}
                      </Text>
                    </View>
                    {report.note ? <Text variant="caption">{report.note}</Text> : null}
                    <Text variant="caption">{report.status}</Text>
                    {report.status === 'open' ? (
                      <View className="flex-row gap-2">
                        <View className="flex-1">
                          <Button
                            variant="secondary"
                            label={t('operator.dismiss')}
                            disabled={busy !== null}
                            onPress={() => void doResolve(report, 'dismissed')}
                          />
                        </View>
                        <View className="flex-1">
                          <Button
                            variant="destructive"
                            label={t('operator.action')}
                            disabled={busy !== null}
                            onPress={() => void doResolve(report, 'actioned')}
                          />
                        </View>
                      </View>
                    ) : null}
                  </View>
                ))
              )}
            </View>

            <View className="gap-3">
              <Text variant="micro">{t('operator.moduleOverrideTitle')}</Text>
              <Text variant="caption">{t('operator.moduleOverrideHint')}</Text>
              <View className={cardClass({ padding: 'none' }, 'px-4')}>
                {MODULES.map((module, index) => (
                  <View
                    key={module.id}
                    className={index === 0 ? 'gap-2 py-3.5' : 'gap-2 border-t border-border py-3.5'}
                  >
                    <Text className="font-sora-medium text-foreground">{t(module.titleKey)}</Text>
                    <View className="flex-row gap-2">
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy !== null}
                        onPress={() => void doModule(module.id, 'enable')}
                        className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-border py-2"
                      >
                        <CheckCircle2 size={14} color={c.success} />
                        <Text variant="caption">{t('operator.forceOn')}</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy !== null}
                        onPress={() => void doModule(module.id, 'disable')}
                        className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-border py-2"
                      >
                        <XCircle size={14} color={c.error} />
                        <Text variant="caption">{t('operator.forceOff')}</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy !== null}
                        onPress={() => void doModule(module.id, 'clear')}
                        className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-border py-2"
                      >
                        <ShieldX size={14} color={c.mutedForeground} />
                        <Text variant="caption">{t('operator.useDefault')}</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
