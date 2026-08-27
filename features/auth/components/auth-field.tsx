import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, type KeyboardTypeOptions } from 'react-native';

import { Eye, EyeOff } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secure?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  autoComplete?: 'email' | 'password' | 'name' | 'new-password' | 'off';
  autoFocus?: boolean;
  /** Validation message, rendered by `Input` and folded into the a11y label. */
  error?: string;
};

/**
 * The auth screens' field: `Input` plus a show/hide toggle for secure entry.
 *
 * This used to be its own `TextInput` in its own bordered row, which is how it
 * came to carry every gap the shared component was written to close — no focus
 * state, no dynamic-type cap, and `border` where the field token belonged. It
 * keeps only what is genuinely auth-specific: the eye toggle, and the medium
 * weight (credentials are easier to proof-read a character at a time than the
 * regular weight body text everywhere else).
 */
export function AuthField({
  label,
  value,
  onChangeText,
  placeholder,
  secure,
  keyboardType,
  autoCapitalize = 'none',
  autoComplete = 'off',
  autoFocus,
  error,
}: Props) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(!!secure);

  return (
    <Input
      label={label}
      error={error}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      secureTextEntry={hidden}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      autoComplete={autoComplete}
      autoCorrect={false}
      autoFocus={autoFocus}
      className="py-3.5 font-sora-medium"
      trailing={
        secure ? (
          <Pressable
            accessibilityRole="button"
            // Says which way it goes. "Show password" on a field that is
            // already showing is the reading a bare icon invites.
            accessibilityLabel={t(hidden ? 'auth.showPassword' : 'auth.hidePassword')}
            onPress={() => setHidden((h) => !h)}
            hitSlop={10}
            className="ps-2"
          >
            {hidden ? (
              <EyeOff size={18} color={c.mutedForeground} />
            ) : (
              <Eye size={18} color={c.mutedForeground} />
            )}
          </Pressable>
        ) : undefined
      }
    />
  );
}
