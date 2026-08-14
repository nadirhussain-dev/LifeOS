import { CloudOff, Lock, ServerCrash, TriangleAlert, WifiOff } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { errorKind, errorMessageKey, isRetryable, toSupabaseError } from '@/lib/supabase-error';
import type { SupabaseErrorKind } from '@/lib/supabase-error';

/**
 * Shared error state for data screens. Without this, a failed query falls
 * through to the screen's empty state ("No transactions yet"), indistinguishable
 * from genuinely-empty — so users can't tell a load failure from no data, and
 * there's no way to retry.
 *
 * Pass `error` and the copy, the icon and whether Retry is even offered are all
 * derived from what actually went wrong (see lib/supabase-error). The previous
 * single sentence — "check your connection" — was shown for expired sessions,
 * permission refusals and unapplied migrations alike, none of which a user can
 * fix by looking at their wifi. `message` still overrides everything for the
 * cases a screen genuinely knows better.
 *
 * The `error === undefined` fallback (`common.loadFailedBody`) must stay
 * cause-agnostic for the same reason. Most screens here read the LOCAL
 * database and never touch the network at all, so a default that names the
 * connection is wrong by construction on all of them — as the SQLCipher shim
 * bug proved, when a `TypeError` from drizzle put "Check your connection" on
 * Journal, Sleep, Study and Water while the network was entirely healthy, and
 * sent the search for the cause in exactly the wrong direction.
 */

const ICONS: Record<SupabaseErrorKind, typeof TriangleAlert> = {
  offline: WifiOff,
  'not-configured': CloudOff,
  'signed-out': Lock,
  'backend-missing': CloudOff,
  permission: Lock,
  conflict: TriangleAlert,
  server: ServerCrash,
  unknown: TriangleAlert,
};

type Props = {
  onRetry?: () => void;
  /** Overrides the derived explanation. */
  message?: string;
  /** The thrown error. Drives icon, copy and whether retrying is offered. */
  error?: unknown;
  /** Optional extra action, e.g. "Sign in" for a signed-out failure. */
  action?: { label: string; onPress: () => void };
};

export function QueryError({ onRetry, message, error, action }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();

  const kind = error === undefined ? 'unknown' : errorKind(error);
  const Icon = ICONS[kind];
  const body =
    message ?? (error === undefined ? t('common.loadFailedBody') : t(errorMessageKey(error)));
  // Retrying an unapplied migration or an RLS refusal just replays the same
  // failure, so the button is only offered where it could actually help.
  const showRetry = !!onRetry && (error === undefined || isRetryable(error));

  return (
    <View className="flex-1 items-center justify-center gap-3 p-8">
      <View
        className="h-14 w-14 items-center justify-center rounded-2xl"
        style={{ backgroundColor: theme.muted }}
      >
        <Icon size={24} color={theme.mutedForeground} />
      </View>
      <Text className="font-sora-semibold text-foreground">{t('common.couldntLoad')}</Text>
      <Text variant="muted" className="text-center">
        {body}
      </Text>

      {/* The raw code is the fastest route to a diagnosis, but it is noise for
          everyone who is not debugging — so it stays in development builds. */}
      {__DEV__ && error !== undefined && toSupabaseError(error).code ? (
        <Text variant="caption" className="text-center">
          {t('errors.detail', { code: toSupabaseError(error).code })}
        </Text>
      ) : null}

      <View className="mt-1 flex-row gap-2">
        {showRetry && (
          <Pressable
            onPress={onRetry}
            className="rounded-full border border-border bg-card px-5 py-2.5"
            accessibilityRole="button"
            accessibilityLabel={t('common.retry')}
          >
            <Text className="font-sora-medium text-foreground">{t('common.retry')}</Text>
          </Pressable>
        )}
        {action && (
          <Pressable
            onPress={action.onPress}
            className="rounded-full bg-primary px-5 py-2.5"
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            <Text className="font-sora-medium text-primary-foreground">{action.label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/**
 * Inline sibling of the above, for forms — a save failure belongs next to the
 * button that failed, not as a full-screen takeover that discards what was typed.
 */
export function InlineError({ error, message }: { error?: unknown; message?: string }) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const kind = error === undefined ? 'unknown' : errorKind(error);
  const Icon = ICONS[kind];
  const body = message ?? (error === undefined ? t('errors.unknown') : t(errorMessageKey(error)));
  const code = error === undefined ? null : toSupabaseError(error).code;

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      className="flex-row gap-2.5 rounded-2xl border border-destructive/30 bg-destructive/10 p-3.5"
    >
      <Icon size={18} color={colors[scheme].destructive} style={{ marginTop: 1 }} />
      <View className="flex-1 gap-0.5">
        <Text className="font-sora-medium text-sm" style={{ color: colors[scheme].destructive }}>
          {body}
        </Text>
        {__DEV__ && code ? <Text variant="caption">{t('errors.detail', { code })}</Text> : null}
      </View>
    </View>
  );
}
