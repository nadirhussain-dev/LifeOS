import { useTranslation } from 'react-i18next';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Check, Languages } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { isRTL } from '@/features/settings/lib/layout-direction';
import { LANGUAGES, type Language } from '@/features/settings/store/language-store';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = {
  visible: boolean;
  current: Language;
  onClose: () => void;
  onSelect: (language: Language) => void;
};

/**
 * Language picker as a bottom sheet rather than an `Alert`.
 *
 * `Alert.alert` can't do this job: Android keeps only `buttons.slice(0, 3)`
 * (neutral/negative/positive) and silently drops the rest, so a four-language
 * list plus Cancel lost Arabic and the cancel button entirely. A sheet also
 * lets us show which language is active and warn about the restart.
 */
export function LanguageSheet({ visible, current, onClose, onSelect }: Props) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        accessibilityRole="button"
        className="flex-1"
        style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        onPress={onClose}
      >
        <View className="flex-1 justify-end">
          <Pressable
            accessibilityRole="button"
            onPress={(e) => e.stopPropagation()}
            style={{ paddingBottom: insets.bottom + 12 }}
            className="gap-1 rounded-t-3xl bg-card px-5 pt-3"
          >
            <View
              className="mb-1 h-1 w-10 self-center rounded-full"
              style={{ backgroundColor: colors[scheme].border }}
            />
            <View className="flex-row items-center gap-2 pb-1">
              <Languages size={18} color={colors[scheme].accent} />
              <Text variant="subheading">{t('settings.language')}</Text>
            </View>

            {LANGUAGES.map((language, index) => {
              const selected = language === current;
              return (
                <Pressable
                  key={language}
                  onPress={() => onSelect(language)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  className={
                    index === 0
                      ? 'flex-row items-center justify-between py-3.5'
                      : 'flex-row items-center justify-between border-t border-border py-3.5'
                  }
                >
                  <Text
                    className={selected ? 'font-sora-semibold text-foreground' : 'text-foreground'}
                  >
                    {t(`language.${language}`)}
                  </Text>
                  {selected ? <Check size={18} color={colors[scheme].accent} /> : null}
                </Pressable>
              );
            })}

            {/* Only Urdu/Arabic flip the layout, and only that needs a restart. */}
            {!isRTL(current) ? (
              <Text variant="caption" className="pt-2">
                {t('settings.rtlRestartNote')}
              </Text>
            ) : null}
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
