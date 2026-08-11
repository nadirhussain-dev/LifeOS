import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Search, UserCircle } from 'lucide-react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AdSlot } from '@/features/ads/components/ad-slot';
import { ModuleCard } from '@/features/hub/components/module-card';
import { HUB_SECTIONS, type HubModule } from '@/features/hub/config/modules';
import { useModuleFlagsStore } from '@/features/module-flags/store/module-flags-store';
import { PRIVATE_MODULES } from '@/features/private/config/private-modules';
import { usePrivateStore } from '@/features/private/store/private-store';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { alpha } from '@/lib/color';

/** Splits a section's modules into rows of two so the grid stays aligned even
 * when a section holds an odd count (the gap is filled with an invisible
 * spacer rather than letting a lone card stretch full-width). */
function toRows(modules: HubModule[]): (HubModule | null)[][] {
  const rows: (HubModule | null)[][] = [];
  for (let i = 0; i < modules.length; i += 2) {
    const row: (HubModule | null)[] = [modules[i]];
    row.push(modules[i + 1] ?? null);
    rows.push(row);
  }
  return rows;
}

export default function HubScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const scheme = useColorScheme() ?? 'light';

  const privateKey = usePrivateStore((s) => s.key);
  const privateSpace = usePrivateStore((s) => s.space);
  const enabledPrivate = usePrivateStore((s) => s.enabledModules);
  const privatised = usePrivateStore((s) => s.privatised);

  const flags = useModuleFlagsStore((s) => s.flags);

  /**
   * Two independent filters, and they hide for different reasons.
   *
   * The operator's switch removes a module the app itself has pulled — broken,
   * or its backend is down. The user's own "keep this private" choice moves a
   * module into the section below, where it appears only while the vault is
   * open. A module can be subject to both, in which case the operator wins:
   * unlocking your vault should not hand you back a module known to be broken.
   */
  const sections = useMemo(
    () =>
      HUB_SECTIONS.map((section) => {
        const visible = section.modules.filter(
          (module) => flags[module.id]?.enabled !== false && !privatised.includes(module.id),
        );
        return { ...section, modules: visible, rows: toRows(visible) };
      }).filter((section) => section.modules.length > 0),
    [flags, privatised],
  );

  /** Disabled modules, with whatever the operator said about them. Shown rather
   * than silently vanished: a module that disappears without explanation
   * generates the support mail the message was meant to prevent. */
  const disabled = useMemo(
    () =>
      HUB_SECTIONS.flatMap((section) => section.modules).filter(
        (module) => flags[module.id]?.enabled === false,
      ),
    [flags],
  );

  /**
   * The private section exists only while the space is unlocked.
   *
   * Not greyed out, not shown with a padlock — absent. A locked card announces
   * that there is something to hide and roughly what, which is the one thing
   * these modules exist to prevent. Locking makes the section vanish because
   * `privateKey` goes null, with no separate state to forget to clear.
   */
  const privateSection = useMemo(() => {
    if (!privateKey) return null;

    const born = PRIVATE_MODULES.filter(
      (m) =>
        enabledPrivate.includes(m.id) &&
        // Membership metadata for a `requiresRealSpace` module (shared albums)
        // is visible to the server independent of which local key unlocked
        // this device — the decoy space must not surface it, even though
        // `privateKey` is non-null here too. See private-modules.ts's header.
        (!m.requiresRealSpace || privateSpace === 'real'),
    ).map((m) => ({
      id: m.id,
      titleKey: m.titleKey,
      subtitleKey: m.subtitleKey,
      icon: m.icon,
      tint: m.tint,
      route: m.route,
    }));

    // Ordinary modules the user moved in here. They keep their own identity —
    // same icon, same tint — because they are the same module, just reached
    // through the vault.
    const moved = HUB_SECTIONS.flatMap((section) => section.modules)
      .filter((m) => privatised.includes(m.id) && flags[m.id]?.enabled !== false)
      .map((m) => ({
        id: m.id,
        titleKey: m.titleKey,
        subtitleKey: m.subtitleKey,
        icon: m.icon,
        tint: m.tint,
        route: m.getRoute(),
      }));

    const modules = [...born, ...moved];
    return modules.length > 0 ? modules : null;
  }, [privateKey, privateSpace, enabledPrivate, privatised, flags]);

  const readyCount = useMemo(
    () =>
      sections.reduce((sum, s) => sum + s.modules.filter((m) => m.status === 'ready').length, 0),
    [sections],
  );

  const handleOpen = (module: HubModule) => router.push(module.getRoute() as never);

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 120 }}
        contentContainerClassName="gap-6 px-4"
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-end justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text variant="heading">{t('hub.title')}</Text>
            <Text variant="muted">{t('hub.modulesReady', { count: readyCount })}</Text>
          </View>
          {/* The screen listing every module is exactly where "I know I wrote
              it down somewhere" happens. */}
          {/* The profile lives here rather than as a sixth tab — see
              app/profile.tsx for why the tab bar stays at five. */}
          <Pressable
            onPress={() => router.push('/profile')}
            accessibilityRole="button"
            accessibilityLabel={t('profile.title')}
            className="h-11 w-11 items-center justify-center rounded-full border border-border bg-surface"
          >
            <UserCircle size={20} color={colors[scheme].foreground} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/search')}
            accessibilityRole="button"
            accessibilityLabel={t('search.title')}
            className="h-11 w-11 items-center justify-center rounded-full border border-border bg-surface"
          >
            <Search size={20} color={colors[scheme].foreground} />
          </Pressable>
        </View>

        {sections.map((section, sectionIndex) => (
          <View key={section.id} className="gap-3">
            <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
              {t(section.labelKey)}
            </Text>
            <View className="gap-3">
              {section.rows.map((row, rowIndex) => (
                <Animated.View
                  key={rowIndex}
                  entering={
                    reducedMotion
                      ? undefined
                      : FadeInDown.delay(80 * sectionIndex + 40 * rowIndex).duration(320)
                  }
                  className="flex-row gap-3"
                >
                  {row.map((module, cellIndex) =>
                    module ? (
                      <ModuleCard key={module.id} module={module} onPress={handleOpen} />
                    ) : (
                      <View key={`spacer-${cellIndex}`} className="flex-1" />
                    ),
                  )}
                </Animated.View>
              ))}
            </View>
          </View>
        ))}

        {disabled.length > 0 ? (
          <View className="gap-3">
            <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
              {t('moduleFlags.unavailable')}
            </Text>
            <View className="gap-2">
              {disabled.map((module) => (
                <View
                  key={module.id}
                  className="flex-row items-center gap-3.5 rounded-2xl border border-border px-4 py-3.5 opacity-60"
                >
                  <View className="h-11 w-11 items-center justify-center rounded-2xl bg-surface">
                    <module.icon
                      size={20}
                      color={colors[scheme].mutedForeground}
                      strokeWidth={1.9}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="font-sora-medium text-foreground">{t(module.titleKey)}</Text>
                    <Text variant="caption">
                      {flags[module.id]?.message ?? t('moduleFlags.defaultMessage')}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {privateSection ? (
          <View className="gap-3">
            <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
              {t('private.sectionLabel')}
            </Text>
            <View className="gap-2">
              {privateSection.map((module) => {
                const Icon = module.icon;
                const tint = resolveTint(module.tint, scheme);
                return (
                  <Pressable
                    key={module.id}
                    accessibilityRole="button"
                    onPress={() => router.push(module.route as never)}
                    className={cardClass({ padding: 'rowLg' }, 'flex-row items-center gap-3.5')}
                  >
                    <View
                      className="h-11 w-11 items-center justify-center rounded-2xl"
                      style={{ backgroundColor: alpha(tint, 0.16) }}
                    >
                      <Icon size={20} color={tint} strokeWidth={1.9} />
                    </View>
                    <View className="flex-1">
                      <Text className="font-sora-medium text-foreground">{t(module.titleKey)}</Text>
                      <Text variant="caption">{t(module.subtitleKey)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <AdSlot placement="hub-bottom" />
      </ScrollView>
    </View>
  );
}
