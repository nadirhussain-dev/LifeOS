import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import { RotateCcw } from 'lucide-react-native';
import { forwardRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Switch, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { HUB_SECTIONS, type HubModule } from '@/features/hub/config/modules';
import {
  hiddenReason,
  isCurationActive,
  isManageable,
  type VisibilityContext,
} from '@/features/hub/services/module-visibility';
import { useModuleCurationStore } from '@/features/hub/store/module-curation-store';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';

type Props = {
  /** The same context the Hub grid renders from, so the two never disagree. */
  context: VisibilityContext;
};

/**
 * "Which modules do you actually use?", asked as a sheet from the Hub.
 *
 * The Hub already hid modules — from an onboarding question answered once,
 * months ago, in a flow most people tap through. Two things were missing: no
 * way to say "not this one" about a module the guess kept, and no way to say
 * "yes, this one" about a specific module the guess dropped without also
 * turning the whole guess off (`showAllModules`, which is all-or-nothing and
 * buried in Settings). So the only correction available was a global one, made
 * somewhere the user wasn't.
 *
 * This is that correction, per module, on the screen the modules are on. It
 * writes to `overrides` in module-curation-store, which outranks the guess in
 * both directions — see module-visibility.ts for the full ordering.
 *
 * Nothing here deletes anything. Closing a module hides its tile; its rows stay
 * exactly where they are and come back untouched with the switch, which is what
 * the sheet's own subtitle promises. That promise is the reason this is a
 * visibility store and not a data operation.
 */
export const ModuleManagerSheet = forwardRef<BottomSheetModal, Props>(function ModuleManagerSheet(
  { context },
  ref,
) {
  const { t } = useTranslation();
  const { c, resolve } = useTheme();

  const setModuleEnabled = useModuleCurationStore((s) => s.setModuleEnabled);
  const clearOverrides = useModuleCurationStore((s) => s.clearOverrides);
  const overrides = useModuleCurationStore((s) => s.overrides);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.4} />
    ),
    [],
  );

  /** Sections with only the modules this sheet can speak for — see
   *  `isManageable` for the two kinds it deliberately can't. */
  const sections = useMemo(
    () =>
      HUB_SECTIONS.map((section) => ({
        ...section,
        modules: section.modules.filter((module) => isManageable(module.id, context)),
      })).filter((section) => section.modules.length > 0),
    [context],
  );

  const counts = useMemo(() => {
    const modules = sections.flatMap((section) => section.modules);
    return {
      on: modules.filter((module) => hiddenReason(module.id, context) === null).length,
      total: modules.length,
    };
  }, [sections, context]);

  const toggle = (module: HubModule, next: boolean) => {
    // Light, and on the change rather than the press: the switch is the
    // confirmation, so a haptic before the state moved would be a lie.
    setModuleEnabled(module.id, next);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  /** Only worth offering while there is a guess to hand back to, and an
   *  explicit choice that has overruled it. */
  const canReset = Object.keys(overrides).length > 0 && isCurationActive(context);

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      // The list can run past the point where a sheet should stop growing —
      // sixteen modules on a small phone — so cap it and let the scroll view
      // inside take over.
      maxDynamicContentSize={560}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: c.card }}
      handleIndicatorStyle={{ backgroundColor: c.border }}
    >
      <BottomSheetScrollView contentContainerClassName="gap-5 px-4 pb-10 pt-1">
        <View className="gap-1.5">
          <View className="flex-row items-center justify-between gap-3">
            <Text variant="subheading">{t('hub.manageTitle')}</Text>
            {/* `on`, not `count` — `count` is i18next's plural selector, and
                  a fraction has no singular form worth branching on. */}
            <Text variant="caption">
              {t('hub.manageCount', { on: counts.on, total: counts.total })}
            </Text>
          </View>
          <Text variant="muted">{t('hub.manageBody')}</Text>
        </View>

        {sections.map((section) => (
          <View key={section.id} className="gap-2">
            <Text variant="sectionLabel">{t(section.labelKey)}</Text>
            <View className="gap-1">
              {section.modules.map((module) => {
                const Icon = module.icon;
                const tint = resolve(module.tint);
                const on = hiddenReason(module.id, context) === null;
                const title = t(module.titleKey);
                return (
                  <Pressable
                    key={module.id}
                    // The whole row is the control — one target, announced once,
                    // rather than a row and a switch that say the same thing in
                    // sequence. The Switch below is hidden from assistive tech
                    // for that reason; it stays as the visible state, and it
                    // stays draggable for anyone who prefers the gesture.
                    accessible
                    accessibilityRole="switch"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={title}
                    accessibilityHint={on ? t('hub.manageHintClose') : t('hub.manageHintOpen')}
                    onPress={() => toggle(module, !on)}
                    className="flex-row items-center gap-3.5 rounded-2xl py-2.5 active:bg-muted"
                  >
                    {/* The tile's own icon chip, dimmed rather than greyed
                          when off: a closed module is still that module, and
                          stripping its colour makes the list read as sixteen
                          identical rows to scan by text alone. */}
                    <View
                      className="h-10 w-10 items-center justify-center rounded-2xl"
                      style={{ backgroundColor: alpha(tint, on ? 0.16 : 0.08) }}
                    >
                      <Icon size={19} color={on ? tint : c.mutedForeground} strokeWidth={2} />
                    </View>
                    <View className="flex-1 gap-0.5">
                      <Text className="font-sora-medium text-foreground">{title}</Text>
                      <Text variant="caption" numberOfLines={1}>
                        {t(module.subtitleKey)}
                      </Text>
                    </View>
                    <Switch
                      value={on}
                      onValueChange={(next) => toggle(module, next)}
                      trackColor={{ true: c.accent, false: c.border }}
                      thumbColor="#ffffff"
                      // iOS honours the first, Android the second — both are
                      // needed to keep the row a single announced control.
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        {canReset ? (
          <Pressable
            accessibilityRole="button"
            onPress={clearOverrides}
            className="flex-row items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-3.5 active:bg-muted"
          >
            <RotateCcw size={15} color={c.mutedForeground} />
            <Text variant="caption">{t('hub.manageReset')}</Text>
          </Pressable>
        ) : null}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});
