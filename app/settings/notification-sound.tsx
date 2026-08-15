import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { ScreenHeader } from '@/components/ui/screen-header';
import { moduleTints } from '@/constants/design-tokens';
import { SoundPicker } from '@/features/notifications/components/sound-picker';

/**
 * The reminder tone library, on its own screen.
 *
 * Not a section of Notification Settings, which is where it started: forty-one
 * rows in the middle of a screen that also holds the master switch, delivery
 * mode, quiet hours and fifteen category toggles buries everything below it and
 * turns every visit to that screen into a long scroll past sounds. A tone
 * library is a browse, and a browse deserves its own page — which is where every
 * platform puts it too.
 */
export default function NotificationSoundScreen() {
  const { t } = useTranslation();

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('notifSound.title')}
        eyebrow={t('notifSound.eyebrow')}
        tint={moduleTints.settings}
      />
      <ScrollView
        contentContainerClassName="gap-6 px-5 py-4 pb-12"
        showsVerticalScrollIndicator={false}
      >
        <SoundPicker />
      </ScrollView>
    </View>
  );
}
