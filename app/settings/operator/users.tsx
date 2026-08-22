import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { Input } from '@/components/ui/input';
import { ScreenHeader } from '@/components/ui/screen-header';
import { cardClass } from '@/components/ui/card';
import { QueryError } from '@/components/ui/query-error';
import { Text } from '@/components/ui/text';
import { listUsers, type UserDirectoryRow } from '@/features/operator/services/operator-repository';
import { useTheme } from '@/hooks/use-theme';

/**
 * The full account directory.
 *
 * `operator.tsx`'s report queue only ever points at an account somebody has
 * already reported — until now that was the *only* way into `account.tsx`.
 * This is the other way in, for "manage status/plan/module flags for any
 * user", not just a reported one.
 *
 * Not gated client-side beyond simply being reachable from the console:
 * `admin_list_users` (0012) is admin-tier only and checks that itself. A
 * staff-tier operator who taps this row gets the RPC's own refusal, rendered
 * below the same way the console's own report queue renders "no access" —
 * one rule, not a client-side copy of it that could disagree.
 */
export default function OperatorUsersScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { c } = useTheme();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  const users = useQuery({
    queryKey: ['operator', 'users', debounced],
    queryFn: () => listUsers(debounced),
  });

  const openAccount = (row: UserDirectoryRow) =>
    router.push({
      pathname: '/settings/operator/account',
      params: { userId: row.userId, label: row.displayName ?? row.username ?? '' },
    });

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        eyebrow={t('operator.eyebrow')}
        title={t('operator.accountsTitle')}
        subtitle={t('operator.accountsSubtitle')}
        tint={c.error}
      />

      <View className="px-5 pb-3">
        <View className={cardClass({ padding: 'none' }, 'flex-row items-center gap-2 px-4 py-3')}>
          <Search size={16} color={c.mutedForeground} />
          <Input
            surface="bare"
            value={query}
            onChangeText={setQuery}
            placeholder={t('operator.accountsSearchPlaceholder')}
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-1 text-foreground"
            style={{ fontFamily: 'Sora_400Regular' }}
          />
        </View>
      </View>

      <ScrollView contentContainerClassName="gap-6 px-5 pb-10" showsVerticalScrollIndicator={false}>
        {users.data && !users.data.ok ? (
          <View className={cardClass({ padding: 'md' }, 'gap-2')}>
            <Text className="font-sora-medium text-foreground">{t('operator.noAccess')}</Text>
            <Text variant="caption">{users.data.error}</Text>
          </View>
        ) : users.isError ? (
          // Previously fell through to "no accounts", which describes a
          // healthy empty directory rather than a request that never landed.
          <QueryError error={users.error} onRetry={() => void users.refetch()} />
        ) : users.isLoading ? (
          <Text variant="muted">{t('common.loadingEllipsis')}</Text>
        ) : (users.data?.data ?? []).length === 0 ? (
          <Text variant="muted">{t('operator.accountsEmpty')}</Text>
        ) : (
          <View className={cardClass({ padding: 'none' }, 'px-4')}>
            {(users.data?.data ?? []).map((row, index) => (
              <Pressable
                key={row.userId}
                accessibilityRole="button"
                onPress={() => openAccount(row)}
                className={
                  index === 0
                    ? 'flex-row items-center gap-3 py-3.5'
                    : 'flex-row items-center gap-3 border-t border-border py-3.5'
                }
              >
                <View className="flex-1">
                  <Text className="font-sora-medium text-foreground" numberOfLines={1}>
                    {row.displayName ?? row.username ?? row.email ?? row.userId}
                  </Text>
                  <Text variant="caption" numberOfLines={1}>
                    {row.email ?? row.userId}
                    {row.status !== 'active' ? ` · ${row.status}` : ''}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
