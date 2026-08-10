import { AtSign, Check, LoaderCircle, TriangleAlert, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { colors as semanticColors } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { USERNAME_PATTERN, useAuthStore } from '@/features/auth/services/auth-store';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Long enough that a fast typist isn't firing a request per keystroke. */
const DEBOUNCE_MS = 450;

/** 'unavailable' — the check itself failed — is its own state rather than being
 * folded into 'taken'. Reporting a backend problem as "that name is taken" sends
 * the user off inventing new names against a check that can never pass. */
export type UsernameStatus =
  'empty' | 'invalid' | 'checking' | 'available' | 'taken' | 'unavailable';

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  /** Bubbles the verdict up so the parent can gate its submit button. */
  onStatusChange?: (status: UsernameStatus) => void;
};

/**
 * Account-name input with a live availability check.
 *
 * The verdict here is advisory only — it can go stale between the check and
 * the claim, so the caller must still treat a 'taken' result from
 * `claimUsername` as normal. The database's unique index is the real arbiter.
 */
export function UsernameField({ value, onChangeText, onStatusChange }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const isUsernameAvailable = useAuthStore((s) => s.isUsernameAvailable);
  const [status, setStatus] = useState<UsernameStatus>('empty');

  // Only the newest lookup may write state — a slow early request must not
  // overwrite the verdict for what the user has since typed.
  const requestRef = useRef(0);

  useEffect(() => {
    const trimmed = value.trim();
    const next = ++requestRef.current;

    if (!trimmed) {
      setStatus('empty');
      return;
    }
    if (!USERNAME_PATTERN.test(trimmed)) {
      setStatus('invalid');
      return;
    }

    setStatus('checking');
    const timer = setTimeout(async () => {
      const verdict = await isUsernameAvailable(trimmed);
      if (requestRef.current !== next) return; // superseded
      setStatus(verdict);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [value, isUsernameAvailable]);

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  const hint = {
    empty: t('auth.usernameHint'),
    invalid: t('auth.usernameInvalid'),
    checking: t('auth.usernameChecking'),
    available: t('auth.usernameAvailable'),
    taken: t('auth.usernameTaken'),
    unavailable: t('auth.usernameCheckFailed'),
  }[status];

  const hintColor =
    status === 'available'
      ? colors[scheme].success
      : status === 'taken' || status === 'invalid'
        ? colors[scheme].destructive
        : status === 'unavailable'
          ? // Amber, not red: the name may well be fine — it's the check that
            // couldn't run, and the user has nothing to fix.
            semanticColors[scheme].warning
          : colors[scheme].mutedForeground;

  return (
    <View className="gap-1.5">
      <View className={cardClass({ padding: 'row' }, 'flex-row items-center gap-2')}>
        <AtSign size={16} color={colors[scheme].mutedForeground} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          accessibilityLabel={t('auth.username')}
          placeholder={t('auth.usernamePlaceholder')}
          placeholderTextColor={colors[scheme].mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          className="flex-1 text-foreground"
        />
        {status === 'available' ? <Check size={16} color={colors[scheme].success} /> : null}
        {status === 'taken' || status === 'invalid' ? (
          <X size={16} color={colors[scheme].destructive} />
        ) : null}
        {status === 'unavailable' ? (
          <TriangleAlert size={16} color={semanticColors[scheme].warning} />
        ) : null}
        {status === 'checking' ? (
          <LoaderCircle size={16} color={colors[scheme].mutedForeground} />
        ) : null}
      </View>
      <Text variant="caption" style={{ color: hintColor }}>
        {hint}
      </Text>
    </View>
  );
}
