import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { CloudOff, RefreshCw, ShieldCheck } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { SocialAuthButtons } from '@/features/auth/components/social-auth-buttons';
import { StepScaffold } from '@/features/onboarding/components/step-scaffold';
import { useTheme } from '@/hooks/use-theme';
import { isSupabaseConfigured } from '@/lib/env';
import { alpha } from '@/lib/color';

/**
 * Where an account gets offered — one step into the flow, not in front of it.
 *
 * ## Why this is not a login screen
 *
 * It used to be. `app/index.tsx` sent every unauthenticated visitor to
 * `(auth)/login`, so the first thing a brand-new user saw was an email field, a
 * password field, and — below the fold of their attention — a small underlined
 * "continue without an account". The app asked to be trusted with credentials
 * before demonstrating that it did anything.
 *
 * Now the value comes first and this is a genuine choice between three real
 * options, stated at the same weight. "Not now" is not a consolation prize: this
 * app works completely offline, and a guest who signs in later keeps everything
 * they have written. That is worth saying plainly, because most apps that offer
 * a guest mode quietly punish it.
 *
 * The promise below (`perkNothingLost`) was untrue for the whole time it was on
 * screen: the sentinel `continueAsGuest()` stamps made a first sign-in look like
 * an account switch, so the local database was wiped. It is true now, and it is
 * kept true by asking rather than by assuming — the same phone can be lent to
 * somebody else, and only the person holding it knows whose notes those are.
 * See `reconcileAccountOnSignIn` and `useGuestDataPrompt`.
 *
 * ## Why one-tap providers are the primary path
 *
 * Google and Apple cost one tap and no typing, and neither asks the user to
 * invent a password they will reuse. Email is kept, one level down, for people
 * who want it or whose provider is unavailable.
 */
export function AccountStep({
  onContinueAsGuest,
  onSignedIn,
  onUseEmail,
  isGuest = false,
}: {
  onContinueAsGuest: () => void;
  onSignedIn: () => void;
  onUseEmail: () => void;
  /**
   * The user already chose "continue on this device" and has walked back here.
   *
   * Worth knowing, because the screen is otherwise identical to the one they
   * answered a moment ago and reads as the app having forgotten. The choice is
   * still reversible in both directions — that is the whole reason this step is
   * no longer deleted from the flow once it is answered — so the copy
   * acknowledges the answer rather than re-asking the question.
   */
  isGuest?: boolean;
}) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const [error, setError] = useState<string | null>(null);

  return (
    <StepScaffold
      scroll
      eyebrow={t('onboarding.accountEyebrow')}
      title={t('onboarding.accountTitle')}
      body={isGuest ? t('onboarding.accountBodyGuest') : t('onboarding.accountBody')}
      footer={
        /* A button, at the same size as the ones above it.
 
           The header of this file has claimed since it was written that this is
           "a genuine choice between three real options, stated at the same
           weight". It was not: Google and Apple were filled buttons, email was
           an outlined one, and this was unstyled text in the footer. Somebody
           who did not want an account had to read past three buttons to find
           the sentence telling them they did not have to. Saying a path is
           supported and drawing it as the thing you do when you give up are
           different messages, and people read the second one. */
        <View className="gap-1">
          <Button
            label={
              isGuest ? t('onboarding.keepOnThisDevice') : t('onboarding.continueOnThisDevice')
            }
            variant="secondary"
            size="lg"
            onPress={onContinueAsGuest}
          />
          <Text variant="caption" className="text-center">
            {t('onboarding.continueOnThisDeviceHint')}
          </Text>
        </View>
      }
    >
      <View className="gap-5">
        {isSupabaseConfigured ? (
          <>
            <SocialAuthButtons onSignedIn={onSignedIn} onError={setError} />

            {error ? (
              <Text variant="caption" className="text-destructive">
                {error}
              </Text>
            ) : null}

            <View className="flex-row items-center gap-3">
              <View className="h-px flex-1" style={{ backgroundColor: c.border }} />
              <Text variant="caption">{t('common.or')}</Text>
              <View className="h-px flex-1" style={{ backgroundColor: c.border }} />
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={onUseEmail}
              className="items-center rounded-full border py-3.5"
              style={{ borderColor: c.border }}
            >
              <Text className="font-sora-semibold" style={{ color: c.foreground }}>
                {t('onboarding.useEmail')}
              </Text>
            </Pressable>
          </>
        ) : (
          /* No credentials in this build, so there is nothing to sign in to.
             Saying so is better than showing three buttons that fail — and guest
             mode is a complete way to use this app, not a degraded one. */
          <View
            className="flex-row gap-3 rounded-2xl p-4"
            style={{ backgroundColor: alpha(c.mutedForeground, 0.08) }}
          >
            <CloudOff size={18} color={c.mutedForeground} />
            <Text variant="caption" className="flex-1">
              {t('onboarding.accountUnavailable')}
            </Text>
          </View>
        )}

        {/* What an account is actually for. Two lines, because "sync your data"
            is a feature list and this is a decision. */}
        <View className="gap-3 pt-1">
          <Perk icon={RefreshCw} text={t('onboarding.perkSync')} />
          <Perk icon={ShieldCheck} text={t('onboarding.perkNothingLost')} />
        </View>
      </View>
    </StepScaffold>
  );
}

function Perk({ icon: Icon, text }: { icon: typeof RefreshCw; text: string }) {
  const { c } = useTheme();
  return (
    <View className="flex-row items-start gap-2.5">
      <Icon size={15} color={c.accent} style={{ marginTop: 2 }} />
      <Text variant="caption" className="flex-1">
        {text}
      </Text>
    </View>
  );
}
