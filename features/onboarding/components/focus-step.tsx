import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { StepScaffold } from '@/features/onboarding/components/step-scaffold';
import { FOCUS_AREAS, focusTint } from '@/features/profile/constants';
import type { FocusArea } from '@/features/profile/store/profile-store';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';

/**
 * What the person actually cares about.
 *
 * The highest-signal question in the flow and the only genuinely enjoyable one,
 * so it gets a screen to itself and the picks are large, coloured chips rather
 * than a list of checkboxes. Each chip carries its module's identity tint, which
 * means this screen is also where somebody first learns the app's colour
 * language — sleep is indigo, hydration is cyan — before meeting it again on
 * every card afterwards.
 *
 * These answers now do two things rather than one. They still drive the
 * dashboard's focus shortcuts, and they also decide what the next step offers to
 * set up, which is what stops this being a survey.
 */
export function FocusStep({
  selected,
  onToggle,
  onNext,
}: {
  selected: FocusArea[];
  onToggle: (area: FocusArea) => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const { c, scheme } = useTheme();

  return (
    <StepScaffold
      scroll
      eyebrow={t('dashboard.yourFocus')}
      title={t('onboarding.whatMatters')}
      body={t('onboarding.pickAFew')}
      footer={
        <Button
          variant="accent"
          size="lg"
          // Never disabled. Somebody who wants to skip this should be able to,
          // and the label saying so is more honest than a dead button.
          label={selected.length ? t('common.continue') : t('onboarding.skipForNow')}
          onPress={onNext}
        />
      }
    >
      <View className="flex-row flex-wrap gap-2.5 pb-4">
        {FOCUS_AREAS.map((area) => {
          const isSelected = selected.includes(area.id);
          const tint = focusTint(area.module, scheme);
          const Icon = area.icon;
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              accessibilityLabel={t(area.labelKey)}
              key={area.id}
              onPress={() => onToggle(area.id)}
              className="flex-row items-center gap-2 rounded-full border px-4 py-3"
              style={{
                borderColor: isSelected ? tint : c.border,
                backgroundColor: isSelected ? alpha(tint, 0.14) : 'transparent',
              }}
            >
              <Icon size={17} color={isSelected ? tint : c.mutedForeground} />
              <Text
                className="font-sora-medium"
                style={{ color: isSelected ? tint : c.foreground }}
              >
                {t(area.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </StepScaffold>
  );
}
