import * as Sharing from 'expo-sharing';
import { Flame } from 'lucide-react-native';
import { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import type { ChainDay } from '@/features/challenge/components/day-chain';
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
 */

const CARD = {
  ground: '#101020',
  ink: '#eceaf6',
  muted: '#9b97b3',
  filled: '#9c92ff',
  empty: '#2f2d48',
  missed: '#f4809c',
};

type Props = {
  days: ChainDay[];
  qualifiedDays: number;
};

/** The captured surface. Kept separate so the screen can mount it off-layout. */
export const ShareCard = forwardRef<View, Props>(function ShareCard({ days, qualifiedDays }, ref) {
  const { t } = useTranslation();

  return (
    <View
      ref={ref}
      collapsable={false}
      style={{ width: 320, padding: 24, backgroundColor: CARD.ground, gap: 16 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Flame size={18} color={CARD.filled} />
        <Text style={{ color: CARD.ink, fontSize: 18 }} className="font-sora-semibold">
          {t('challenge.shareTitle', { count: qualifiedDays })}
        </Text>
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
                  ? CARD.filled
                  : day.outcome === 'shielded'
                    ? CARD.empty
                    : CARD.missed,
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

/** The button that captures it. Separated so the card can live off-screen. */
export function ShareButton({ target }: { target: React.RefObject<View | null> }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const uri = await captureRef(target, { format: 'png', quality: 1 });
      if (!(await Sharing.isAvailableAsync())) {
        toast.error(t('challenge.shareUnavailable'));
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: 'image/png' });
    } catch {
      toast.error(t('challenge.shareFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      label={t('challenge.shareOpen')}
      variant="secondary"
      onPress={() => void share()}
      disabled={busy}
    />
  );
}
