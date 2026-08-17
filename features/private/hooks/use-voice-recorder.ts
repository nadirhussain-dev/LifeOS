import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';

import { MAX_VOICE_DURATION_MS } from '@/features/private/services/voice-notes';
import { reportError } from '@/lib/error-reporting';

/**
 * Recording one voice note, as the composer needs it.
 *
 * `RecordingPresets.HIGH_QUALITY` — .m4a, 44.1kHz, 128kbps — chosen to match
 * the `.m4a` extension `voice-notes.ts` writes its scratch file with. The two
 * have to agree: both platforms pick a decoder from the extension, so a preset
 * change here is a change there.
 *
 * ## The audio mode is put back
 *
 * `allowsRecording: true` is what lets the microphone open, and on iOS it also
 * routes playback to the earpiece rather than the speaker. Leaving it on after
 * a recording means the next voice note the user *plays* comes out of the
 * earpiece at a volume they have to hold the phone to their head to hear,
 * which reads as a broken player rather than as a lingering audio mode. So it
 * is set false again on stop, on cancel, and on unmount — including when the
 * stop itself threw, which is why the reset is in a `finally`.
 */
export type VoiceRecorderState = {
  isRecording: boolean;
  durationMs: number;
  /** Null until asked for. False means the OS said no and the composer should
   *  say so rather than silently doing nothing. */
  hasPermission: boolean | null;
  start: () => Promise<boolean>;
  /** Resolves with the recorded file's URI, or null if nothing usable was
   *  captured. */
  stop: () => Promise<{ uri: string; durationMs: number } | null>;
  /** Stops and discards. Used by the composer's cancel gesture. */
  cancel: () => Promise<void>;
};

export function useVoiceRecorder(): VoiceRecorderState {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  // The recorder's own duration resets on stop, so the last observed value is
  // captured as it runs — otherwise every note is sent as 0ms long.
  const lastDurationRef = useRef(0);

  useEffect(() => {
    if (state.isRecording) lastDurationRef.current = state.durationMillis;
  }, [state.isRecording, state.durationMillis]);

  const restoreAudioMode = useCallback(async () => {
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    } catch (error) {
      reportError(error, { scope: 'voice-recorder:mode' });
    }
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      setHasPermission(permission.granted);
      if (!permission.granted) return false;

      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      lastDurationRef.current = 0;
      recorder.record();
      return true;
    } catch (error) {
      reportError(error, { scope: 'voice-recorder:start' });
      await restoreAudioMode();
      return false;
    }
  }, [recorder, restoreAudioMode]);

  const stop = useCallback(async () => {
    try {
      await recorder.stop();
      const uri = recorder.uri;
      const durationMs = Math.min(lastDurationRef.current, MAX_VOICE_DURATION_MS);
      // A tap that registered as a press-and-hold produces a file of silence;
      // below a second is not a message anybody meant to send.
      if (!uri || durationMs < 1000) return null;
      return { uri, durationMs };
    } catch (error) {
      reportError(error, { scope: 'voice-recorder:stop' });
      return null;
    } finally {
      await restoreAudioMode();
    }
  }, [recorder, restoreAudioMode]);

  const cancel = useCallback(async () => {
    try {
      if (state.isRecording) await recorder.stop();
    } catch (error) {
      reportError(error, { scope: 'voice-recorder:cancel' });
    } finally {
      lastDurationRef.current = 0;
      await restoreAudioMode();
    }
  }, [recorder, state.isRecording, restoreAudioMode]);

  useEffect(() => {
    return () => {
      void restoreAudioMode();
    };
  }, [restoreAudioMode]);

  return {
    isRecording: state.isRecording,
    durationMs: state.isRecording ? state.durationMillis : lastDurationRef.current,
    hasPermission,
    start,
    stop,
    cancel,
  };
}
