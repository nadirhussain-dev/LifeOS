import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import appJson from '@/app.json';
import {
  channelSoundFor,
  contentSoundFor,
  DEFAULT_NOTIFICATION_SOUND_ID,
  notificationSound,
  NOTIFICATION_SOUNDS,
  soundsByFamily,
  SOUND_FAMILIES,
  SOUND_TRAITS,
  type NotificationSoundId,
} from '@/features/notifications/config/notification-sounds';

/**
 * The reminder tone library, and the four separate places a tone has to line up
 * for a user to actually hear it.
 *
 * Every failure this guards against is silent on the developer's machine and
 * only shows up as "the notification made no sound" on somebody's phone:
 *
 *  - a file in the registry that was never generated,
 *  - a generated file that was never added to app.json, so it is not in the
 *    native build and Android falls back to the default tone,
 *  - a filename Android's `res/raw` rejects, which fails the native build
 *    rather than the JS bundle,
 *  - and the two platform spellings of "no sound", which are not the same value.
 *
 * The audio itself is checked too. Nothing here can tell whether a tone sounds
 * *good* — that needs ears — but it can tell that every tone is real audio, at a
 * format both platforms accept, at the same loudness as its neighbours, and
 * distinct from all of them.
 */

const SOUNDS_DIR = join(__dirname, '..', '..', '..', 'assets', 'sounds');

/** The `sounds` array the expo-notifications config plugin bundles natively. */
const pluginSounds: string[] = (() => {
  const plugins = appJson.expo.plugins as unknown[];
  for (const entry of plugins) {
    if (Array.isArray(entry) && entry[0] === 'expo-notifications') {
      return ((entry[1] as { sounds?: string[] }).sounds ?? []).map(
        (path) => path.split('/').pop() ?? path,
      );
    }
  }
  return [];
})();

/** Sounds backed by a file of ours, as opposed to the OS tone or silence. */
const custom = NOTIFICATION_SOUNDS.filter((sound) => sound.preview !== null);

/** Parsed once — the suite reads every file several times over. */
const wavCache = new Map<string, ReturnType<typeof parseWav>>();

function parseWav(file: string) {
  const buffer = readFileSync(join(SOUNDS_DIR, file));
  const sampleCount = buffer.readUInt32LE(40) / 2;
  let peak = 0;
  let sum = 0;
  let energy = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = buffer.readInt16LE(44 + i * 2);
    peak = Math.max(peak, Math.abs(sample));
    sum += sample;
    energy += sample * sample;
  }
  return {
    riff: buffer.toString('ascii', 0, 4),
    wave: buffer.toString('ascii', 8, 12),
    format: buffer.readUInt16LE(20),
    channels: buffer.readUInt16LE(22),
    sampleRate: buffer.readUInt32LE(24),
    bitsPerSample: buffer.readUInt16LE(34),
    seconds: sampleCount / buffer.readUInt32LE(24),
    peak,
    dcOffset: sum / sampleCount,
    rms: Math.sqrt(energy / sampleCount),
    bytes: buffer.length,
    digest: createHash('sha256').update(buffer).digest('hex'),
  };
}

function wav(file: string) {
  const cached = wavCache.get(file);
  if (cached) return cached;
  const parsed = parseWav(file);
  wavCache.set(file, parsed);
  return parsed;
}

const eachTone = custom.map((sound) => [sound.id, sound.file!] as const);

describe('the tone library', () => {
  it('offers a real library rather than a token few', () => {
    expect(custom.length).toBeGreaterThanOrEqual(30);
  });

  it('has a unique id and a unique name for every tone', () => {
    const ids = NOTIFICATION_SOUNDS.map((sound) => sound.id);
    const names = NOTIFICATION_SOUNDS.map((sound) => sound.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('derives every filename from its id, so the two cannot drift', () => {
    for (const sound of custom) {
      expect(sound.file).toBe(`lifeos_${sound.id}.wav`);
    }
  });

  it('puts every tone in a known family with known traits', () => {
    for (const sound of NOTIFICATION_SOUNDS) {
      expect(SOUND_FAMILIES).toContain(sound.family);
      for (const trait of sound.traits) expect(SOUND_TRAITS).toContain(trait);
    }
  });

  it('describes every tone, one way or the other', () => {
    // Either two traits, or — for the two entries that are words rather than
    // names — an explicit description key. A row with neither is a blank line.
    for (const sound of NOTIFICATION_SOUNDS) {
      expect(sound.traits.length >= 2 || !!sound.descriptionKey).toBe(true);
    }
  });

  it('fills every family it declares', () => {
    expect(soundsByFamily().map((group) => group.family)).toEqual([...SOUND_FAMILIES]);
  });

  it('groups every tone exactly once', () => {
    const grouped = soundsByFamily().flatMap((group) => group.sounds);
    expect(grouped).toHaveLength(NOTIFICATION_SOUNDS.length);
  });

  it('offers the system tone and silence alongside ours', () => {
    const ids = NOTIFICATION_SOUNDS.map((sound) => sound.id);
    expect(ids).toContain('system');
    expect(ids).toContain('silent');
  });

  it('defaults to a tone that exists', () => {
    expect(notificationSound(DEFAULT_NOTIFICATION_SOUND_ID).id).toBe(DEFAULT_NOTIFICATION_SOUND_ID);
  });

  it('falls back to the default for an id from a version that no longer exists', () => {
    // The id is persisted, so it outlives the release that wrote it. Resolving
    // to undefined would leave the channel with no sound at all.
    expect(notificationSound('mystery' as NotificationSoundId).id).toBe(
      DEFAULT_NOTIFICATION_SOUND_ID,
    );
    expect(notificationSound(null).id).toBe(DEFAULT_NOTIFICATION_SOUND_ID);
    expect(notificationSound(undefined).id).toBe(DEFAULT_NOTIFICATION_SOUND_ID);
  });
});

describe('the two platform shapes of a tone', () => {
  it('gives Android channels a filename and iOS content the same filename', () => {
    expect(channelSoundFor('chime')).toBe('lifeos_chime.wav');
    expect(contentSoundFor('chime')).toBe('lifeos_chime.wav');
  });

  it('spells the system tone the same way in both', () => {
    expect(channelSoundFor('system')).toBe('default');
    expect(contentSoundFor('system')).toBe('default');
  });

  it('spells silence differently in each, because the APIs do', () => {
    // A channel takes `null`; notification content takes `false` and rejects
    // null. Collapsing the two is how "Silent" ends up making a noise.
    expect(channelSoundFor('silent')).toBeNull();
    expect(contentSoundFor('silent')).toBe(false);
  });

  it('never hands either API an undefined sound', () => {
    for (const sound of NOTIFICATION_SOUNDS) {
      expect(channelSoundFor(sound.id)).not.toBeUndefined();
      expect(contentSoundFor(sound.id)).not.toBeUndefined();
    }
  });
});

describe('the tone files', () => {
  it('names every file in a form Android resources accept', () => {
    // res/raw resource names are [a-z0-9_] — a hyphen or a capital fails the
    // NATIVE build, long after the JS has been checked.
    for (const sound of custom) {
      expect(sound.file).toMatch(/^[a-z0-9_]+\.wav$/);
    }
  });

  it('has a generated file on disk for every registered tone', () => {
    for (const sound of custom) {
      expect(existsSync(join(SOUNDS_DIR, sound.file!))).toBe(true);
    }
  });

  it('bundles every registered tone into the native build', () => {
    // Missing from app.json means the file is not in res/raw, and Android
    // quietly plays the default tone instead of the one the user picked.
    for (const sound of custom) {
      expect(pluginSounds).toContain(sound.file);
    }
  });

  it('registers every bundled file, so nothing ships unused', () => {
    for (const file of pluginSounds) {
      expect(custom.map((sound) => sound.file)).toContain(file);
    }
  });

  it('keeps the whole library inside a sane download budget', () => {
    // Every one of these ships in the APK and the IPA. A library is worth a few
    // megabytes; it is not worth an unbounded number, and the easiest way to
    // blow past that is to add tones without ever looking at the total.
    const megabytes = custom.reduce((sum, sound) => sum + wav(sound.file!).bytes, 0) / 1024 / 1024;
    expect(megabytes).toBeLessThan(6);
  });
});

describe('the generated audio itself', () => {
  it.each(eachTone)('%s is 16-bit mono PCM at 44.1 kHz', (_id, file) => {
    const audio = wav(file);
    expect(audio.riff).toBe('RIFF');
    expect(audio.wave).toBe('WAVE');
    expect(audio.format).toBe(1); // uncompressed PCM
    expect(audio.channels).toBe(1);
    expect(audio.sampleRate).toBe(44_100);
    expect(audio.bitsPerSample).toBe(16);
  });

  it.each(eachTone)('%s is short enough to play in a meeting', (_id, file) => {
    expect(wav(file).seconds).toBeGreaterThan(0.2);
    expect(wav(file).seconds).toBeLessThan(2.5);
  });

  it.each(eachTone)('%s is audible, level-matched and unclipped', (_id, file) => {
    const audio = wav(file);
    // Loud enough to be heard, and short of full scale so the 16-bit conversion
    // never lands on a clipped sample (which reads as a tick).
    expect(audio.peak).toBeGreaterThan(20_000);
    expect(audio.peak).toBeLessThan(32_000);
    // Every tone normalised to the same peak, so moving between them changes
    // the character of the alert and not how loud the phone gets.
    expect(audio.peak).toBe(wav(custom[0].file!).peak);
    // A DC offset is itself inaudible but thumps the speaker on start and stop.
    // The bound is 0.1% of full scale: a decaying sine always leaves a residue
    // of a few counts (its positive and negative halves are not quite equal),
    // and a real offset bug — a stuck sample, an envelope that never returns to
    // zero — is a percent-level effect, orders of magnitude above this.
    expect(Math.abs(audio.dcOffset)).toBeLessThan(32_767 * 0.001);
  });

  it.each(eachTone)('%s carries actual signal rather than near-silence', (_id, file) => {
    // Peak alone cannot catch a tone that is one loud click and then nothing —
    // normalisation would still put its peak exactly where everyone else's is.
    expect(wav(file).rms).toBeGreaterThan(1_000);
  });

  it('has no two tones that are the same audio', () => {
    // A copy-pasted row in the table that forgot to change the pitch produces a
    // picker with two identical entries and no error anywhere.
    const digests = custom.map((sound) => wav(sound.file!).digest);
    expect(new Set(digests).size).toBe(custom.length);
  });

  it('spreads the library across short and long', () => {
    // A library of thirty tones that are all 1.2 seconds is one tone with thirty
    // names. The point of the families is that they differ in kind.
    const lengths = custom.map((sound) => wav(sound.file!).seconds);
    expect(Math.min(...lengths)).toBeLessThan(0.6);
    expect(Math.max(...lengths)).toBeGreaterThan(1.5);
  });
});
