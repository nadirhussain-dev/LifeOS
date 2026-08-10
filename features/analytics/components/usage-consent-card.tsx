import { BarChart3 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cardClass } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useUsageStore } from '@/features/analytics/store/usage-store';
import { useProfileStore } from '@/features/profile/store/profile-store';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { env } from '@/lib/env';

/**
 * The one-time ask for usage statistics.
 *
 * Exists because the counters moved from opt-out to opt-in. Under GDPR the
 * lawful basis for this kind of processing is consent, and consent has to be a
 * freely given affirmative act — a default-on switch buried in Settings is not
 * one, however honestly the privacy policy describes it.
 *
 * ## Why it is a card and not a blocking modal
 *
 * Nothing is collected until it is answered, so there is no hurry and no reason
 * to hold the app hostage over it. A consent dialog you cannot dismiss is also
 * the shape that produces meaningless consent: people tap the bright button to
 * get rid of it. This sits above the tab bar, states plainly what is and is not
 * collected, and offers two equally weighted answers — neither styled to be the
 * obvious one.
 *
 * Declining counts as a decision, so it is asked exactly once either way. It
 * can be changed at any time in Settings → Sync & Account.
 *
 * ## Why it waits for onboarding
 *
 * A first-run screen stack that opens on a data-collection question, before the
 * app has shown what it does, gets answered by somebody with no basis for
 * answering. This appears once they are actually in the app.
 */
export function UsageConsentCard() {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const hydrated = useUsageStore((s) => s.hydrated);
  const consentDecided = useUsageStore((s) => s.consentDecided);
  const decideConsent = useUsageStore((s) => s.decideConsent);
  const onboarded = useProfileStore((s) => s.onboardingComplete);

  // Not before the store has rehydrated: acting on the default would show the
  // card for a frame to everybody who has already answered.
  if (!hydrated || consentDecided || !onboarded) return null;

  return (
    <View
      className="absolute inset-x-0 bottom-0 px-4"
      style={{ paddingBottom: insets.bottom + 76 }}
      pointerEvents="box-none"
    >
      <View className={cardClass({ padding: 'lg', elevation: 'e1' }, 'gap-3')}>
        <View className="flex-row items-center gap-3">
          <View className="h-10 w-10 items-center justify-center rounded-2xl bg-surface">
            <BarChart3 size={19} color={theme.primary} strokeWidth={1.8} />
          </View>
          <Text variant="subheading" className="flex-1">
            {t('usage.consentTitle')}
          </Text>
        </View>

        <Text variant="caption">{t('usage.consentBody')}</Text>
        {/* The reassurance that actually matters, stated as a limit on what the
            data can express rather than as a promise about our intentions. */}
        <Text variant="caption">{t('usage.consentNever')}</Text>

        <Pressable
          onPress={() => void Linking.openURL(env.EXPO_PUBLIC_PRIVACY_URL)}
          accessibilityRole="link"
          accessibilityLabel={t('settings.privacyPolicy')}
          className="min-h-11 justify-center"
        >
          <Text className="font-sora-medium" style={{ color: theme.primary }}>
            {t('settings.privacyPolicy')}
          </Text>
        </Pressable>

        {/* Equal weight on purpose. Making "allow" the prominent button is how
            you collect a yes that means "stop asking me". */}
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Button
              label={t('usage.consentDecline')}
              variant="secondary"
              onPress={() => decideConsent(false)}
            />
          </View>
          <View className="flex-1">
            <Button
              label={t('usage.consentAccept')}
              variant="secondary"
              onPress={() => decideConsent(true)}
            />
          </View>
        </View>
      </View>
    </View>
  );
}
