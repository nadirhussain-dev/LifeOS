import { UserX } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useBlockedAccounts, useBlockMutations } from '@/features/moderation/hooks/use-blocks';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { errorKind } from '@/lib/supabase-error';
import { confirm } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

/**
 * The accounts you have blocked, and the way back.
 *
 * A block you cannot review is a block you cannot undo, and people do change
 * their minds — usually about somebody they have to keep splitting rent with.
 * Both stores also expect the list to exist: a block with no visible state is
 * indistinguishable from one that silently failed.
 *
 * There is deliberately no list of who blocked YOU. See the RLS policy in
 * migration 0021: being able to enumerate your blockers tells the one person
 * it should not exactly who to reach from a second account.
 */
export default function BlockedAccountsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();

  const query = useBlockedAccounts();
  const { unblock } = useBlockMutations();

  const confirmUnblock = (userId: string, label: string) =>
    void confirm({
      title: t('moderation.unblock'),
      message: t('moderation.blockedEmptyBody'),
      confirmLabel: t('moderation.unblock'),
      cancelLabel: t('common.cancel'),
    }).then(async (ok) => {
      if (!ok) return;
      unblock.mutate(userId, {
        onSuccess: (result) =>
          result.ok
            ? toast.success(t('moderation.unblocked', { name: label }))
            : toast.error(t('errors.unknown')),
        onError: (error) => toast.error(t(`errors.${errorKind(error)}`)),
      });
    });

  const accounts = query.data ?? [];

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={t('moderation.blockedAccounts')} />

      <ScrollView
        contentContainerClassName="gap-4 px-5 pt-3 pb-10"
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={theme.mutedForeground}
          />
        }
      >
        {query.isLoading ? (
          <View className="gap-2">
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
          </View>
        ) : query.isError ? (
          <QueryError error={query.error} onRetry={() => void query.refetch()} />
        ) : accounts.length === 0 ? (
          <EmptyState
            icon={UserX}
            title={t('moderation.blockedEmpty')}
            description={t('moderation.blockedEmptyBody')}
          />
        ) : (
          <View className={cardClass({ padding: 'none' }, 'px-4')}>
            {accounts.map((account, index) => {
              // Both may be null on an account that never set a name. A uuid is
              // not a label a person recognises, so fall back to prose.
              const label = account.displayName || account.username || t('moderation.someone');
              return (
                <View
                  key={account.userId}
                  className={
                    index === 0
                      ? 'flex-row items-center gap-3 py-3'
                      : 'flex-row items-center gap-3 border-t border-border py-3'
                  }
                >
                  <Text className="flex-1 font-sora-medium text-foreground" numberOfLines={1}>
                    {label}
                  </Text>
                  <Pressable
                    onPress={() => confirmUnblock(account.userId, label)}
                    hitSlop={8}
                    disabled={unblock.isPending}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: unblock.isPending }}
                    accessibilityLabel={`${t('moderation.unblock')}: ${label}`}
                    className="min-h-11 justify-center px-2"
                  >
                    <Text className="font-sora-medium" style={{ color: theme.primary }}>
                      {t('moderation.unblock')}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}

        {/* The limit, stated. A block stops future contact; it cannot unpick a
            group you are both already in without rewriting its ledger. */}
        <Text variant="caption">{t('moderation.blockBody')}</Text>
      </ScrollView>
    </View>
  );
}
