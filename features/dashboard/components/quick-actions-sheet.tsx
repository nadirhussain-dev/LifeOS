import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import {
  BookOpen,
  CheckSquare,
  Clock3,
  Repeat,
  StickyNote,
  type LucideIcon,
} from 'lucide-react-native';
import { forwardRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { toDateKey } from '@/lib/date';

type Action = {
  labelKey: string;
  icon: LucideIcon;
  getHref: () =>
    | '/task/new'
    | '/note/new'
    | '/habit/new'
    | `/journal/${string}`
    | { pathname: '/timeline/event/new'; params: { date: string } };
};

/** Shared with the dashboard's radial menu so the tap path and the long-press
 *  path can never offer different actions. */
export const QUICK_ACTIONS: Action[] = [
  { labelKey: 'dashboard.newTask', icon: CheckSquare, getHref: () => '/task/new' },
  { labelKey: 'dashboard.newNote', icon: StickyNote, getHref: () => '/note/new' },
  {
    labelKey: 'dashboard.newJournalEntry',
    icon: BookOpen,
    getHref: () => `/journal/${toDateKey(new Date())}`,
  },
  { labelKey: 'dashboard.newHabit', icon: Repeat, getHref: () => '/habit/new' },
  {
    labelKey: 'dashboard.newEvent',
    icon: Clock3,
    getHref: () => ({ pathname: '/timeline/event/new', params: { date: toDateKey(new Date()) } }),
  },
];

export const QuickActionsSheet = forwardRef<BottomSheetModal>(
  function QuickActionsSheet(_props, ref) {
    const router = useRouter();
    const scheme = useColorScheme() ?? 'light';
    const { t } = useTranslation();

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.4} />
      ),
      [],
    );

    const handleActionPress = (action: Action) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (ref && 'current' in ref) {
        ref.current?.dismiss();
      }
      router.push(action.getHref());
    };

    return (
      <BottomSheetModal
        ref={ref}
        enableDynamicSizing
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: colors[scheme].card }}
        handleIndicatorStyle={{ backgroundColor: colors[scheme].border }}
      >
        <BottomSheetView className="gap-1 px-4 pb-8 pt-2">
          <Text variant="subheading" className="px-2 pb-2">
            {t('dashboard.quickActions')}
          </Text>
          {QUICK_ACTIONS.map((action) => (
            <Pressable
              accessibilityRole="button"
              key={action.labelKey}
              onPress={() => handleActionPress(action)}
              className="flex-row items-center gap-3 rounded-md px-2 py-3 active:bg-muted"
            >
              <action.icon color={colors[scheme].foreground} size={20} />
              <Text>{t(action.labelKey)}</Text>
            </Pressable>
          ))}
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);
