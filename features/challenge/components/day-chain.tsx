import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';

/**
 * The chain, drawn honestly.
 *
 * Three states, not two: filled for a qualified day, a ring for one a shield
 * absorbed, and a solid warning dot for one that was simply lost. Showing the
 * misses is the point. A chain that quietly omits the bad days cannot answer
 * "why did I drop", and the first time somebody notices the gap they will
 * assume the app lost their work rather than that they missed a Tuesday.
 *
 * Rendered as a plain wrapping row of views rather than a chart: at one dot per
 * day this is the cheapest possible drawing, it reflows at any width, and it
 * needs no chart library — which this repo deliberately does not have.
 */

export type ChainDay = {
  localDay: string;
  outcome: 'qualified' | 'shielded' | 'missed';
  /** Which committed modules actually got activity. Drives the per-module
   *  strips in `module-chains.tsx`; unused by the whole-day chain here. */
  modulesHit: string[];
};

type Props = {
  days: ChainDay[];
};

export function DayChain({ days }: Props) {
  const { t } = useTranslation();
  const { c } = useTheme();

  if (days.length === 0) return null;

  const style = (outcome: ChainDay['outcome']) => {
    if (outcome === 'qualified') return { backgroundColor: c.accent };
    if (outcome === 'shielded') {
      return { backgroundColor: 'transparent', borderWidth: 2, borderColor: c.accent };
    }
    return { backgroundColor: c.warning };
  };

  const legend: [ChainDay['outcome'], string][] = [
    ['qualified', t('challenge.chainQualified')],
    ['shielded', t('challenge.chainShielded')],
    ['missed', t('challenge.chainMissed')],
  ];

  return (
    <View className={cardClass({ padding: 'md' }, 'gap-3')}>
      <Text variant="micro">{t('challenge.chainTitle')}</Text>

      <View className="flex-row flex-wrap gap-1.5">
        {days.map((day) => (
          <View
            key={day.localDay}
            className="h-3 w-3 rounded-full"
            style={style(day.outcome)}
            accessibilityLabel={`${day.localDay}: ${day.outcome}`}
          />
        ))}
      </View>

      <View className="flex-row flex-wrap gap-x-4 gap-y-1">
        {legend.map(([outcome, label]) => (
          <View key={outcome} className="flex-row items-center gap-1.5">
            <View className="h-2.5 w-2.5 rounded-full" style={style(outcome)} />
            <Text variant="caption">{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
