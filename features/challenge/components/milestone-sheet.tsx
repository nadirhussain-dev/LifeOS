import { useTranslation } from 'react-i18next';
import { Modal, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { CelebrationOverlay } from '@/components/ui/celebration-overlay';
import { Text } from '@/components/ui/text';
import type { ChallengeTier } from '@/features/challenge/types/challenge.types';
import { CHAINS, FRAMES, THEMES, parseSlug } from '@/features/rewards/config/catalog';
import { RewardBadge } from '@/features/rewards/components/reward-badge';
import { useTheme } from '@/hooks/use-theme';

/**
 * The payout, told properly.
 *
 * The mirror of the demotion sheet, and it exists for the same reason: the two
 * moments in this programme that are worth stopping somebody for are the day it
 * cost them something and the day it gave them something, and until now only
 * the first had a screen. Reaching Ember after thirty consecutive days produced
 * a three-second toast, which is roughly the acknowledgement an app gives for
 * copying a link.
 *
 * ## What it says, in order
 *
 * The **badge first, at size**. It is the thing that was earned and the only
 * part of the payout that is a picture; a list of sentences with a small icon
 * beside it is a receipt, and nobody frames a receipt. Then the rung's name,
 * then the day count that bought it, then each other effect as its own line
 * with its own swatch — a gradient shows the gradient, a chain shows its dots.
 *
 * A **premium** line is worded as a window with an end, never as a status. "A
 * week of Premium" is a true and pleasant sentence; "You're Premium now" is a
 * sentence somebody will still believe in a fortnight, and being quietly
 * demoted from something you were told you had is worse than never having been
 * given it.
 *
 * ## Two buttons, and share is the first
 *
 * The demotion sheet has one button because there is nothing to do with a loss.
 * There is something to do with this, and it is the single cheapest growth
 * mechanism the app has: a streak somebody has told other people about is a
 * streak that is much harder to abandon (REWARDS_STRATEGY §6). So sharing is
 * offered at the one moment there is something worth showing, rather than only
 * living behind a button on the screen underneath.
 */

type Props = {
  visible: boolean;
  /** The slugs the payout granted, as `challenge_events.detail.slugs` holds them. */
  slugs: string[];
  /** The run's ladder, for naming the rung the payout came from. */
  tiers: ChallengeTier[];
  /** Qualified days at the moment of the payout. */
  qualifiedDays: number;
  onShare: () => void;
  onDismiss: () => void;
};

export function MilestoneSheet({
  visible,
  slugs,
  tiers,
  qualifiedDays,
  onShare,
  onDismiss,
}: Props) {
  const { t } = useTranslation();
  const { c } = useTheme();

  const parsed = slugs
    .map(parseSlug)
    .filter((p): p is { kind: string; name: string } => p !== null);
  const badge = parsed.find((p) => p.kind === 'badge');

  /*
   * The rung this payout came from.
   *
   * Found by the badge rather than by the day count, because a payout can
   * settle arrears from rungs passed long ago and the highest rung crossed is
   * not necessarily the one that pays the badge in front of us. Falls back to
   * the highest rung standing under the day count, which is right whenever
   * there is no badge to go on.
   */
  const rung =
    tiers.find((tier) => tier.rewards.some((r) => r.kind === 'badge' && r.slug === badge?.name)) ??
    [...tiers]
      .sort((a, b) => b.dayThreshold - a.dayThreshold)
      .find((tier) => tier.dayThreshold <= qualifiedDays);

  /** One line per non-badge effect, each with the thing it actually is. */
  const lines = parsed.filter((p) => p.kind !== 'badge');

  const swatch = (kind: string, name: string) => {
    if (kind === 'theme' && THEMES[name]) {
      const art = THEMES[name];
      return (
        <View
          style={{
            flexDirection: 'row',
            width: 30,
            height: 12,
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          <View style={{ flex: 1, backgroundColor: art.from }} />
          <View style={{ flex: 1, backgroundColor: art.to }} />
        </View>
      );
    }
    if (kind === 'chain' && CHAINS[name]) {
      const art = CHAINS[name];
      return (
        <View style={{ flexDirection: 'row', gap: 3 }}>
          {[art.kept, art.kept, art.shielded].map((color, i) => (
            <View
              key={i}
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }}
            />
          ))}
        </View>
      );
    }
    if (kind === 'frame' && FRAMES[name]) {
      const art = FRAMES[name];
      return (
        <View
          style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            borderWidth: 2.5,
            borderTopColor: art.from,
            borderLeftColor: art.from,
            borderRightColor: art.to,
            borderBottomColor: art.to,
          }}
        />
      );
    }
    return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent }} />;
  };

  /**
   * What one line says.
   *
   * Consumables are named by what they are worth rather than by their slug —
   * `premium:<season>:90` is a database key and reading it out would be the app
   * showing its filing system to somebody who just earned something.
   */
  const label = (kind: string, name: string): string => {
    if (kind === 'premium') {
      /*
       * The slug is `premium:<season>:<rung>` — its tail is the rung the payout
       * came from, not the length of the window. The length lives on the tier,
       * which is where this reads it from. Falling back to a generic line
       * rather than to a wrong number: "some Premium" is vague, "0 days of
       * Premium" is a bug on the happiest screen in the app.
       */
      const rungDay = Number(name.split(':').pop());
      const source = tiers.find((tier) => tier.dayThreshold === rungDay) ?? rung;
      const days = source?.rewards.find((r) => r.kind === 'premium')?.days;
      return days
        ? t('rewards.milestonePremiumDays', { count: days })
        : t('rewards.milestonePremium');
    }
    if (kind === 'shield') return t('rewards.milestoneShield');
    return t(`rewards.cosmetic.${name}`);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      {/* The confetti sits behind the card and above the scrim, so it falls
          past the badge rather than in front of it. */}
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
        <CelebrationOverlay visible={visible} onDone={() => undefined} />

        <View
          className={cardClass({ padding: 'lg' }, 'gap-4')}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
        >
          <View className="items-center gap-3 pt-2">
            {badge ? <RewardBadge name={badge.name} size={88} /> : null}

            <Text variant="heading" className="text-center">
              {rung
                ? t('rewards.milestoneTitle', { name: rung.name })
                : t('rewards.milestoneTitleGeneric')}
            </Text>
            <Text variant="muted" className="text-center">
              {t('rewards.milestoneBody', { count: qualifiedDays })}
            </Text>
          </View>

          {lines.length > 0 ? (
            <View
              className="gap-2 rounded-2xl p-3"
              style={{ borderWidth: 1, borderColor: c.border }}
            >
              {lines.map((line) => (
                <View key={`${line.kind}:${line.name}`} className="flex-row items-center gap-3">
                  {swatch(line.kind, line.name)}
                  <Text variant="muted" className="flex-1">
                    {label(line.kind, line.name)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <View className="gap-2">
            <Button label={t('rewards.milestoneShare')} onPress={onShare} />
            <Button label={t('rewards.milestoneDone')} variant="secondary" onPress={onDismiss} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
