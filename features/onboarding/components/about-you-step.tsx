import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { StepScaffold } from '@/features/onboarding/components/step-scaffold';
import { GENDER_OPTIONS } from '@/features/profile/constants';
import type { Gender } from '@/features/profile/store/profile-store';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';

/**
 * Name and, optionally, gender — on one screen.
 *
 * They were two consecutive steps. Splitting them made the flow longer without
 * making either question easier, and it put a gender question on its own
 * full-screen pedestal two taps into a productivity app, which is a good way to
 * be closed. Together they read as one short "about you" card, and the optional
 * one is visibly optional.
 *
 * The name field is prefilled from the account when there is one: somebody who
 * has just signed in with Google has already told us their name, and asking
 * again is the app not paying attention.
 */
export function AboutYouStep({
  name,
  onChangeName,
  gender,
  onChangeGender,
  onNext,
}: {
  name: string;
  onChangeName: (name: string) => void;
  gender: Gender | null;
  onChangeGender: (gender: Gender | null) => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const { c } = useTheme();

  return (
    <StepScaffold
      scroll
      eyebrow={t('onboarding.aboutYou')}
      title={t('onboarding.whatToCallYou')}
      body={t('onboarding.nameHint')}
      footer={
        <Button
          variant="accent"
          size="lg"
          label={t('common.continue')}
          disabled={!name.trim()}
          onPress={onNext}
        />
      }
    >
      <View className="gap-7">
        <TextInput
          value={name}
          onChangeText={onChangeName}
          accessibilityLabel={t('onboarding.yourName')}
          placeholder={t('onboarding.yourName')}
          placeholderTextColor={c.mutedForeground}
          autoFocus={!name}
          autoCapitalize="words"
          autoComplete="name"
          returnKeyType="done"
          onSubmitEditing={() => name.trim() && onNext()}
          className={cardClass({ padding: 'none' }, 'px-4 py-4 text-lg text-foreground')}
          style={{ fontFamily: 'Sora_400Regular' }}
        />

        <View className="gap-3">
          <View className="gap-1">
            <View className="flex-row items-baseline gap-2">
              <Text className="font-sora-semibold text-foreground">
                {t('onboarding.genderQuestion')}
              </Text>
              <Text variant="caption">{t('common.optional')}</Text>
            </View>
            {/* Says what it is for. An app asking this without a reason is an
                app people close — and the reason is small and honest, so it
                costs nothing to state. */}
            <Text variant="caption">{t('onboarding.genderWhy')}</Text>
          </View>

          <View className="flex-row flex-wrap gap-2">
            {GENDER_OPTIONS.map((option) => {
              const selected = gender === option.id;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  key={option.id}
                  onPress={() => onChangeGender(selected ? null : option.id)}
                  className="rounded-full border px-4 py-2.5"
                  style={{
                    borderColor: selected ? c.accent : c.border,
                    backgroundColor: selected ? alpha(c.accent, 0.12) : 'transparent',
                  }}
                >
                  <Text
                    className="font-sora-medium"
                    style={{ color: selected ? c.accent : c.foreground }}
                  >
                    {t(option.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </StepScaffold>
  );
}
