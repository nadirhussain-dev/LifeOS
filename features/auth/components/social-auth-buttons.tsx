import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { GoogleMark } from '@/features/auth/components/google-mark';
import {
  isAppleAuthAvailable,
  signInWithApple,
  signInWithGoogle,
  wasCancelled,
} from '@/features/auth/services/oauth';
import { useTheme } from '@/hooks/use-theme';
import { elevation } from '@/constants/design-tokens';
import { isSupabaseConfigured } from '@/lib/env';

type Props = {
  /** Called once a session exists, so the caller can advance its own flow. The
   *  auth gate also reacts on its own; this is for flows that need to do
   *  something *else* first, like onboarding moving to its next step. */
  onSignedIn?: () => void;
  onError?: (message: string) => void;
  /** Disables both buttons while the caller is busy with its own request. */
  disabled?: boolean;
};

const HEIGHT = 52;

/**
 * "Continue with Google" and "Continue with Apple".
 *
 * One component, used by the onboarding account step, the login screen and the
 * sign-up screen, so the three cannot drift into offering different providers —
 * which is the usual way a project ends up with a provider that works in one
 * place and 404s in another.
 *
 * Apple's is its own native button rather than a styled copy. A hand-built
 * version has to match Apple's mark, wording, corner radius and contrast rules
 * exactly or review can reject it, and the native one is those rules by
 * definition. It is sized and radiused to match the Google button beside it so
 * the pair still reads as one set.
 *
 * Both are hidden entirely when the build has no Supabase credentials. A sign-in
 * button that cannot sign anybody in is worse than an absent one: it reads as
 * broken rather than as not-configured, and guest mode is a legitimate way to
 * run this app.
 */
export function SocialAuthButtons({ onSignedIn, onError, disabled }: Props) {
  const { c, scheme } = useTheme();
  const { t } = useTranslation();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [busy, setBusy] = useState<'google' | 'apple' | null>(null);

  useEffect(() => {
    void isAppleAuthAvailable().then(setAppleAvailable);
  }, []);

  if (!isSupabaseConfigured) return null;

  const run = async (provider: 'google' | 'apple') => {
    setBusy(provider);
    const result = provider === 'google' ? await signInWithGoogle() : await signInWithApple();
    setBusy(null);
    if (result.ok) {
      onSignedIn?.();
      return;
    }
    // Backing out of the sheet is not a failure and must not leave a red line
    // on the screen — the user knows what they just did.
    if (!wasCancelled(result)) onError?.(result.error);
  };

  const blocked = disabled || busy !== null;

  return (
    <View className="gap-2.5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('auth.continueWithGoogle')}
        accessibilityState={{ disabled: blocked, busy: busy === 'google' }}
        disabled={blocked}
        onPress={() => void run('google')}
        style={[
          {
            height: HEIGHT,
            borderRadius: HEIGHT / 2,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            backgroundColor: c.card,
            borderWidth: 1,
            borderColor: c.border,
            opacity: blocked && busy !== 'google' ? 0.5 : 1,
          },
          elevation.e1,
        ]}
      >
        {busy === 'google' ? (
          <ActivityIndicator size="small" color={c.mutedForeground} />
        ) : (
          <>
            {/* The mark must sit on white in both themes — it is Google's, and
                it may not be recoloured to suit a dark card. */}
            <View
              style={{
                height: 26,
                width: 26,
                borderRadius: 13,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#ffffff',
              }}
            >
              <GoogleMark size={17} />
            </View>
            <Text className="font-sora-semibold" style={{ color: c.foreground, fontSize: 16 }}>
              {t('auth.continueWithGoogle')}
            </Text>
          </>
        )}
      </Pressable>

      {appleAvailable ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          // Apple's own contrast rule: black on light, white on dark.
          buttonStyle={
            scheme === 'dark'
              ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
          }
          cornerRadius={HEIGHT / 2}
          style={{ height: HEIGHT, width: '100%', opacity: blocked ? 0.5 : 1 }}
          onPress={() => {
            if (!blocked) void run('apple');
          }}
        />
      ) : null}
    </View>
  );
}
