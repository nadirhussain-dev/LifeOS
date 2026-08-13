import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { AppState, type AppStateStatus } from 'react-native';

import { recordSongPlayed } from '@/features/music/services/songs-repository';
import { usePlayerStore } from '@/features/music/store/player-store';
import { usePlayerUiStore } from '@/features/music/store/player-ui-store';
import type { RepeatMode, Song } from '@/features/music/types/music.types';
import { queryClient } from '@/lib/query-client';

let player: AudioPlayer | null = null;
let audioModeConfigured = false;
let lockScreenActive = false;

function shuffleFrom<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function ensurePlayer(): AudioPlayer {
  if (player) return player;

  player = createAudioPlayer(undefined, { updateInterval: 500 });
  player.addListener('playbackStatusUpdate', (status) => {
    usePlayerStore
      .getState()
      .setPlaybackState(
        status.playing,
        Math.round(status.currentTime * 1000),
        Math.round((status.duration || 0) * 1000),
      );
    // Backstop, not the mechanism — see enforceSleepTimer.
    enforceSleepTimer();
    if (status.didJustFinish) handleTrackFinished();
  });
  return player;
}

// ---------------------------------------------------------------------------
// Sleep timer
//
// The deadline is enforced three ways, because no single one of them holds in
// every state the phone can be in:
//
//  1. A real setTimeout armed for the deadline. This is the mechanism. It fires
//     on the dot whether or not audio is still producing status events.
//  2. A re-check whenever the app returns to the foreground. Android and iOS both
//     throttle (and, once the process is suspended, stop) JS timers in the
//     background, so a timer armed for 45 minutes' time may come due late or not
//     at all — the deadline is a wall-clock timestamp precisely so a late check
//     still reaches the right verdict.
//  3. A re-check on every playback-status event, which is what the original
//     implementation relied on alone. It's kept as a cheap extra net.
//
// (1) is the fix: relying only on (3) meant the timer could not fire unless the
// native player happened to still be emitting — so pausing, a stalled buffer, or
// a suspended JS thread all left the music playing straight past the deadline.
// ---------------------------------------------------------------------------

let sleepTimerEndsAt: number | null = null;
let sleepTimerHandle: ReturnType<typeof setTimeout> | null = null;
let appStateSubscription: { remove: () => void } | null = null;

/** Pauses playback if the armed deadline has passed. Idempotent. */
function enforceSleepTimer() {
  if (sleepTimerEndsAt == null) return;
  if (Date.now() < sleepTimerEndsAt) return;
  clearSleepTimer();
  player?.pause();
}

function clearSleepTimer() {
  sleepTimerEndsAt = null;
  if (sleepTimerHandle) {
    clearTimeout(sleepTimerHandle);
    sleepTimerHandle = null;
  }
  appStateSubscription?.remove();
  appStateSubscription = null;
  usePlayerStore.getState().setSleepTimerEndsAt(null);
}

function handleAppStateChange(state: AppStateStatus) {
  if (state === 'active') enforceSleepTimer();
}

/** Arms (minutes > 0) or cancels (null) the sleep timer. */
export function setSleepTimer(minutes: number | null) {
  // Always tear down first so re-arming can't leave an orphaned timer that
  // pauses playback at the previous deadline.
  clearSleepTimer();
  if (!minutes) return;

  const endsAt = Date.now() + minutes * 60_000;
  sleepTimerEndsAt = endsAt;
  usePlayerStore.getState().setSleepTimerEndsAt(endsAt);

  sleepTimerHandle = setTimeout(
    () => {
      sleepTimerHandle = null;
      enforceSleepTimer();
    },
    Math.max(0, endsAt - Date.now()),
  );
  appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
}

async function configureAudioMode() {
  if (audioModeConfigured) return;
  audioModeConfigured = true;
  // 'doNotMix' matches how a dedicated music player is expected to behave —
  // it takes over audio focus rather than layering under whatever else is playing.
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
  });
}

function loadIndex(index: number, autoplay: boolean) {
  const { queue } = usePlayerStore.getState();
  const song = queue[index];
  // `playQueue` keeps unplayable songs out of the queue; this is the backstop
  // for any other path in. `replace('')` puts the native player into an error
  // state it does not recover from.
  if (!song || !isPlayable(song)) return;

  const p = ensurePlayer();
  usePlayerStore.getState().setIndex(index);
  p.replace(song.uri);

  // Drive the OS lock-screen / notification now-playing surface. expo-audio
  // wires play/pause + seek to this player natively; next/previous aren't
  // remote-controllable through expo-audio, so we expose seek as the scrub
  // affordance there and keep next/prev to the in-app controls.
  const metadata = { title: song.title, artist: song.artist ?? undefined };
  if (lockScreenActive) {
    p.updateLockScreenMetadata(metadata);
  } else {
    p.setActiveForLockScreen(true, metadata, { showSeekForward: true, showSeekBackward: true });
    lockScreenActive = true;
  }

  if (autoplay) p.play();

  // A "play" is "this track just loaded into the player" — matches every
  // call site here (queue start, next/previous, finished-track advance,
  // jump-to-index), and needs no separate autoplay check since none of them
  // ever pass autoplay: false today.
  recordSongPlayed(song.id);
  void queryClient.invalidateQueries({ queryKey: ['music', 'songs'] });
}

function handleTrackFinished() {
  const { repeatMode, currentIndex, queue } = usePlayerStore.getState();
  if (repeatMode === 'one') {
    player?.seekTo(0);
    player?.play();
    return;
  }

  const isLast = currentIndex >= queue.length - 1;
  if (isLast && repeatMode !== 'all') {
    player?.pause();
    player?.seekTo(0);
    return;
  }
  loadIndex(isLast ? 0 : currentIndex + 1, true);
}

// Keeps the requested starting song first, shuffles everything after it.
function shuffleAround(songs: Song[], startIndex: number): Song[] {
  const start = songs[startIndex];
  const rest = songs.filter((_, i) => i !== startIndex);
  return [start, ...shuffleFrom(rest)];
}

/** Starts playing `songs` as a fresh queue beginning at `startIndex` —
 * called whenever a screen taps a song to play (library, playlist detail). */
export async function playQueue(songs: Song[], startIndex: number) {
  // Songs sync as rows; the audio files do not. A song pulled from another
  // device has an empty `uri` and nothing to play, so it is filtered out here
  // rather than at every call site — the queue is the one place that has to be
  // certain every entry can actually be loaded. Skipping the index forward
  // keeps the tapped song playing when the ones before it were unavailable.
  const requested = songs[startIndex];
  const playable = songs.filter(isPlayable);
  if (playable.length === 0) return;
  const index = requested && isPlayable(requested) ? playable.indexOf(requested) : 0;

  await configureAudioMode();
  // A dismissed bar comes back as soon as something new starts playing.
  usePlayerUiStore.getState().setHidden(false);

  const { shuffle } = usePlayerStore.getState();
  const queue = shuffle ? shuffleAround(playable, index) : playable;
  const newIndex = shuffle ? 0 : index;
  usePlayerStore.getState().setQueue(playable, queue, newIndex);
  loadIndex(newIndex, true);
}

/** Whether this device holds the audio file — see `isOnThisDevice` in the
 * gallery for the same idea on the other media module. */
export function isPlayable(song: Song): boolean {
  return song.uri.length > 0;
}

/** Turns shuffle on and plays the whole set from a random starting point —
 * backs the library's "Shuffle all" button. */
export async function shuffleAll(songs: Song[]) {
  if (songs.length === 0) return;
  usePlayerStore.getState().setShuffle(true);
  await playQueue(songs, Math.floor(Math.random() * songs.length));
}

/** Jumps straight to a track in the current queue — backs tapping a row in the
 * "Up Next" list. */
export function jumpToIndex(index: number) {
  const { queue } = usePlayerStore.getState();
  if (index < 0 || index >= queue.length) return;
  loadIndex(index, true);
}

export function togglePlayPause() {
  if (usePlayerStore.getState().currentIndex < 0) return;
  const p = ensurePlayer();
  if (p.playing) p.pause();
  else p.play();
}

export function playNext() {
  const { currentIndex, queue, repeatMode } = usePlayerStore.getState();
  if (queue.length === 0) return;
  const isLast = currentIndex >= queue.length - 1;
  if (isLast && repeatMode !== 'all') return;
  loadIndex(isLast ? 0 : currentIndex + 1, true);
}

/** Jumps to the previous track, unless we're more than 3s into the current
 * one — then it restarts the current track instead, matching how most music
 * players treat "previous." */
export function playPrevious() {
  const { currentIndex, positionMs, queue } = usePlayerStore.getState();
  if (queue.length === 0) return;

  if (positionMs > 3000) {
    player?.seekTo(0);
    return;
  }
  const prevIndex = currentIndex <= 0 ? queue.length - 1 : currentIndex - 1;
  loadIndex(prevIndex, true);
}

export function seekTo(seconds: number) {
  player?.seekTo(seconds);
}

/** Dismisses playback entirely — stops audio, tears down the lock-screen
 * controls, releases the native player, and clears the queue. Backs the
 * mini-player's swipe-to-dismiss / close action. */
export function clearPlayer() {
  usePlayerUiStore.getState().setHidden(false);
  // Pause FIRST so audio actually stops immediately — releasing the native
  // player without pausing can leave the current buffer playing out (and the
  // only way to stop it becomes the OS media widget).
  try {
    player?.pause();
  } catch {
    // no-op
  }
  try {
    player?.clearLockScreenControls();
  } catch {
    // no-op if never activated
  }
  try {
    player?.remove();
  } catch {
    // best-effort release
  }
  player = null;
  lockScreenActive = false;
  clearSleepTimer();
  usePlayerStore.getState().clear();
}

/** Pauses playback if anything is playing, and reports whether it did.
 *
 * Used by study Focus Mode, which must not leave music running into a focus
 * block. Deliberately only pauses: the queue, position and lock-screen controls
 * all survive, so the user can pick the track back up after the session rather
 * than having to find it again. */
export function pauseForFocus(): boolean {
  if (!player?.playing) return false;
  player.pause();
  return true;
}

export function setRepeatMode(mode: RepeatMode) {
  usePlayerStore.getState().setRepeatMode(mode);
}

export function toggleShuffle() {
  const { shuffle, queue, originalQueue, currentIndex } = usePlayerStore.getState();
  const nextShuffle = !shuffle;
  usePlayerStore.getState().setShuffle(nextShuffle);

  const activeSong = queue[currentIndex];
  if (!activeSong) return;

  if (nextShuffle) {
    const rest = queue.filter((_, i) => i !== currentIndex);
    usePlayerStore.getState().setQueue(originalQueue, [activeSong, ...shuffleFrom(rest)], 0);
  } else {
    const restoredIndex = Math.max(
      0,
      originalQueue.findIndex((song) => song.id === activeSong.id),
    );
    usePlayerStore.getState().setQueue(originalQueue, originalQueue, restoredIndex);
  }
}
