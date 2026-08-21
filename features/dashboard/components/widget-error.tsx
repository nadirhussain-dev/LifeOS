import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { ERROR_ICONS } from '@/components/ui/query-error';
import { Text } from '@/components/ui/text';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { colors } from '@/constants/theme';
import { errorKind, errorMessageKey, errorMessageParams, isRetryable } from '@/lib/supabase-error';

type Props = {
  /** The thrown error. Drives icon, copy and whether retrying is offered. */
  error?: unknown;
  onRetry?: () => void;
};

/**
 * Compact sibling of `QueryError` for dashboard widgets.
 *
 * `QueryError` is `flex-1 … p-8` — a full-screen takeover, correct for a screen
 * whose whole job failed and wrong inside a 200pt card sitting in a stack of
 * eight others. This says the same thing in a row.
 *
 * It exists because every widget branched on `isLoading || !data` and read
 * `isError` nowhere, so a failed query (which settles at `isLoading:false` with
 * `data:undefined` once `retry: 2` is spent) fell into the *skeleton* branch and
 * stayed there. The dashboard is the app's landing screen, so the failure mode
 * was a screen of grey shimmer that never resolved and offered no retry — a
 * shimmer promises data is coming, and that one could not keep the promise.
 *
 * Copy and icon are derived from the cause via lib/supabase-error, the same way
 * `QueryError` does it, so a widget and a full screen never describe one failure
 * two different ways.
 */
export function WidgetError({ error, onRetry }: Props) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = colors[scheme];

  const kind = error === undefined ? 'unknown' : errorKind(error);
  const Icon = ERROR_ICONS[kind];
  const body =
    error === undefined
      ? t('common.loadFailedBody')
      : t(errorMessageKey(error), errorMessageParams(error));
  // Retrying an RLS refusal or an unapplied migration just replays the failure.
  const showRetry = !!onRetry && (error === undefined || isRetryable(error));

  return (
    <View
      // Announced rather than silently swapped in: the widget it replaces may
      // already have been read aloud as a skeleton.
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      className="flex-row items-start gap-2.5 py-1"
    >
      <Icon size={17} color={c.mutedForeground} style={{ marginTop: 2 }} />
      <View className="flex-1 gap-1.5">
        <Text variant="muted">{body}</Text>
        {showRetry ? (
          <Pressable
            onPress={onRetry}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('common.retry')}
            className="self-start"
          >
            <Text className="font-sora-semibold text-sm" style={{ color: c.accent }}>
              {t('common.retry')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
