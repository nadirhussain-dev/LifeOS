/**
 * The tones a Daykeep reminder can arrive with, and the two platform shapes each
 * one has to be expressed in.
 *
 * ## Why the sound is one app-wide choice
 *
 * On Android 8+ a notification's sound is a property of its **channel**, not of
 * the notification — `content.sound` is ignored. So every distinct sound the app
 * can make costs a channel, and channels are user-visible: they are the list
 * somebody scrolls in system settings. With this many tones, per-category sounds
 * would mean hundreds of potential channels and an app that buries the Android
 * notification screen under its own bookkeeping.
 *
 * One choice, applied to the three urgency channels the app already had, keeps
 * that list the same length it is today (see `channelIdFor` in lib/notifications)
 * no matter how far the library grows.
 *
 * ## Why a channel cannot simply be re-tuned
 *
 * `setNotificationChannelAsync` is a create, not an upsert: on a channel that
 * already exists Android updates the name and description and *silently
 * discards* sound, importance and vibration, because those become the user's
 * settings the moment the channel appears. Changing the tone therefore means
 * creating channels under new ids and deleting the old ones, which is why the
 * sound id is part of every channel id.
 *
 * ## Why the names are not translated
 *
 * A tone's name is a label for a thing, like a paint colour — "Vesper" is not a
 * claim about vespers, and translating it produces a different word in every
 * language for a sound that is identical in all of them. What IS translated is
 * the pair of traits under each name, which is the part that actually helps
 * somebody choose. Two words from a fixed vocabulary of fifteen, rather than
 * thirty-nine hand-written sentences per locale — the same information, at a
 * fraction of the surface where a translation can go stale or wrong.
 *
 * ## The files
 *
 * Synthesised by `scripts/generate-notification-sounds.mjs` — see its header for
 * the voice model and why they are generated rather than licensed. They reach
 * the OS two different ways and both are needed:
 *
 *  - **Bundled natively** by the expo-notifications config plugin (`sounds` in
 *    app.json), which copies them to `res/raw` on Android and into the app
 *    bundle on iOS. This is the copy the OS plays, and it is referenced by bare
 *    filename. It only exists in a native build made after the plugin entry was
 *    added — in Expo Go, and on any older binary, the OS falls back to the
 *    default tone.
 *  - **Bundled by Metro** via the `require`s below, which is a completely
 *    separate copy used only by the in-app preview. Without it the picker could
 *    describe the tones but not play them.
 */

/**
 * Every tone id, as a union.
 *
 * Spelled out rather than widened to `string`, following the same convention as
 * `NotificationCategory`: the ids are written into a persisted store and into
 * Android channel ids, so a typo is a silent, durable wrong answer rather than a
 * crash. The companion runtime list is `NOTIFICATION_SOUNDS` below, and the test
 * beside this file asserts the two never drift apart.
 */
export type NotificationSoundId =
  | 'chime'
  | 'halo'
  | 'ember'
  | 'filament'
  | 'carillon'
  | 'vesper'
  | 'beacon'
  | 'ripple'
  | 'tumble'
  | 'lattice'
  | 'bamboo'
  | 'pebble'
  | 'thimble'
  | 'bloom'
  | 'prism'
  | 'frost'
  | 'lantern'
  | 'aurora'
  | 'nimbus'
  | 'amber'
  | 'thread'
  | 'lyre'
  | 'quill'
  | 'wool'
  | 'reed'
  | 'pulse'
  | 'ping'
  | 'relay'
  | 'console'
  | 'ledger'
  | 'telegraph'
  | 'droplet'
  | 'skyward'
  | 'swoop'
  | 'bubble'
  | 'kite'
  | 'sentry'
  | 'cascade'
  | 'summit'
  | 'system'
  | 'silent';

/** The sections the picker renders, in order. Grouping is what makes a library
 *  this size browsable — within a family the tones share a voice and differ by
 *  register, interval and length, so each family reads as a set. */
export const SOUND_FAMILIES = [
  'bells',
  'mallets',
  'glass',
  'keys',
  'digital',
  'motion',
  'alerts',
  'system',
] as const;
export type SoundFamily = (typeof SOUND_FAMILIES)[number];

/** The fixed vocabulary the two-word descriptions are drawn from. Deliberately
 *  small: fifteen words translate well, thirty-nine sentences do not. */
export const SOUND_TRAITS = [
  'bright',
  'warm',
  'soft',
  'dry',
  'deep',
  'airy',
  'quick',
  'lingering',
  'metallic',
  'wooden',
  'glassy',
  'plucked',
  'digital',
  'sweeping',
  'insistent',
] as const;
export type SoundTrait = (typeof SOUND_TRAITS)[number];

export type NotificationSound = {
  id: NotificationSoundId;
  /** Display name. A proper noun — see the header for why it is not an i18n key. */
  name: string;
  family: SoundFamily;
  traits: SoundTrait[];
  /**
   * What the OS is told to play.
   *
   * `'default'` is the platform's own notification sound, a bare filename is one
   * of ours, and `null` means no sound at all — the notification still posts to
   * the shade and still vibrates, it just does not make a noise.
   */
  file: string | null;
  /** Metro asset for the in-app preview, or null when there is nothing of ours
   *  to play (the system tone belongs to the OS; silence has nothing to hear). */
  preview: number | null;
  /** Set for the two entries whose names are words rather than labels, and
   *  which therefore do get translated — along with a description, since they
   *  have no traits to describe them. */
  labelKey?: string;
  descriptionKey?: string;
};

/** One row of the table below. The filename is derived from the id rather than
 *  repeated, which is what keeps the registry and `assets/sounds/` in step. */
function tone(
  id: NotificationSoundId,
  name: string,
  family: SoundFamily,
  traits: SoundTrait[],
  preview: number,
): NotificationSound {
  return { id, name, family, traits, file: `daykeep_${id}.wav`, preview };
}

/* The `require`s are deliberate and have no import equivalent: Metro resolves an
 * asset `require` at bundle time into the numeric module id that expo-audio
 * takes as a source. */
export const NOTIFICATION_SOUNDS: NotificationSound[] = [
  // Bells — struck metal, the register most notification tones live in.
  tone(
    'chime',
    'Chime',
    'bells',
    ['bright', 'lingering'],
    require('@/assets/sounds/daykeep_chime.wav'),
  ),
  tone('halo', 'Halo', 'bells', ['bright', 'airy'], require('@/assets/sounds/daykeep_halo.wav')),
  tone(
    'ember',
    'Ember',
    'bells',
    ['warm', 'metallic'],
    require('@/assets/sounds/daykeep_ember.wav'),
  ),
  tone(
    'filament',
    'Filament',
    'bells',
    ['bright', 'metallic'],
    require('@/assets/sounds/daykeep_filament.wav'),
  ),
  tone(
    'carillon',
    'Carillon',
    'bells',
    ['metallic', 'lingering'],
    require('@/assets/sounds/daykeep_carillon.wav'),
  ),
  tone(
    'vesper',
    'Vesper',
    'bells',
    ['deep', 'lingering'],
    require('@/assets/sounds/daykeep_vesper.wav'),
  ),
  tone(
    'beacon',
    'Beacon',
    'bells',
    ['deep', 'lingering'],
    require('@/assets/sounds/daykeep_beacon.wav'),
  ),

  // Mallets — tuned bars. Fast and dry; the least intrusive family.
  tone(
    'ripple',
    'Ripple',
    'mallets',
    ['wooden', 'quick'],
    require('@/assets/sounds/daykeep_ripple.wav'),
  ),
  tone(
    'tumble',
    'Tumble',
    'mallets',
    ['wooden', 'quick'],
    require('@/assets/sounds/daykeep_tumble.wav'),
  ),
  tone(
    'lattice',
    'Lattice',
    'mallets',
    ['bright', 'wooden'],
    require('@/assets/sounds/daykeep_lattice.wav'),
  ),
  tone(
    'bamboo',
    'Bamboo',
    'mallets',
    ['warm', 'wooden'],
    require('@/assets/sounds/daykeep_bamboo.wav'),
  ),
  tone(
    'pebble',
    'Pebble',
    'mallets',
    ['dry', 'quick'],
    require('@/assets/sounds/daykeep_pebble.wav'),
  ),
  tone(
    'thimble',
    'Thimble',
    'mallets',
    ['dry', 'quick'],
    require('@/assets/sounds/daykeep_thimble.wav'),
  ),

  // Glass & air — slow, pure, the softest family.
  tone(
    'bloom',
    'Bloom',
    'glass',
    ['glassy', 'lingering'],
    require('@/assets/sounds/daykeep_bloom.wav'),
  ),
  tone(
    'prism',
    'Prism',
    'glass',
    ['bright', 'glassy'],
    require('@/assets/sounds/daykeep_prism.wav'),
  ),
  tone('frost', 'Frost', 'glass', ['bright', 'airy'], require('@/assets/sounds/daykeep_frost.wav')),
  tone(
    'lantern',
    'Lantern',
    'glass',
    ['soft', 'glassy'],
    require('@/assets/sounds/daykeep_lantern.wav'),
  ),
  tone(
    'aurora',
    'Aurora',
    'glass',
    ['soft', 'lingering'],
    require('@/assets/sounds/daykeep_aurora.wav'),
  ),
  tone(
    'nimbus',
    'Nimbus',
    'glass',
    ['soft', 'airy'],
    require('@/assets/sounds/daykeep_nimbus.wav'),
  ),

  // Keys & strings — plucked and struck. Warmer, more human.
  tone('amber', 'Amber', 'keys', ['warm', 'plucked'], require('@/assets/sounds/daykeep_amber.wav')),
  tone(
    'thread',
    'Thread',
    'keys',
    ['plucked', 'quick'],
    require('@/assets/sounds/daykeep_thread.wav'),
  ),
  tone(
    'lyre',
    'Lyre',
    'keys',
    ['plucked', 'lingering'],
    require('@/assets/sounds/daykeep_lyre.wav'),
  ),
  tone(
    'quill',
    'Quill',
    'keys',
    ['plucked', 'sweeping'],
    require('@/assets/sounds/daykeep_quill.wav'),
  ),
  tone('wool', 'Wool', 'keys', ['soft', 'warm'], require('@/assets/sounds/daykeep_wool.wav')),
  tone('reed', 'Reed', 'keys', ['warm', 'airy'], require('@/assets/sounds/daykeep_reed.wav')),

  // Digital — dry and deliberate, with no pretence of being an instrument.
  tone(
    'pulse',
    'Pulse',
    'digital',
    ['digital', 'dry'],
    require('@/assets/sounds/daykeep_pulse.wav'),
  ),
  tone(
    'ping',
    'Ping',
    'digital',
    ['digital', 'quick'],
    require('@/assets/sounds/daykeep_ping.wav'),
  ),
  tone(
    'relay',
    'Relay',
    'digital',
    ['digital', 'bright'],
    require('@/assets/sounds/daykeep_relay.wav'),
  ),
  tone(
    'console',
    'Console',
    'digital',
    ['digital', 'dry'],
    require('@/assets/sounds/daykeep_console.wav'),
  ),
  tone(
    'ledger',
    'Ledger',
    'digital',
    ['digital', 'deep'],
    require('@/assets/sounds/daykeep_ledger.wav'),
  ),
  tone(
    'telegraph',
    'Telegraph',
    'digital',
    ['digital', 'insistent'],
    require('@/assets/sounds/daykeep_telegraph.wav'),
  ),

  // Motion — the only family whose pitch moves.
  tone(
    'droplet',
    'Droplet',
    'motion',
    ['sweeping', 'soft'],
    require('@/assets/sounds/daykeep_droplet.wav'),
  ),
  tone(
    'skyward',
    'Skyward',
    'motion',
    ['sweeping', 'bright'],
    require('@/assets/sounds/daykeep_skyward.wav'),
  ),
  tone(
    'swoop',
    'Swoop',
    'motion',
    ['sweeping', 'quick'],
    require('@/assets/sounds/daykeep_swoop.wav'),
  ),
  tone(
    'bubble',
    'Bubble',
    'motion',
    ['sweeping', 'bright'],
    require('@/assets/sounds/daykeep_bubble.wav'),
  ),
  tone('kite', 'Kite', 'motion', ['sweeping', 'airy'], require('@/assets/sounds/daykeep_kite.wav')),

  // Alerts — for when the phone needs to insist.
  tone(
    'sentry',
    'Sentry',
    'alerts',
    ['insistent', 'digital'],
    require('@/assets/sounds/daykeep_sentry.wav'),
  ),
  tone(
    'cascade',
    'Cascade',
    'alerts',
    ['insistent', 'metallic'],
    require('@/assets/sounds/daykeep_cascade.wav'),
  ),
  tone(
    'summit',
    'Summit',
    'alerts',
    ['insistent', 'deep'],
    require('@/assets/sounds/daykeep_summit.wav'),
  ),

  // Neither of these is a tone of ours, so neither has a name to keep — these
  // two are words, and they are translated.
  {
    id: 'system',
    name: 'System default',
    labelKey: 'notifSound.systemLabel',
    descriptionKey: 'notifSound.systemDescription',
    family: 'system',
    traits: [],
    file: 'default',
    preview: null,
  },
  {
    id: 'silent',
    name: 'Silent',
    labelKey: 'notifSound.silentLabel',
    descriptionKey: 'notifSound.silentDescription',
    family: 'system',
    traits: [],
    file: null,
    preview: null,
  },
];

/** The app's own voice, and the default for a fresh install. `system` is one tap
 *  away for anyone who would rather every app on their phone sound alike. */
export const DEFAULT_NOTIFICATION_SOUND_ID: NotificationSoundId = 'chime';

const BY_ID = new Map(NOTIFICATION_SOUNDS.map((sound) => [sound.id, sound]));

/** The library grouped for display, in `SOUND_FAMILIES` order, skipping any
 *  family that happens to be empty. */
export function soundsByFamily(): { family: SoundFamily; sounds: NotificationSound[] }[] {
  return SOUND_FAMILIES.map((family) => ({
    family,
    sounds: NOTIFICATION_SOUNDS.filter((sound) => sound.family === family),
  })).filter((group) => group.sounds.length > 0);
}

/**
 * Resolves a stored id to a real sound, falling back to the default.
 *
 * The id is persisted, so it outlives the release that wrote it: a tone dropped
 * in a later version would otherwise leave that install with a channel sound of
 * `undefined`, which on Android means a channel that makes no noise and no way
 * for the user to work out why.
 */
export function notificationSound(id: NotificationSoundId | undefined | null): NotificationSound {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_NOTIFICATION_SOUND_ID)!;
}

/** What `setNotificationChannelAsync` wants: a filename, `'default'`, or null
 *  for a silent channel. */
export function channelSoundFor(id: NotificationSoundId): string | null {
  return notificationSound(id).file;
}

/**
 * What a notification's `content.sound` wants.
 *
 * This is the field iOS actually plays, and the one Android 7 and below uses.
 * `false` is expo's spelling of "no sound"; `null` is not accepted there, which
 * is the one place the two platform shapes genuinely differ.
 */
export function contentSoundFor(id: NotificationSoundId): string | boolean {
  const file = notificationSound(id).file;
  return file === null ? false : file;
}
