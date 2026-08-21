import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useModuleFlagsStore } from '@/features/module-flags/store/module-flags-store';
import { filterByRole, type PrivateModuleId } from '@/features/private/config/private-modules';
import { usePrivateStore } from '@/features/private/store/private-store';
import { useProfileStore } from '@/features/profile/store/profile-store';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * The shell every private module screen sits in.
 *
 * It exists mainly for the redirect: each screen must stop rendering the moment
 * the key disappears, or an auto-lock leaves decrypted content on screen for
 * whoever picks the phone up. Putting it in one shell means a new private
 * module cannot forget it, which is the kind of thing that gets forgotten
 * exactly once.
 *
 * `moduleId`, when given, adds two more reasons to bounce back to `/private`
 * instead of rendering: the gender gate (`filterByRole` in private-modules.ts)
 * and the operator's module-flag switch. Both used to be enforced only by the
 * list screens (the home grid, the setup catalogue) filtering which cards they
 * draw — which a deep link, a stale back-stack entry, or a stale
 * `enabledModules` entry from before `showAllModules` was toggled off could
 * all walk straight past, since the route itself never checked anything. Pass
 * it from every private module screen so the shell — not each screen — is
 * responsible for remembering.
 */
type Props = {
  title: string;
  subtitle?: string;
  tint: string;
  children: ReactNode;
  /** Rendered under the header, outside the scroll area (e.g. an add button). */
  footer?: ReactNode;
  moduleId?: PrivateModuleId;
};

export function PrivateScreen({ title, subtitle, tint, children, footer, moduleId }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const key = usePrivateStore((s) => s.key);
  const gender = useProfileStore((s) => s.gender);
  const showAllModules = usePrivateStore((s) => s.showAllModules);
  const flags = useModuleFlagsStore((s) => s.flags);

  const blocked =
    !!moduleId &&
    (filterByRole([moduleId], gender, showAllModules).length === 0 ||
      flags[moduleId]?.enabled === false);

  useEffect(() => {
    if (!key) {
      router.replace('/private/unlock');
      return;
    }
    // Checked only once unlocked: an already-locked space redirects to the PIN
    // pad above, not here, so this never overrides that with a worse message.
    if (blocked) router.replace('/private');
  }, [key, blocked, router]);

  if (!key || blocked) return null;

  return (
    <View className="flex-1 bg-background">
      {/*
       * The app's header, not a private one.
       *
       * This block used to be hand-rolled here — its own back chip, its own
       * title metrics, and a raw lucide `ChevronLeft`, which does not mirror in
       * RTL. So in Arabic and Urdu the vault's back button pointed at the
       * content it had come from, on all nineteen screens this shell serves.
       * `ScreenHeader` uses `ChevronBack` and gets that right.
       *
       * The module tint moves from the title to the back chip, which is where
       * every other module in the app carries its identity. The private space
       * keeps its colour; it stops being the one part of the app that wears it
       * differently.
       */}
      <ScreenHeader title={title} subtitle={subtitle} tint={tint} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-5 px-5 pt-2"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>

      {footer ? (
        <View className="px-5" style={{ paddingBottom: insets.bottom + 12 }}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}

/** A row of selectable chips — used for symptoms, triggers and tags, which are
 * the same interaction three times over. */
export function ChipRow<T extends string>({
  options,
  selected,
  onToggle,
  tint,
  labelFor,
}: {
  options: readonly T[];
  selected: T[];
  onToggle: (value: T) => void;
  tint: string;
  labelFor: (value: T) => string;
}) {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];

  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((option) => {
        const active = selected.includes(option);
        return (
          <Pressable
            key={option}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: active }}
            onPress={() => onToggle(option)}
            className="rounded-full border px-3.5 py-2"
            style={{
              borderColor: active ? tint : theme.border,
              backgroundColor: active ? `${tint}22` : 'transparent',
            }}
          >
            <Text
              className="font-sora-medium text-sm"
              style={{ color: active ? tint : theme.foreground }}
            >
              {labelFor(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
