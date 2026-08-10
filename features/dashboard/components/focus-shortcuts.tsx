import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { FOCUS_AREAS, focusTint } from '@/features/profile/constants';
import { useProfileStore } from '@/features/profile/store/profile-store';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

/**
 * A personalized quick-access row built from the focus areas the user picked in
 * onboarding — a fast lane into exactly the modules they said they care about
 * (including ones with no dashboard widget, like Sleep, Goals or Budget). Sits
 * right under the momentum hero. Renders nothing if no focus areas were chosen,
 * so the dashboard stays clean for anyone who skipped that step.
 */
export function FocusShortcuts() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const focusAreas = useProfileStore((s) => s.focusAreas);

  if (focusAreas.length === 0) return null;

  // Preserve the canonical FOCUS_AREAS order rather than selection order.
  const chosen = FOCUS_AREAS.filter((area) => focusAreas.includes(area.id));

  return (
    <View className="gap-3">
      <Text variant="micro" className="px-1">
        {t('dashboard.yourFocus')}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2.5 px-1"
      >
        {chosen.map((area) => {
          const tint = focusTint(area.module, scheme);
          const Icon = area.icon;
          return (
            <Pressable
              accessibilityRole="button"
              key={area.id}
              onPress={() => router.push(area.route as never)}
              className={cardClass(
                { padding: 'none', elevation: 'e1' },
                'flex-row items-center gap-2.5 py-2.5 pe-4 ps-2.5',
              )}
            >
              <View
                className="h-8 w-8 items-center justify-center rounded-xl"
                style={{ backgroundColor: alpha(tint, 0.14) }}
              >
                <Icon size={17} color={tint} />
              </View>
              <Text className="font-sora-semibold">{t(area.labelKey)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
