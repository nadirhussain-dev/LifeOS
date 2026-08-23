import { View } from 'react-native';

import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Every code this app sends — signup and password-reset alike — is this long. */
export const OTP_LENGTH = 6;

type Props = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  autoFocus?: boolean;
};

/** The 6-digit code field shared by `verify-signup` and `verify-reset`. Plain
 *  digits only — `onChangeText` strips anything else, so a paste that includes
 *  spaces or dashes still lands as a clean code. */
export function OtpField({ label, value, onChangeText, autoFocus }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];

  return (
    <View className="gap-1.5">
      <Text variant="sectionLabel" className="px-1">
        {label}
      </Text>
      <View
        className="rounded-2xl border px-4"
        style={{ borderColor: theme.border, backgroundColor: theme.card }}
      >
        <Input
          surface="bare"
          value={value}
          onChangeText={(text) => onChangeText(text.replace(/\D/g, '').slice(0, OTP_LENGTH))}
          accessibilityLabel={label}
          placeholder="000000"
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={OTP_LENGTH}
          autoFocus={autoFocus}
          className="py-3.5 text-center"
          style={{
            fontSize: 22,
            letterSpacing: 8,
            fontFamily: 'Sora_600SemiBold',
            color: theme.foreground,
          }}
        />
      </View>
    </View>
  );
}
