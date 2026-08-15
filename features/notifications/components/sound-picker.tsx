import * as Haptics from 'expo-haptics';
import { Check, Play, Volume2, VolumeX } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import {
  notificationSound,
  soundsByFamily,
  type NotificationSound,
  type NotificationSoundId,
} from '@/features/notifications/config/notification-sounds';
import {
  applyNotificationSound,
  previewNotificationSound,
  releaseNotificationSoundPreview,
} from '@/features/notifications/services/notification-sound';
import { useNotificationsStore } from '@/features/notifications/store/notifications-store';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * The reminder tone picker.
 *
 * ## Selecting and previewing are one gesture
 *
 * A list where the play button and the choice are separate targets makes people
 * audition a tone and then forget to pick it — and the row is already a
 * comfortable touch target, so splitting it buys nothing. Tapping a row plays it
 * *and* selects it; tapping the row you are already on replays it, which is
 * exactly what someone comparing two tones does.
 *
 * The cost is that a switch is applied on every tap, and applying one rebuilds
 * every reminder in the app (see `applyNotificationSound`). Hence the in-flight
 * state: the row being applied says so, and a second tap during a rebuild is
 * ignored rather than queued.
 *
 * ## Why it is grouped
 *
 * Forty-one rows is a wall. Within a family the tones share a voice and differ
 * by register and length, so the families are the axis somebody actually
 * navigates by: skip to Mallets if you want something dry, to Alerts if you keep
 * missing things. A flat alphabetical list would hide that entirely.
 */
export function SoundPicker() {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();
  const selectedId = useNotificationsStore((s) => s.soundId);
  const selected = notificationSound(selectedId);
  const [applying, setApplying] = useState<NotificationSoundId | null>(null);

  // The native player outlives this component unless it is told not to.
  useEffect(() => releaseNotificationSoundPreview, []);

  const choose = (sound: NotificationSound) => {
    if (applying) return;
    Haptics.selectionAsync();
    // Before the await, so the tone is heard while the rebuild runs rather than
    // after it. They are independent — the preview plays our bundled copy, the
    // rebuild re-queues notifications against the OS's.
    previewNotificationSound(sound.id);
    if (sound.id === selected.id) return;

    setApplying(sound.id);
    void applyNotificationSound(sound.id).finally(() => setApplying(null));
  };

  const describe = (sound: NotificationSound) =>
    sound.descriptionKey
      ? t(sound.descriptionKey)
      : sound.traits.map((trait) => t(`notifSound.trait.${trait}`)).join(' · ');

  return (
    <View className="gap-6">
      {soundsByFamily().map(({ family, sounds }) => (
        <View key={family} className="gap-2">
          <Text variant="caption" className="px-1 font-sora-semibold uppercase tracking-wide">
            {t(`notifSound.family.${family}`)}
          </Text>

          <View className={cardClass({ padding: 'none' }, 'px-4')}>
            {sounds.map((sound, index) => {
              const isSelected = sound.id === selected.id;
              const isApplying = applying === sound.id;
              const Icon = sound.id === 'silent' ? VolumeX : sound.preview ? Play : Volume2;

              return (
                <Pressable
                  key={sound.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected, disabled: !!applying }}
                  accessibilityLabel={`${sound.labelKey ? t(sound.labelKey) : sound.name}. ${describe(sound)}`}
                  onPress={() => choose(sound)}
                  className={
                    index === 0
                      ? 'flex-row items-center gap-3 py-3.5'
                      : 'flex-row items-center gap-3 border-t border-border py-3.5'
                  }
                >
                  <View
                    className="h-9 w-9 items-center justify-center rounded-xl"
                    style={{ backgroundColor: isSelected ? theme.muted : 'transparent' }}
                  >
                    <Icon size={16} color={isSelected ? theme.accent : theme.mutedForeground} />
                  </View>

                  <View className="flex-1">
                    <Text className="font-sora-medium text-foreground">
                      {sound.labelKey ? t(sound.labelKey) : sound.name}
                    </Text>
                    <Text variant="caption">{describe(sound)}</Text>
                  </View>

                  {isApplying ? (
                    <ActivityIndicator size="small" color={theme.accent} />
                  ) : isSelected ? (
                    <Check size={18} color={theme.accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      <View className="gap-1.5">
        <Text variant="caption" className="px-1">
          {t('notifSound.previewNote')}
        </Text>
        {Platform.OS === 'android' && (
          // Worth saying plainly: Android hands a channel's sound to the user the
          // moment the channel exists, so anyone who has already overridden it in
          // system settings will not hear this choice take effect and would
          // otherwise conclude the picker is broken.
          <Text variant="caption" className="px-1">
            {t('notifSound.androidNote')}
          </Text>
        )}
      </View>
    </View>
  );
}
