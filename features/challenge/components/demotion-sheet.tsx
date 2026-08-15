import { useTranslation } from 'react-i18next';
import { Modal, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { nextTier } from '@/features/challenge/services/challenge-math';
import type { ChallengeTier } from '@/features/challenge/types/challenge.types';
import { useTheme } from '@/hooks/use-theme';

/**
 * The fall, told properly.
 *
 * This screen matters more than its size suggests. A demotion that arrives as a
 * silently smaller number is read as the app losing somebody's work — and the
 * user is not wrong to read it that way, because from where they are sitting
 * the two are indistinguishable. So it says exactly what happened, exactly what
 * it cost, and exactly what the next rung needs.
 *
 * One button, and it is not "OK". Dismissing a loss is not the action anybody
 * wants to take; carrying on is. The wording is the difference between a user
 * who restarts and one who uninstalls, and restarting users are the population
 * this whole programme is funded by.
 *
 * Deliberately no blame, no streak-shaming, and no mention of what they should
 * have done. They know.
 */

type Props = {
  visible: boolean;
  fromDays: number;
  toDays: number;
  tiers: ChallengeTier[];
  onDismiss: () => void;
};

export function DemotionSheet({ visible, fromDays, toDays, tiers, onDismiss }: Props) {
  const { t } = useTranslation();
  const { c } = useTheme();

  const next = nextTier(tiers, toDays);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <View
          className={cardClass({ padding: 'lg' }, 'gap-4')}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
        >
          <View className="gap-2">
            <Text variant="subheading" style={{ color: c.warning }}>
              {t('challenge.demotedTitle')}
            </Text>
            <Text variant="muted">
              {t('challenge.demotedBody', { from: fromDays, to: toDays })}
            </Text>
            {next ? (
              <Text variant="muted">
                {t('challenge.demotedNext', {
                  count: next.dayThreshold - toDays,
                  name: next.name,
                })}
              </Text>
            ) : null}
          </View>

          <Button label={t('challenge.keepGoing')} onPress={onDismiss} />
        </View>
      </View>
    </Modal>
  );
}
