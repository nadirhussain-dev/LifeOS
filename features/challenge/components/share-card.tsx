import * as Sharing from 'expo-sharing';
import { forwardRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { Button } from '@/components/ui/button';
import { Flame } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import type { ChainDay } from '@/features/challenge/types/challenge.types';
import { RewardBadge } from '@/features/rewards/components/reward-badge';
import { CHAINS, DEFAULT_CHAIN } from '@/features/rewards/config/catalog';
import { useOwnedCosmetics } from '@/features/rewards/hooks/use-rewards';
import { equippedOwned, useCosmeticsStore } from '@/features/rewards/store/cosmetics-store';
import i18n from '@/lib/i18n';
import { toast } from '@/lib/toast-store';

/**
 * The streak, as something that can leave the app.
 *
 * Two jobs, and the second is the real one. It gives somebody a way to mark a
 * milestone — and it turns a private streak into a public one, which is the
 * single cheapest thing that makes a streak harder to abandon. A number only
 * you can see is a number only you can quietly stop caring about.
 *
 * Rendered off-screen and captured with `view-shot`, the same pattern
 * `app/gallery/compare.tsx` uses. Drawn with explicit colours rather than
 * theme tokens on purpose: the PNG leaves the app and lands somewhere with its
 * own background, so it has to carry its own ground rather than borrow one.
 *
 * ## Why the cosmetics land here first
 *
 * This is the one surface in the programme that other people see, and
 * REWARDS_STRATEGY is explicit that a cosmetic only carries value where it is
 * seen. So an earned chain repaints these dots and an earned badge sits in the
 * corner — the two changes that make somebody who has climbed further produce a
 * visibly different card from somebody who has not.
 *
 * The **braid deliberately does not take the chain colours.** Its strands are
 * module tints, and they are load-bearing: the whole point of that drawing is
 * that you can see *which commitment* broke. Repainting them for decoration
 * would trade the only diagnostic in the feature for a nicer palette.
 */

const CARD = {
  ground: '#101020',
  ink: '#eceaf6',
  muted: '#9b97b3',
};

type Props = {
  days: ChainDay[];
  qualifiedDays: number;
  /** Equipped chain name, or null for the default palette. */
  chain?: string | null;
  /** Highest badge earned, drawn in the corner. Null when there is none yet. */
  badge?: string | null;
};

/** The captured surface. Kept separate so the screen can mount it off-layout. */
export const ShareCard = forwardRef<View, Props>(function ShareCard(
  { days, qualifiedDays, chain, badge },
  ref,
) {
  const { t } = useTranslation();
  const palette = (chain && CHAINS[chain]) || DEFAULT_CHAIN;

  return (
    <View
      ref={ref}
      collapsable={false}
      style={{ width: 320, padding: 24, backgroundColor: CARD.ground, gap: 16 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Flame size={18} color={palette.kept} />
        <Text style={{ color: CARD.ink, fontSize: 18, flex: 1 }} className="font-sora-semibold">
          {t('challenge.shareTitle', { count: qualifiedDays })}
        </Text>
        {/* The badge, at the size a badge is worth on a card somebody is about
            to post. Nothing else in this layout moved to make room for it. */}
        {badge ? <RewardBadge name={badge} size={34} /> : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {days.slice(-120).map((day) => (
          <View
            key={day.localDay}
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor:
                day.outcome === 'qualified'
                  ? palette.kept
                  : day.outcome === 'shielded'
                    ? palette.shielded
                    : palette.missed,
            }}
          />
        ))}
      </View>

      <Text style={{ color: CARD.muted, fontSize: 11 }} className="font-sora-medium">
        {t('challenge.shareFooter')}
      </Text>
    </View>
  );
});

/**
 * Captures the off-screen card and hands it to the OS share sheet.
 *
 * Extracted from the button because there are now two places worth sharing
 * from — the button on the screen, and the milestone sheet at the moment
 * something was actually earned, which is the one moment somebody genuinely
 * wants to show it. Two copies of a capture-and-share would be two places for
 * the error handling to diverge.
 *
 * Reads its strings off the i18n singleton rather than a hook, so it can be
 * called from an event handler that is not inside a component render.
 */
export async function captureAndShare(target: React.RefObject<View | null>): Promise<void> {
  try {
    const uri = await captureRef(target, { format: 'png', quality: 1 });
    if (!(await Sharing.isAvailableAsync())) {
      toast.error(i18n.t('challenge.shareUnavailable'));
      return;
    }
    await Sharing.shareAsync(uri, { mimeType: 'image/png' });
  } catch {
    toast.error(i18n.t('challenge.shareFailed'));
  }
}

/**
 * What the card should be wearing.
 *
 * A hook rather than something the screen assembles, so the card and the
 * trophy case cannot end up disagreeing about which chain is equipped — and so
 * the ownership check (`equippedOwned`) happens in exactly one place for this
 * surface.
 *
 * The badge shown is the **last one earned**, which the shelf already returns
 * newest first. Not the rarest: "the one you just got" is what somebody wants
 * on the card they are posting today, and it is also the only ordering that
 * needs no notion of rank.
 */
export function useShareCosmetics(): { chain: string | null; badge: string | null } {
  const equipped = useCosmeticsStore((s) => s.equipped);
  const owned = useOwnedCosmetics();

  return {
    chain: equippedOwned(equipped, 'chain', owned.chain),
    badge: owned.badge[0] ?? null,
  };
}

/** The button that captures it. Separated so the card can live off-screen. */
export function ShareButton({ target }: { target: React.RefObject<View | null> }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const share = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await captureAndShare(target);
    } finally {
      setBusy(false);
    }
  }, [busy, target]);

  return (
    <Button
      label={t('challenge.shareOpen')}
      variant="secondary"
      onPress={() => void share()}
      disabled={busy}
    />
  );
}
