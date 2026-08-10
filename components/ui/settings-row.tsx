import { type LucideIcon } from 'lucide-react-native';
import { type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { ChevronForward } from '@/components/ui/directional-icon';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';

type Props = {
  icon: LucideIcon;
  label: string;
  subtitle?: string;
  value?: string;
  destructive?: boolean;
  isFirst?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  /**
   * A deliberately undiscoverable action on this row.
   *
   * Used for one thing: re-entering a private space whose Settings row has been
   * hidden. The row shows no chevron and announces itself as ordinary text, so
   * it does not advertise the gesture — which is the entire point, and the
   * reason this is not `onPress`.
   *
   * A screen reader can still perform it (double-tap and hold) even though it
   * is not announced, so the gesture is reachable rather than merely invisible.
   * Being unannounced is the requirement, not an oversight.
   */
  onLongPress?: () => void;
  /** Set false to suppress the default chevron on a tappable row that performs
   * an inline action (export, delete) rather than navigating somewhere. */
  chevron?: boolean;
  /** Custom trailing element (e.g. a Switch) instead of the default chevron/value. */
  right?: ReactNode;
};

/** One tappable row within a settings card — icon, label + optional subtitle,
 * and a trailing chevron/value/custom control. Shared by every section of
 * the Settings screen. */
export function SettingsRow({
  icon: Icon,
  label,
  subtitle,
  value,
  destructive,
  isFirst,
  disabled,
  onPress,
  onLongPress,
  chevron = true,
  right,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const tint = destructive ? colors[scheme].destructive : colors[scheme].foreground;

  const content = (
    <View
      className={
        isFirst
          ? 'flex-row items-center gap-3 py-3.5'
          : 'flex-row items-center gap-3 border-t border-border py-3.5'
      }
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Icon size={17} color={tint} />
      <View className="flex-1 gap-0.5">
        <Text className="font-sora-medium" style={{ color: tint }}>
          {label}
        </Text>
        {subtitle && <Text variant="caption">{subtitle}</Text>}
      </View>
      {right ??
        (value ? (
          <Text variant="muted">{value}</Text>
        ) : onPress && chevron ? (
          <ChevronForward size={17} color={colors[scheme].mutedForeground} />
        ) : null)}
    </View>
  );

  if (!onPress && !onLongPress) return content;
  return (
    <Pressable
      // Only a row you can actually tap calls itself a button. A row whose sole
      // action is the hidden long-press stays announced as its own text, so the
      // gesture is not given away by the row describing itself as tappable.
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
    >
      {content}
    </Pressable>
  );
}
