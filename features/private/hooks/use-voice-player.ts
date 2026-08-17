import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

import {
  materializeVoiceNote,
  purgeVoiceScratch,
  releaseVoiceNote,
} from '@/features/private/services/voice-notes';
import { usePrivateStore } from '@/features/private/store/private-store';

/**
 * Playback for one voice note bubble.
 *
 * The file is not fetched or decrypted until the first tap on play. A chat
 * screen holds dozens of these mounted at once, and materialising every one on
 * mount would download the whole history and leave a decrypted copy of all of
 * it on disk — which is the exact thing `voice-notes.ts`'s header is trying to
 * keep down to "the length of one note".
 *
 * The scratch file is deleted on unmount, and the whole scratch directory is
 * purged the moment the vault locks. That second one is not tidiness: locking
 * is the action a user takes when they want this material inaccessible, and a
 * decrypted `.m4a` surviving it would make the lock a lie.
 */
export type VoicePlayback = {
  isLoading: boolean;
  isPlaying: boolean;
  /** 0–1, for the progress bar. 0 before playback has ever started. */
  progress: number;
  /** True when the note could not be fetched or opened — offline, or this
   *  device has not redeemed the album key. */
  failed: boolean;
  toggle: () => void;
};

export function useVoicePlayer(
  messageId: string,
  remotePath: string | null,
  albumKey: Uint8Array | null,
  durationMs: number | null,
): VoicePlayback {
  const [uri, setUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const vaultKeyValue = usePrivateStore((s) => s.key);

  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  // Set when a tap arrived before the file was ready, so playback starts as
  // soon as it is rather than needing a second tap.
  const playWhenReadyRef = useRef(false);

  useEffect(() => {
    if (uri && playWhenReadyRef.current) {
      playWhenReadyRef.current = false;
      player.play();
    }
  }, [uri, player]);

  // Locking must take the decrypted files with it. This fires on every player
  // when the key clears, and `purgeVoiceScratch` is idempotent, so the
  // duplication is harmless and the alternative — one designated component
  // owning the purge — breaks whenever that component is not mounted.
  useEffect(() => {
    if (!vaultKeyValue) {
      setUri(null);
      purgeVoiceScratch();
    }
  }, [vaultKeyValue]);

  useEffect(() => {
    return () => releaseVoiceNote(messageId);
  }, [messageId]);

  const toggle = useCallback(() => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (uri) {
      // Replay from the top once it has run to the end, rather than doing
      // nothing because the playhead is already at the finish.
      if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) {
        void player.seekTo(0);
      }
      player.play();
      return;
    }
    if (!remotePath || !albumKey || isLoading) return;

    setIsLoading(true);
    setFailed(false);
    playWhenReadyRef.current = true;
    void materializeVoiceNote(messageId, remotePath, albumKey)
      .then((next) => {
        if (next) setUri(next);
        else {
          playWhenReadyRef.current = false;
          setFailed(true);
        }
      })
      .finally(() => setIsLoading(false));
  }, [status, player, uri, remotePath, albumKey, isLoading, messageId]);

  // `status.duration` is authoritative once loaded, but is 0 until then — so
  // the bubble's own recorded duration carries the bar until the file exists.
  const total = status.duration > 0 ? status.duration : (durationMs ?? 0) / 1000;
  const progress = total > 0 ? Math.min(1, status.currentTime / total) : 0;

  return {
    isLoading,
    isPlaying: status.playing,
    progress,
    failed,
    toggle,
  };
}
