import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'expo-router';
import { CreditCard, ShieldAlert, ToggleLeft, UsersRound, Users } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Switch, TextInput, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { HUB_SECTIONS } from '@/features/hub/config/modules';
import { useModuleFlagsStore } from '@/features/module-flags/store/module-flags-store';
import {
  fetchReportQueue,
  isOwner,
  setModuleEnabled,
  type ReportQueueEntry,
} from '@/features/operator/services/operator-repository';
import { refreshModuleFlags } from '@/features/module-flags/services/module-flags';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

/**
 * The operator console.
 *
 * Everything here was already callable — from the SQL editor, at 3am, by
 * somebody typing a uuid by hand. That is fine for one owner and poor for
 * anybody working a queue, which is what this replaces.
 *
 * It is deliberately a **view over the RPCs and not a second permission
 * system**. The report gate, the admin/staff split, the origin allowlist and
 * every audit row live in the database. A console that enforced its own rules
 * would be a console anybody could bypass with `curl`, and two sets of rules
 * that have to agree eventually do not.
 *
 * It shows nothing at all to an account without operator access — not an empty
 * queue, not a permission error at the top of a working screen. The row into it
 * is hidden for the same reason.
 */
export default function OperatorConsoleScreen() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [owner, setOwner] = useState(false);

  useEffect(() => {
    void isOwner().then(setOwner);
  }, []);

  const queue = useQuery({
    queryKey: ['operator', 'queue'],
    // Wrapped rather than passed directly: react-query hands the query function
    // a context object, which would land in `limit`.
    queryFn: () => fetchReportQueue(),
  });

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={t('operator.title')} eyebrow={t('operator.eyebrow')} tint={c.error} />

      <ScrollView
        contentContainerClassName="gap-6 px-5 pt-3 pb-10"
        showsVerticalScrollIndicator={false}
      >
        {queue.isError ? (
          <QueryError onRetry={() => void queue.refetch()} />
        ) : queue.data && !queue.data.ok ? (
          <View className={cardClass({ padding: 'md' }, 'gap-2')}>
            <Text className="font-sora-medium text-foreground">{t('operator.noAccess')}</Text>
            <Text variant="caption">{queue.data.error}</Text>
          </View>
        ) : (
          <>
            <View className="gap-2">
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/settings/operator/pricing')}
                className={cardClass({ padding: 'rowLg' }, 'flex-row items-center gap-3')}
              >
                <CreditCard size={18} color={c.mutedForeground} />
                <Text className="flex-1 font-sora-medium text-foreground">
                  {t('billing.plans')}
                </Text>
              </Pressable>
              {/* Owner-only, on purpose — see roster.tsx's header. Any other
                  operator never learns this row exists, same discipline the
                  console itself applies to accounts with no operator access
                  at all. */}
              {owner ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/settings/operator/roster')}
                  className={cardClass({ padding: 'rowLg' }, 'flex-row items-center gap-3')}
                >
                  <UsersRound size={18} color={c.mutedForeground} />
                  <Text className="flex-1 font-sora-medium text-foreground">
                    {t('operator.operatorsTitle')}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            <ReportQueue
              entries={queue.data?.ok ? queue.data.data : []}
              loading={queue.isLoading}
              onOpen={(entry) =>
                router.push({
                  pathname: '/settings/operator/account',
                  params: {
                    userId: entry.reportedUserId,
                    label: entry.displayName ?? entry.username ?? '',
                  },
                })
              }
            />
            <ModuleSwitches
              onChanged={() => {
                void refreshModuleFlags();
                void queryClient.invalidateQueries({ queryKey: ['operator'] });
              }}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * Accounts with open reports, worst first.
 *
 * The one screen TODO.md said should be built before any other operator UI, and
 * the reason is the ordering: the RPC returns them by open-report count so the
 * queue is already triaged, which is the difference between a moderator working
 * a list and a moderator reading a table.
 */
function ReportQueue({
  entries,
  loading,
  onOpen,
}: {
  entries: ReportQueueEntry[];
  loading: boolean;
  onOpen: (entry: ReportQueueEntry) => void;
}) {
  const { t } = useTranslation();
  const { c } = useTheme();

  if (loading) return <Text variant="muted">{t('common.loadingEllipsis')}</Text>;

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={t('operator.queueEmptyTitle')}
        description={t('operator.queueEmptyBody')}
      />
    );
  }

  return (
    <View className="gap-3">
      <Text variant="micro">{t('operator.reportQueue')}</Text>
      {entries.map((entry) => (
        <Pressable
          key={entry.reportedUserId}
          accessibilityRole="button"
          onPress={() => onOpen(entry)}
          className={cardClass({ elevation: 'e1' }, 'gap-2')}
        >
          <View className="flex-row items-center gap-2">
            <ShieldAlert size={16} color={c.error} />
            <Text className="flex-1 font-sora-semibold text-foreground" numberOfLines={1}>
              {entry.displayName ?? entry.username ?? entry.reportedUserId}
            </Text>
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: `${c.error}1f` }}>
              <Text variant="caption" style={{ color: c.error }}>
                {entry.openReports}
              </Text>
            </View>
          </View>
          {entry.latestReason ? (
            <Text variant="caption" numberOfLines={2}>
              {entry.latestReason}
            </Text>
          ) : null}
          {entry.latestAt ? (
            <Text variant="caption">
              {formatDistanceToNow(new Date(entry.latestAt), { addSuffix: true })}
            </Text>
          ) : null}
          {/* The uuid, selectable — tapping the row now opens the account
              (account.tsx), this is just the value the reports RPC needs
              underneath, kept visible for anyone still working from it
              directly. */}
          <Text variant="caption" selectable style={{ fontSize: 10.5 }}>
            {entry.reportedUserId}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * The global module switches, which were `select admin_set_module_enabled(...)`
 * in an editor until now.
 *
 * Turning one off takes a feature away from every user at once, so it asks
 * first and it asks for the message those users will see — the field exists in
 * 0011 and was routinely left null, which is how somebody ends up staring at a
 * module that has silently vanished.
 */
function ModuleSwitches({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const flags = useModuleFlagsStore((s) => s.flags);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const modules = HUB_SECTIONS.flatMap((section) => section.modules);

  const toggle = async (moduleId: string, next: boolean) => {
    if (!next) {
      const ok = await confirm({
        title: t('operator.disableTitle'),
        message: t('operator.disableBody'),
        confirmLabel: t('operator.disableConfirm'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(moduleId);
    const result = await setModuleEnabled(moduleId, next, next ? null : message.trim() || null);
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setMessage('');
    onChanged();
  };

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2">
        <ToggleLeft size={16} color={c.mutedForeground} />
        <Text variant="micro">{t('operator.moduleSwitches')}</Text>
      </View>

      <TextInput
        value={message}
        onChangeText={setMessage}
        placeholder={t('operator.messagePlaceholder')}
        placeholderTextColor={c.mutedForeground}
        className={cardClass({ padding: 'none' }, 'px-4 py-3 text-foreground')}
        style={{ fontFamily: 'Sora_400Regular' }}
      />
      <Text variant="caption" className="px-1">
        {t('operator.messageHint')}
      </Text>

      <View className={cardClass({ padding: 'none' }, 'px-4')}>
        {modules.map((module, index) => {
          const enabled = flags[module.id]?.enabled !== false;
          return (
            <View
              key={module.id}
              className={
                index === 0
                  ? 'flex-row items-center gap-3 py-3.5'
                  : 'flex-row items-center gap-3 border-t border-border py-3.5'
              }
            >
              <View className="flex-1">
                <Text className="font-sora-medium text-foreground">{t(module.titleKey)}</Text>
                {flags[module.id]?.message ? (
                  <Text variant="caption">{flags[module.id]?.message}</Text>
                ) : null}
              </View>
              <Switch
                value={enabled}
                disabled={busy === module.id}
                onValueChange={(next) => void toggle(module.id, next)}
                trackColor={{ true: c.accent, false: c.border }}
              />
            </View>
          );
        })}
      </View>

      {/* Per-account overrides (0024) live on the account's own page
          (account.tsx, reached from a report-queue row), not here — they need
          an account to point at, and that screen is what a uuid field bolted
          to this global list used to stand in for. */}
      <Text variant="caption" className="px-1">
        {t('operator.perUserNote')}
      </Text>
    </View>
  );
}
