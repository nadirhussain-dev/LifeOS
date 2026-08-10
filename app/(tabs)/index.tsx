import { type BottomSheetModal } from '@gorhom/bottom-sheet';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, View } from 'react-native';

import { Defer } from '@/components/ui/defer';
import { RadialMenu } from '@/components/ui/radial-menu';
import { Fab } from '@/components/ui/fab';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { WIDGET_REGISTRY } from '@/features/dashboard/config/widget-registry';
import { DashboardHeader } from '@/features/dashboard/components/dashboard-header';
import { FocusShortcuts } from '@/features/dashboard/components/focus-shortcuts';
import {
  QuickActionsSheet,
  QUICK_ACTIONS,
} from '@/features/dashboard/components/quick-actions-sheet';
import { TodayFocusCard } from '@/features/dashboard/components/today-focus-card';
import { MoodTile, WaterTile } from '@/features/dashboard/components/wellbeing-tiles';
import type { WidgetId } from '@/features/dashboard/types/dashboard.types';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Widgets are grouped into three calm, scannable zones rather than stacked as
 * one long identical list — the hero answers "what now?", then Today holds the
 * active drivers, Wellbeing the gentle check-ins (as a 2-up row of compact
 * tiles, so size variation gives the screen rhythm), and For you the ambient
 * reads. Each widget carries its own module tint, so the screen reads alive
 * without any zone shouting. Any widget not placed in a section — nor handled
 * by the Wellbeing tiles — still renders under "More", so adding one to the
 * registry never silently hides it.
 */
const FULL_SECTIONS: { label: string; ids: WidgetId[] }[] = [
  { label: 'Today', ids: ['today-tasks', 'habit-row', 'today-timeline'] },
  { label: 'For you', ids: ['recent-notes', 'productivity-summary', 'daily-quote'] },
];
/** Rendered as the compact Wellbeing tiles instead of full-width widgets. */
const TILE_HANDLED: WidgetId[] = ['water-intake', 'reflect'];

/** A titled zone of full-width widgets pulled from the registry. */
function WidgetSection({ label, ids }: { label: string; ids: WidgetId[] }) {
  const items = ids.filter((id) => id in WIDGET_REGISTRY);
  if (items.length === 0) return null;
  return (
    <View className="gap-3">
      <Text variant="micro" className="px-1">
        {label}
      </Text>
      {items.map((id) => {
        const Component = WIDGET_REGISTRY[id];
        return <Component key={id} />;
      })}
    </View>
  );
}

export default function DashboardScreen() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const sheetRef = useRef<BottomSheetModal>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [radialOpen, setRadialOpen] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    setRefreshing(false);
  }, [queryClient]);

  const placed = new Set<WidgetId>([
    ...FULL_SECTIONS.flatMap((section) => section.ids),
    ...TILE_HANDLED,
  ]);
  const leftovers = (Object.keys(WIDGET_REGISTRY) as WidgetId[]).filter((id) => !placed.has(id));

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerClassName="gap-6 px-5 pb-28"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            // Without an explicit tint the spinner is invisible on dark.
            tintColor={colors[scheme].mutedForeground}
            colors={[colors[scheme].accent]}
          />
        }
      >
        {/* Above the fold: the greeting and the hero that answers "what now?".
            These mount immediately — they are the reason the screen exists. */}
        <DashboardHeader />
        <TodayFocusCard />
        <FocusShortcuts />

        {/* Everything below competes with the hero for the first frame and is
            mostly off-screen at launch, so it waits one frame. Each section
            holds its approximate height meanwhile, so the scrollbar and any
            restored scroll position don't jump as they arrive. */}
        <Defer placeholderHeight={220}>
          <WidgetSection label={t('dashboard.today')} ids={FULL_SECTIONS[0].ids} />
        </Defer>

        <Defer placeholderHeight={140}>
          <View className="gap-3">
            <Text variant="micro" className="px-1">
              {t('dashboard.wellbeing')}
            </Text>
            <View className="flex-row gap-3">
              <WaterTile />
              <MoodTile />
            </View>
          </View>
        </Defer>

        <Defer placeholderHeight={220}>
          <WidgetSection label={t('dashboard.forYou')} ids={FULL_SECTIONS[1].ids} />
        </Defer>

        {leftovers.length > 0 ? (
          <Defer placeholderHeight={160}>
            <WidgetSection label={t('tabs.more')} ids={leftovers} />
          </Defer>
        ) : null}
      </ScrollView>

      {/* Tap opens the sheet, long-press fans the same actions out under the
          thumb. The FAB stays because it is the only visible way to create
          anything — an app whose create affordance is an undiscoverable
          long-press is a worse app, however modern the gesture is. The arc is
          the shortcut for people who already know it is there. */}
      <Fab onPress={() => sheetRef.current?.present()} onLongPress={() => setRadialOpen(true)} />
      <RadialMenu
        open={radialOpen}
        onClose={() => setRadialOpen(false)}
        actions={QUICK_ACTIONS.map((action) => ({
          key: action.labelKey,
          label: t(action.labelKey),
          icon: action.icon,
          onPress: () => router.push(action.getHref() as never),
        }))}
      />
      <QuickActionsSheet ref={sheetRef} />
    </View>
  );
}
