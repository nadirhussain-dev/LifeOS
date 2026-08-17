import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useRouter } from 'expo-router';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Search, SlidersHorizontal, UserCircle } from 'lucide-react-native';

import { cardClass } from '@/components/ui/card';
import { Fab } from '@/components/ui/fab';
import { Text } from '@/components/ui/text';
import { resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AdSlot } from '@/features/ads/components/ad-slot';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { ModuleCard } from '@/features/hub/components/module-card';
import { ModuleManagerSheet } from '@/features/hub/components/module-manager-sheet';
import { HUB_SECTIONS, type HubModule } from '@/features/hub/config/modules';
import { hiddenReason, type VisibilityContext } from '@/features/hub/services/module-visibility';
import { useModuleCurationStore } from '@/features/hub/store/module-curation-store';
import { useModuleFlagsStore } from '@/features/module-flags/store/module-flags-store';
import { PRIVATE_MODULES } from '@/features/private/config/private-modules';
import { usePrivateStore } from '@/features/private/store/private-store';
import { Avatar } from '@/features/profile/components/avatar';
import { initialsFor } from '@/features/profile/services/avatar';
import { useProfileStore } from '@/features/profile/store/profile-store';
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

  const focusAreas = useProfileStore((s) => s.focusAreas);
  const showAllModules = useModuleCurationStore((s) => s.showAllModules);
  const setShowAllModules = useModuleCurationStore((s) => s.setShowAllModules);
  const overrides = useModuleCurationStore((s) => s.overrides);

  const profile = useAuthStore((s) => s.profile);
  const managerRef = useRef<BottomSheetModal>(null);

  /**
   * Everything that can hide a module, in one object.
   *
   * Four filters now, hiding for four different reasons — the operator's kill
   * switch, the private space, the user's own choice, and the guess made from
   * onboarding — and the module manager sheet has to agree with this grid about
   * every one of them. So the rules moved to
   * features/hub/services/module-visibility.ts, where the precedence between
   * them is written down and tested, and both screens read them from this one
   * context instead of each re-deriving a chain of conditions that has to match.
   */
  const context = useMemo<VisibilityContext>(
    () => ({ flags, privatised, overrides, focusAreas, showAllModules }),
    [flags, privatised, overrides, focusAreas, showAllModules],
  );

  const sections = useMemo(
    () =>
      HUB_SECTIONS.map((section) => {
        const visible = section.modules.filter(
          (module) => hiddenReason(module.id, context) === null,
        );
        return { ...section, modules: visible, rows: toRows(visible) };
      }).filter((section) => section.modules.length > 0),
    [context],
  );

  /** Modules the onboarding guess dropped and the user has never spoken about.
   *  Deliberately excludes the ones they closed themselves in the manager: a
   *  prompt offering those back is the app arguing with a decision it has just
   *  been given. */
  const curatedOutCount = useMemo(
    () =>
      HUB_SECTIONS.flatMap((section) => section.modules).filter(
        (module) => hiddenReason(module.id, context) === 'curated',
      ).length,
    [context],
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
          </View>
          {/* The profile lives here rather than as a sixth tab — see
              app/profile.tsx for why the tab bar stays at five. Your own face
              once you have uploaded one, through the same component the profile
              screen uses, so a picture that fails to load falls back to initials
              here too rather than to an empty circle. */}
          <Pressable
            onPress={() => router.push('/profile')}
            accessibilityRole="button"
            accessibilityLabel={t('profile.title')}
            className="h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-border bg-surface"
          >
            {profile ? (
              <Avatar
                path={profile.avatarPath}
                updatedAt={profile.avatarUpdatedAt}
                initials={initialsFor(profile.displayName, profile.email)}
                // 42, not 44: the chip's own 1px border eats a pixel each side,
                // and a 44 child would be clipped by it rather than sitting
                // inside it.
                size={42}
              />
            ) : (
              // No account (or none loaded yet): there is no picture and no name
              // to take initials from, so the generic mark is the honest answer.
              <UserCircle size={20} color={colors[scheme].foreground} />
            )}
          </Pressable>
          {/* The screen listing every module is exactly where "I know I wrote
              it down somewhere" happens. */}
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
                  // Explicit floor, matching ModuleCard's own `minHeight: 130`
                  // (features/hub/components/module-card.tsx). Without it, this
                  // row's cross-axis height depends entirely on its `flex: 1`
                  // children stretching to fill it — a circular resolution
                  // (row height comes from children, children's height comes
                  // from the row) that Yoga/Fabric was resolving to ~0 on this
                  // build, so every row rendered on top of the next instead of
                  // stacking. Giving the row its own floor breaks the cycle.
                  style={{ minHeight: 130 }}
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

        {curatedOutCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowAllModules(true)}
            className={cardClass(
              { padding: 'rowLg' },
              'flex-row items-center justify-center gap-2 border-dashed',
            )}
          >
            <Text className="font-sora-medium" style={{ color: colors[scheme].accent }}>
              {t('hub.showMoreModules', { count: curatedOutCount })}
            </Text>
          </Pressable>
        ) : null}

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

      {/* Labelled rather than a bare glyph. Every other FAB in the app is a
          plus, and a plus here would promise to create something; this one
          curates the grid it sits on, which no icon says on its own. */}
      <Fab
        icon={SlidersHorizontal}
        label={t('hub.manageModules')}
        onPress={() => managerRef.current?.present()}
        accessibilityLabel={t('hub.manageTitle')}
      />
      <ModuleManagerSheet ref={managerRef} context={context} />
    </View>
  );
}
