import { LinearGradient } from 'expo-linear-gradient';
import { Leaf } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { StepScaffold } from '@/features/onboarding/components/step-scaffold';
import { accentGradient } from '@/constants/design-tokens';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { alpha, glowShadow } from '@/lib/color';

/**
 * The first screen of the app — and now genuinely the first, where it used to
 * sit behind a sign-in form.
 *
 * It asks for nothing. The only job of this screen is to be worth the next tap,
 * and an app that opens with a credentials form has spent its first impression
 * on a chore. The sign-in link is for the returning user reinstalling, who
 * should not have to walk through a welcome to reach their own account.
 */
export function WelcomeStep({ onNext, onSignIn }: { onNext: () => void; onSignIn: () => void }) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const reducedMotion = useReducedMotion();

  return (
    <StepScaffold
      hero
      title={t('onboarding.welcomeTitle')}
      body={t('onboarding.welcomeBody')}
      above={
        <Animated.View
          entering={reducedMotion ? undefined : FadeInDown.duration(420)}
          style={[
            {
              height: 76,
              width: 76,
              borderRadius: 26,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
            },
            glowShadow(accentGradient[0], 0.4),
          ]}
        >
          <LinearGradient
            colors={accentGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ position: 'absolute', inset: 0 }}
          />
          <Leaf size={36} color={c.accentForeground} strokeWidth={2} />
        </Animated.View>
      }
      footer={
        <>
          <Button variant="accent" size="lg" label={t('onboarding.getStarted')} onPress={onNext} />
          <Pressable
            accessibilityRole="button"
            onPress={onSignIn}
            className="items-center py-2.5"
            hitSlop={8}
          >
            <Text variant="muted">
              {t('onboarding.haveAccount')}{' '}
              <Text className="font-sora-semibold text-accent">{t('auth.signIn')}</Text>
            </Text>
          </Pressable>
        </>
      }
    >
      {/* Three strokes in the accent gradient, closing the screen. Not a
          decoration for its own sake — it is the same gradient the primary
          button below uses, so the eye reads the two as connected before
          anybody has consciously noticed either. */}
      <Animated.View
        entering={reducedMotion ? undefined : FadeInUp.duration(520).delay(140)}
        className="flex-row gap-2"
      >
        {accentGradient.map((stop, index) => (
          <View
            key={`${stop}-${index}`}
            style={{
              height: 4,
              flex: index === 0 ? 2 : 1,
              borderRadius: 2,
              backgroundColor: alpha(stop, index === 0 ? 0.9 : 0.4),
            }}
          />
        ))}
      </Animated.View>
    </StepScaffold>
  );
}
