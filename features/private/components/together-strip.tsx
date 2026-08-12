import { differenceInCalendarDays } from 'date-fns';
import { CalendarHeart, MessagesSquare } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useMilestonePulse } from '@/features/private/hooks/use-milestone-pulse';
import { TOGETHER_MILESTONES } from '@/features/private/services/together';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

type Props = {
  memberNames: string[];
  totalMembers: number;
  photoCount: number;
  /** The album's own createdAt — "days together" is measured from the space
   *  existing, not from the first photo, so it stays meaningful for an
   *  album started before anything was added to it. */
  createdAt: number;
  tint: string;
  /** allow_chat (0029) or this account is the owner. */
  showChatEntry: boolean;
  onOpenChat: () => void;
  /** Opens the add/manage sheet for custom milestones (0039) — always
   *  offered, unlike chat, since adding one is core to the feature rather
   *  than something an owner might switch off. */
  onManageMilestones: () => void;
  /** together.ts's todaysMilestone(), already decrypted — when set, takes
   *  visual priority over the day-count pulse below: a named anniversary
   *  landing on the same day as, say, day 730 is the more meaningful thing
   *  to say out loud. */
  todaysMilestoneTitle?: string | null;
  /** Opens the standalone Together module (app/private/together.tsx) when
   *  given — absent for a caller with nowhere to send that tap to. This strip
   *  stays the in-album teaser; the module is where "us" actually lives. */
  onOpenTogether?: () => void;
};

/**
 * The warm framing the shared-albums feature asked for: not a new data model,
 * just this album's own membership and photo count read back as "here's what
 * you two (or however many) have built", plus the door into the chat when
 * it's open.
 */
export function TogetherStrip({
  memberNames,
  totalMembers,
  photoCount,
  createdAt,
  tint,
  showChatEntry,
  onOpenChat,
  onManageMilestones,
  todaysMilestoneTitle,
  onOpenTogether,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();
  const days = Math.max(0, differenceInCalendarDays(new Date(), new Date(createdAt)));

  // The couple-bonding nudge: "days together" landing on a milestone gets a
  // one-time pulse and a line worth pausing on, the same mechanism
  // recovery-hero.tsx uses for a streak — noticing an anniversary is exactly
  // as much "here's a number that means something" as a relapse-free streak
  // is, just measured in a shared space instead of a private one.
  const { hit, style: pulseStyle } = useMilestonePulse(days, TOGETHER_MILESTONES);

  return (
    <Animated.View style={pulseStyle} className="gap-2">
      <View
        className="flex-row items-center gap-3 rounded-2xl px-4 py-3.5"
        style={{ backgroundColor: alpha(tint, 0.1) }}
      >
        <Pressable
          accessibilityRole={onOpenTogether ? 'button' : undefined}
          onPress={onOpenTogether}
          disabled={!onOpenTogether}
          className="flex-1 flex-row items-center gap-3"
        >
          <View className="flex-row">
            {memberNames.slice(0, 4).map((name, i) => (
              <View
                key={`${name}-${i}`}
                className="h-8 w-8 items-center justify-center rounded-full border-2"
                style={{
                  backgroundColor: alpha(tint, 0.22),
                  borderColor: theme.card,
                  marginLeft: i === 0 ? 0 : -10,
                }}
              >
                <Text className="font-sora-semibold text-xs" style={{ color: tint }}>
                  {(name || '?').slice(0, 1).toUpperCase()}
                </Text>
              </View>
            ))}
          </View>
          <View>
            <Text className="font-sora-semibold text-sm text-foreground">
              {t('private.togetherFor', { count: days })}
            </Text>
            <Text variant="caption">
              {t('private.memoriesCount', { count: photoCount })} ·{' '}
              {t('private.membersCount', { count: totalMembers })}
            </Text>
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('private.manageMilestones')}
          onPress={onManageMilestones}
          hitSlop={8}
          className="h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: alpha(tint, 0.2) }}
        >
          <CalendarHeart size={18} color={tint} strokeWidth={1.9} />
        </Pressable>

        {showChatEntry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('private.openChat')}
            onPress={onOpenChat}
            hitSlop={8}
            className="h-10 w-10 items-center justify-center rounded-full"
            style={{ backgroundColor: alpha(tint, 0.2) }}
          >
            <MessagesSquare size={18} color={tint} strokeWidth={1.9} />
          </Pressable>
        ) : null}
      </View>

      {todaysMilestoneTitle ? (
        <Text variant="caption" className="px-1 text-center" style={{ color: tint }}>
          {t('private.todaysMilestone', { title: todaysMilestoneTitle })}
        </Text>
      ) : hit ? (
        <Text variant="caption" className="px-1 text-center" style={{ color: tint }}>
          {t('private.togetherMilestone', { count: days })}
        </Text>
      ) : null}
    </Animated.View>
  );
}
