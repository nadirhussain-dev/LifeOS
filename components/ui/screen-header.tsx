import { useRouter } from 'expo-router';
import { type LucideIcon } from 'lucide-react-native';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronBack } from '@/components/ui/directional-icon';
import { Text } from '@/components/ui/text';
import { resolveTint, type TintPair } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

export type HeaderAction = {
  icon: LucideIcon;
  /** accessibilityLabel for the action button. */
  label: string;
  onPress: () => void;
  /** Optional trailing caption (e.g. the Goals sort value "Newest"). */
  text?: string;
  /** Optional icon color override — defaults to the screen's foreground. */
  tint?: string;
};

type Props = {
  /** Omitted on detail screens whose title lives in a hero below — the header
   *  then renders just the back affordance + actions. */
  title?: string;
  /** Uppercase micro label above the title — module identity on landing
   *  screens, parent-module breadcrumb on inner screens. */
  eyebrow?: string;
  /**
   * Module tint — colors the eyebrow and the back-chip icon. When omitted the
   * header stays neutral (used by module-less screens like Journal).
   *
   * Accepts a `TintPair` as well as a bare hex, and resolves it here. Ten
   * chrome screens were passing a flat `'#737373'` — the same grey in both
   * themes, and the one grey in the app with no emerald bias, so those headers
   * read as a different family from everything around them. Taking the pair
   * means a caller writes `tint={moduleTints.settings}` and gets the right
   * value per theme without threading `useColorScheme` through the screen.
   */
  tint?: string | TintPair;
  /** Defaults to router.back(). */
  onBack?: () => void;
  /** Hide the back affordance entirely (root-of-stack screens). */
  showBack?: boolean;
  actions?: HeaderAction[];
  /** Custom right slot — overrides `actions` for bespoke controls
   *  (e.g. the Notes archived toggle). */
  right?: ReactNode;
};

/**
 * The one header every module screen wears. Replaces the hand-rolled
 * `insets.top + 8` + bare `ChevronLeft` + `Text heading` block that had been
 * copy-pasted across the app, and threads the module's signature tint into the
 * eyebrow + back chip so a module keeps the identity its Hub tile promised.
 */
export function ScreenHeader({
  title,
  eyebrow,
  tint: tintProp,
  onBack,
  showBack = true,
  actions,
  right,
}: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const c = colors[scheme];
  const tint = typeof tintProp === 'string' ? tintProp : tintProp && resolveTint(tintProp, scheme);

  const handleBack = onBack ?? (() => router.back());

  return (
    <View
      style={{ paddingTop: insets.top + 8 }}
      className="flex-row items-center justify-between px-5 pb-2"
    >
      <View className="flex-1 flex-row items-center gap-2.5">
        {showBack && (
          <Pressable
            onPress={handleBack}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            className="h-10 w-10 items-center justify-center rounded-full"
            style={{ backgroundColor: tint ? alpha(tint, 0.12) : c.muted }}
          >
            <ChevronBack size={22} color={tint ?? c.foreground} />
          </Pressable>
        )}
        <View className="flex-1">
          {eyebrow ? (
            <Text variant="micro" numberOfLines={1} style={tint ? { color: tint } : undefined}>
              {eyebrow}
            </Text>
          ) : null}
          {title ? (
            <Text variant="heading" numberOfLines={1}>
              {title}
            </Text>
          ) : null}
        </View>
      </View>

      {right ??
        (actions && actions.length > 0 ? (
          <View className="flex-row items-center gap-4 ps-2">
            {actions.map((action) => (
              <Pressable
                key={action.label}
                onPress={action.onPress}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                className="min-h-[44px] flex-row items-center gap-1"
                style={{ justifyContent: 'center' }}
              >
                <action.icon size={20} color={action.tint ?? c.foreground} />
                {action.text ? <Text variant="caption">{action.text}</Text> : null}
              </Pressable>
            ))}
          </View>
        ) : null)}
    </View>
  );
}
