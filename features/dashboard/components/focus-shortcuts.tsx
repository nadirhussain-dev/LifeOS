import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { moduleForPath } from '@/features/hub/config/route-modules';
import { useModuleGate } from '@/features/module-flags/hooks/use-module-access';
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
  const allowed = useModuleGate();

  if (focusAreas.length === 0) return null;

  /**
   * Preserve the canonical FOCUS_AREAS order rather than selection order, and
   * drop any whose module may not be opened.
   *
   * This row is a set of deep links, so an ungated one is a shortcut into a
   * screen the route guard immediately bounces — and for a privatised module,
   * a tile naming it sitting on the dashboard. Answering onboarding is not a
   * standing instruction that outranks the three switches; it is what put the
   * shortcut here in the first place.
   *
   * The module comes from the area's own `route` through the guard's map,
   * rather than its `module` field — that one is a `ModuleName` chosen for the
   * tint (`fitness` for Gallery), not a module id the gate would recognise.
   */
  const chosen = FOCUS_AREAS.filter((area) => {
    if (!focusAreas.includes(area.id)) return false;
    const moduleId = moduleForPath(area.route);
    return moduleId === null || allowed(moduleId);
  });

  if (chosen.length === 0) return null;

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
