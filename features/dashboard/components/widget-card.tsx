import { type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { WidgetError } from '@/features/dashboard/components/widget-error';
import { alpha } from '@/lib/color';

type Props = {
  icon: LucideIcon;
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
  /** Optional accent for the icon chip + action — defaults to the brand accent. */
  tint?: string;
  /**
   * The widget's query error, if it failed. Present → the body is replaced by
   * `WidgetError` and `children` is not rendered.
   *
   * The branch lives here rather than in each widget because all nine had the
   * same omission: they read `isLoading` and never `isError`, so a settled
   * failure fell through to their skeleton and shimmered forever. Owning it in
   * the shell means a new widget cannot reintroduce that by forgetting.
   */
  error?: unknown;
  /** Offered alongside the error. Usually the query's own `refetch`. */
  onRetry?: () => void;
  children: React.ReactNode;
};

export function WidgetCard({
  icon: Icon,
  title,
  actionLabel,
  onActionPress,
  tint,
  error,
  onRetry,
  children,
}: Props) {
  const { c } = useTheme();
  const accent = tint ?? c.accent;

  return (
    <View className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-3')}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2.5">
          <View
            className="h-8 w-8 items-center justify-center rounded-xl"
            style={{ backgroundColor: alpha(accent, 0.14) }}
          >
            <Icon color={accent} size={17} />
          </View>
          <Text variant="subheading">{title}</Text>
        </View>
        {actionLabel && onActionPress ? (
          <Pressable accessibilityRole="button" onPress={onActionPress} hitSlop={8}>
            <Text variant="caption" className="font-sora-semibold" style={{ color: accent }}>
              {actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {error !== undefined && error !== null ? (
        <WidgetError error={error} onRetry={onRetry} />
      ) : (
        children
      )}
    </View>
  );
}
