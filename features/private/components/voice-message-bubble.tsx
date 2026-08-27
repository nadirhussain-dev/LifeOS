import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { AlertCircle, Pause, Play } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { useVoicePlayer } from '@/features/private/hooks/use-voice-player';
import { formatVoiceDuration } from '@/features/private/services/voice-notes';
import { alpha } from '@/lib/color';

/**
 * A voice note in the chat: play/pause, a progress bar, and its length.
 *
 * No waveform. Drawing a real one means decoding the audio to sample it, which
 * would defeat `use-voice-player.ts`'s whole point of not fetching anything
 * until the note is played — and a *fake* waveform, the usual answer, is a
 * randomised decoration that implies information it does not have.
 */
export function VoiceMessageBubble({
  messageId,
  remotePath,
  albumKey,
  durationMs,
  tint,
  onLight,
}: {
  messageId: string;
  remotePath: string | null;
  albumKey: Uint8Array | null;
  durationMs: number | null;
  tint: string;
  /** True inside your own tinted bubble. */
  onLight: boolean;
}) {
  const { t } = useTranslation();
  const { isLoading, isPlaying, progress, failed, toggle } = useVoicePlayer(
    messageId,
    remotePath,
    albumKey,
    durationMs,
  );

  const foreground = onLight ? '#ffffff' : tint;
  const track = alpha(onLight ? '#ffffff' : tint, 0.25);

  // No object yet means the upload is still in flight — the row is written
  // first on purpose (see voice-notes.ts), so this is a normal state and not
  // a broken message.
  const uploading = !remotePath;

  return (
    <View className="flex-row items-center gap-3" style={{ minWidth: 168 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? t('private.voicePause') : t('private.voicePlay')}
        accessibilityState={{ disabled: uploading || failed }}
        disabled={uploading || failed}
        onPress={toggle}
        hitSlop={8}
        className="h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: alpha(onLight ? '#ffffff' : tint, 0.2) }}
      >
        {isLoading || uploading ? (
          <ActivityIndicator size="small" color={foreground} />
        ) : failed ? (
          <AlertCircle size={16} color={foreground} />
        ) : isPlaying ? (
          <Pause size={16} color={foreground} />
        ) : (
          <Play size={16} color={foreground} />
        )}
      </Pressable>

      <View className="flex-1 gap-1.5">
        <View className="h-1 overflow-hidden rounded-full" style={{ backgroundColor: track }}>
          <View
            className="h-full rounded-full"
            style={{ width: `${Math.round(progress * 100)}%`, backgroundColor: foreground }}
          />
        </View>
        <Text variant="caption" style={{ color: onLight ? alpha('#ffffff', 0.75) : undefined }}>
          {failed
            ? t('private.voiceUnavailable')
            : uploading
              ? t('private.voiceSending')
              : formatVoiceDuration(durationMs)}
        </Text>
      </View>
    </View>
  );
}
