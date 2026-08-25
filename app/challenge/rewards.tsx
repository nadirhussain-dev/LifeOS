import { Trophy } from 'lucide-react-native';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import {
  useChallengeTiers,
  useChallengeToday,
  useSeasonStatus,
} from '@/features/challenge/hooks/use-challenge';
import type { ChallengeTier } from '@/features/challenge/types/challenge.types';
import { CosmeticRow } from '@/features/rewards/components/cosmetic-row';
import { RewardBadgeTile } from '@/features/rewards/components/reward-badge';
import {
  useOwnedCosmetics,
  useRewards,
  useSyncRewards,
} from '@/features/rewards/hooks/use-rewards';
import { equippedOwned, useCosmeticsStore } from '@/features/rewards/store/cosmetics-store';
import type { CosmeticKind } from '@/features/rewards/types/rewards.types';
import { useTheme } from '@/hooks/use-theme';

/**
 * The trophy case.
 *
 * Two halves, and the order between them is the design. **What you have** comes
 * first, because that is what somebody opening this screen came to look at. But
 * **what is next** is on the same screen rather than a tab away, because the
 * single strongest argument for climbing another sixty days is the picture of
 * the badge sitting at the top of them — no sentence does that job as well as
 * the silhouette of the thing does.
 *
 * A locked rung is drawn, not hidden. Hiding it makes the ladder a list of
 * numbers again.
 *
 * ## No `AdSlot` here either
 *
 * Same rule as the challenge screen, and for a stronger reason: this is the
 * screen where somebody looks at what their commitment bought them, and an ad
 * next to it is the app answering "what did I get for this" with "an
 * advertisement". `AD_FREE_SEGMENTS` already covers the whole `challenge`
 * segment for full-screen ads; this note is for banners, which are placed by
 * hand and so are prevented by not writing the call site.
 */
export default function ChallengeRewardsScreen() {
  const { t } = useTranslation();
  const { c, tint } = useTheme();

  const rewards = useRewards();
  const owned = useOwnedCosmetics();
  const sync = useSyncRewards();
  const today = useChallengeToday();
  const season = useSeasonStatus();

  const equipped = useCosmeticsStore((s) => s.equipped);
  const equip = useCosmeticsStore((s) => s.equip);

  const seasonId =
    today.data?.seasonId ?? today.data?.finishedRun?.seasonId ?? season.data?.seasonId;
  const tiers = useChallengeTiers(seasonId);
  const qualifiedDays = today.data?.qualifiedDays ?? 0;

  /**
   * Reconciles on open, once.
   *
   * The screen where a missing badge is visible is the right place to ask for
   * one, and asking is nearly free — see `sync_my_challenge_rewards`. Fired
   * once per mount rather than on a focus effect: a user flicking back and
   * forth is not new information, and the answer cannot change while they are
   * looking at it.
   */
  const runSync = sync.mutate;
  useEffect(() => {
    runSync();
  }, [runSync]);

  /** Every cosmetic the ladder pays, in rung order, with whether it is held. */
  const ladder = useMemo(() => {
    const ordered = [...(tiers.data ?? [])].sort((a, b) => a.dayThreshold - b.dayThreshold);
    return ordered.map((tier: ChallengeTier) => ({
      tier,
      badges: (tier.rewards ?? [])
        .filter((r) => r.kind === 'badge' && r.slug)
        .map((r) => r.slug as string),
      climbed: tier.dayThreshold <= qualifiedDays,
    }));
  }, [tiers.data, qualifiedDays]);

  /** The premium windows this account was paid, newest first. */
  const premiumWins = useMemo(
    () => (rewards.data ?? []).filter((r) => r.kind === 'premium'),
    [rewards.data],
  );

  const section = (kind: CosmeticKind, list: string[]) => {
    if (list.length === 0) return null;
    const worn = equippedOwned(equipped, kind, list);

    return (
      <View key={kind} className={cardClass({ padding: 'md' }, 'gap-2')}>
        <Text variant="micro">{t(`rewards.section.${kind}`)}</Text>
        {list.map((name) => (
          <CosmeticRow
            key={name}
            kind={kind}
            name={name}
            equipped={worn === name}
            // Tapping the worn one takes it off. See `cosmetic-row.tsx` for
            // why there is no separate remove control.
            onPress={() => equip(kind, worn === name ? null : name)}
          />
        ))}
      </View>
    );
  };

  const body = () => {
    if (rewards.isError) return <QueryError onRetry={() => void rewards.refetch()} />;

    if (rewards.isLoading || tiers.isLoading) {
      return (
        <View className="gap-3">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </View>
      );
    }

    return (
      <View className="gap-3">
        {/* The shelf. Every badge the ladder holds, earned ones in their own
            colours and the rest as silhouettes — one picture that says both
            what you have and what the climb is for. */}
        <View className={cardClass({ padding: 'md' }, 'gap-3')}>
          <Text variant="micro">{t('rewards.badgesTitle')}</Text>

          {ladder.length === 0 ? (
            <Text variant="caption">{t('rewards.noLadder')}</Text>
          ) : (
            <View className="flex-row flex-wrap gap-y-4">
              {ladder.flatMap(({ tier, badges, climbed }) =>
                badges.map((badge) => {
                  const held = owned.badge.includes(badge);
                  return (
                    <RewardBadgeTile
                      key={`${tier.dayThreshold}-${badge}`}
                      name={badge}
                      label={held ? tier.name : t('rewards.lockedAt', { count: tier.dayThreshold })}
                      locked={!held}
                      lockedGround={c.surface}
                      lockedInk={c.border}
                      labelColor={held ? undefined : c.mutedForeground}
                    />
                  );
                }),
              )}
            </View>
          )}

          {/* One honest line about what is missing, rather than silence. A
              locked grid with no explanation reads as a bug on an account that
              has earned nothing at all. */}
          {!owned.any ? <Text variant="caption">{t('rewards.emptyHint')}</Text> : null}

          {ladder.some(
            ({ climbed, badges }) => climbed && badges.some((b) => !owned.badge.includes(b)),
          ) ? (
            // Passed the rung, does not hold the badge. The resync above is
            // already trying to fix it; saying so is better than a tile that
            // silently disagrees with the ladder next to it.
            <Text variant="caption" style={{ color: c.warning }}>
              {t('rewards.catchingUp')}
            </Text>
          ) : null}
        </View>

        {section('theme', owned.theme)}
        {section('chain', owned.chain)}
        {section('frame', owned.frame)}

        {/* Premium windows are not wearable and have no tile — they show up as
            the account being Premium, which is the whole point of them. Listed
            anyway so the payout is visible somewhere: a reward nobody can find
            a record of is a reward people are not sure they received. */}
        {premiumWins.length > 0 ? (
          <View className={cardClass({ padding: 'md' }, 'gap-2')}>
            <Text variant="micro">{t('rewards.section.premium')}</Text>
            {premiumWins.map((win) => (
              <Text key={win.slug} variant="caption">
                {t('rewards.premiumWon', {
                  count: Number(win.detail?.days ?? 0),
                  day: win.tierDay ?? 0,
                })}
              </Text>
            ))}
          </View>
        ) : null}

        {!owned.any && premiumWins.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title={t('rewards.emptyTitle')}
            description={t('rewards.emptyBody')}
            tint={tint('habit')}
          />
        ) : null}
      </View>
    );
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('rewards.title')}
        eyebrow={t('challenge.eyebrow')}
        tint={tint('habit')}
      />
      <ScrollView
        contentContainerClassName="gap-3 px-5 pt-3 pb-10"
        showsVerticalScrollIndicator={false}
      >
        {body()}
      </ScrollView>
    </View>
  );
}
