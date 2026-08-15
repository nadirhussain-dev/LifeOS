import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { ChainDay } from '@/features/challenge/components/day-chain';
import { useTheme } from '@/hooks/use-theme';

/**
 * One short strip per committed module.
 *
 * The whole-day chain says *whether* days were kept. This says *which
 * commitment is the weak one*, which is the more actionable of the two: a user
 * who can see that Journal is the module with the holes in it can swap it out
 * before it costs them a rung, rather than discovering the pattern after the
 * fall.
 *
 * Reads `modules_hit` off the same ledger rows the chain already fetched — the
 * reason 0048 stores an array rather than a boolean.
 */

/** Enough to show a pattern, short enough to stay one line on a phone. */
const WINDOW = 21;

type Props = {
  days: ChainDay[];
  modules: string[];
};

export function ModuleChains({ days, modules }: Props) {
  const { t } = useTranslation();
  const { c } = useTheme();

  if (modules.length === 0 || days.length === 0) return null;

  const recent = days.slice(-WINDOW);

  return (
    <View className={cardClass({ padding: 'md' }, 'gap-3')}>
      <Text variant="micro">{t('challenge.moduleChains')}</Text>

      {modules.map((moduleId) => (
        <View key={moduleId} className="gap-1.5">
          <Text variant="caption">{t(`syncModule.${moduleId}`)}</Text>
          <View className="flex-row gap-1">
            {recent.map((day) => {
              const hit = day.modulesHit.includes(moduleId);
              return (
                <View
                  key={`${moduleId}-${day.localDay}`}
                  className="h-2 flex-1 rounded-full"
                  style={{
                    // A shielded day is not this module's failure — the day was
                    // covered — so it reads as neutral rather than as a hole.
                    backgroundColor: hit
                      ? c.accent
                      : day.outcome === 'shielded'
                        ? c.border
                        : c.warning,
                  }}
                />
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}
