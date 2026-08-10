import { useRouter } from 'expo-router';
import {
  Briefcase,
  CloudOff,
  Home,
  Plane,
  Shapes,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { cardClass } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Fab } from '@/components/ui/fab';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { colors as dsColors, moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { formatMoney } from '@/features/budget/services/money';
import { MemberAvatars } from '@/features/split/components/member-avatars';
import { useGroupSummaries, type GroupSummary } from '@/features/split/hooks/use-split';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { isSupabaseConfigured } from '@/lib/env';
import { alpha } from '@/lib/color';

const KIND_ICONS: Record<string, LucideIcon> = {
  trip: Plane,
  home: Home,
  family: Users,
  work: Briefcase,
  other: Shapes,
};

/**
 * Split groups. Requires an account: the whole point is shared data, and there
 * is nobody to share with in guest mode.
 *
 * Each row answers the question the screen exists for — whether you are up or
 * down in that group — instead of making you open all of them to find out.
 */
export default function SplitGroupsScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const session = useAuthStore((s) => s.session);
  const reducedMotion = useReducedMotion();
  const tint = moduleTint('budget', scheme);
  const [refreshing, setRefreshing] = useState(false);

  const enabled = !!session && isSupabaseConfigured;
  const { summaries, isLoading, isError, error, refetch } = useGroupSummaries({ enabled });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const header = <ScreenHeader title={t('split.title')} eyebrow={t('split.eyebrow')} tint={tint} />;

  // A build with no Supabase credentials cannot do this at all. Saying so is
  // more use than letting every request fail at the socket and reporting it as
  // a connection problem the user is expected to fix.
  if (!isSupabaseConfigured) {
    return (
      <View className="flex-1 bg-background">
        {header}
        <EmptyState
          icon={CloudOff}
          title={t('split.notConfiguredTitle')}
          description={t('errors.not-configured')}
          tint={tint}
        />
      </View>
    );
  }

  if (!session) {
    return (
      <View className="flex-1 bg-background">
        {header}
        <EmptyState
          icon={Users}
          title={t('split.signInTitle')}
          description={t('split.signInBody')}
          tint={tint}
          actionLabel={t('sync.signInCreate')}
          onAction={() => router.push('/(auth)/login')}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {header}

      {isError ? (
        <QueryError
          error={error}
          onRetry={() => refetch()}
          action={{ label: t('sync.signInCreate'), onPress: () => router.push('/(auth)/login') }}
        />
      ) : isLoading ? (
        <View className="gap-3 px-5 pt-2">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </View>
      ) : summaries.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('split.emptyTitle')}
          description={t('split.emptyBody')}
          tint={tint}
          actionLabel={t('split.newGroup')}
          onAction={() => router.push('/split/new')}
        />
      ) : (
        <ScrollView
          contentContainerClassName="gap-2.5 px-5 pb-28 pt-1"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors[scheme].mutedForeground}
              colors={[tint]}
            />
          }
        >
          {summaries.map((summary, index) => (
            <Animated.View
              key={summary.group.id}
              entering={reducedMotion ? undefined : FadeInDown.delay(index * 40).duration(260)}
            >
              <GroupCard
                summary={summary}
                onPress={() => router.push(`/split/${summary.group.id}`)}
              />
            </Animated.View>
          ))}
        </ScrollView>
      )}

      <Fab onPress={() => router.push('/split/new')} accessibilityLabel={t('split.newGroup')} />
    </View>
  );
}

function GroupCard({ summary, onPress }: { summary: GroupSummary; onPress: () => void }) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const tint = moduleTint('budget', scheme);
  const c = dsColors[scheme];
  const { group, netCents, memberCount, memberNames, expenseCount } = summary;
  const Icon = KIND_ICONS[group.kind] ?? Shapes;

  const settled = netCents === null || netCents === 0;
  const owed = (netCents ?? 0) > 0;
  const amountColor = settled ? c.mutedForeground : owed ? c.success : c.error;
  const statusLabel = settled
    ? t('split.allSquare')
    : owed
      ? t('split.youAreOwed')
      : t('split.youOwe');

  // One sentence for a screen reader instead of six disconnected fragments.
  const a11yLabel = settled
    ? `${group.name}. ${t('split.membersCount', { count: memberCount })}. ${t('split.allSquare')}`
    : `${group.name}. ${t('split.membersCount', { count: memberCount })}. ${statusLabel} ${formatMoney(Math.abs(netCents ?? 0), group.currency)}`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      className={cardClass({ padding: 'md' }, 'gap-3 active:opacity-80')}
    >
      <View className="flex-row items-center gap-3">
        <View
          className="h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: alpha(tint, 0.12) }}
        >
          <Icon size={19} color={tint} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="font-sora-semibold text-foreground" numberOfLines={1}>
            {group.name}
          </Text>
          <Text variant="caption">
            {t('split.kind.' + group.kind)} · {t('split.membersCount', { count: memberCount })}
          </Text>
        </View>
        <View className="items-end gap-0.5">
          <Text className="font-sora-bold text-base" style={{ color: amountColor }}>
            {settled ? t('split.settled') : formatMoney(Math.abs(netCents ?? 0), group.currency)}
          </Text>
          {!settled ? <Text variant="caption">{statusLabel}</Text> : null}
        </View>
      </View>

      {memberNames.length > 0 || expenseCount > 0 ? (
        <View className="flex-row items-center justify-between">
          <MemberAvatars names={memberNames} total={memberCount} />
          <Text variant="caption">{t('split.expenseCount', { count: expenseCount })}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
