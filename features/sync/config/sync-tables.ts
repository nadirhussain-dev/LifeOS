/**
 * Registry driving the sync engine and the per-module allow-sync toggles.
 *
 * ## What a table needs to be here
 *
 * A text key column (`id` for almost everything), a `user_id`, and an
 * `updated_at` — the engine's change-detection key. Anything the user can
 * remove also needs `deleted_at`: without it a removal cannot propagate, the
 * server keeps the row, and the next pull resurrects it on the device that
 * deleted it. The contract test in ./sync-contract.test.ts holds this line,
 * because a table missing one of these does not error — it just silently never
 * syncs, or syncs wrongly.
 *
 * ## History
 *
 * v1 synced only each module's **primary records** — your habits, your goals,
 * your subjects — and none of the history, so signing in on a second device
 * gave you your habits back with every streak at zero. 0009 added the history
 * tables. This revision adds everything that was left: tags, wiki-links,
 * per-module settings, routine and playlist membership, and media metadata.
 * The only local table that still does not sync is `notification_log`, which is
 * the device's own record of notifications it scheduled — bookkeeping about
 * this phone, not content the user wrote.
 *
 * ## Media, and what "synced" means for it
 *
 * Gallery, music and attachments sync their **rows**, not their **bytes**.
 * Albums, playlists, captions, favourites, ordering and membership all reach
 * the second device; the files themselves stay where they were imported. A
 * pulled media row has an empty `uri` and the UI shows it as not on this
 * device (see SYNC_DEVICE_LOCAL_COLUMNS and `remote_path`, which is where an
 * upload would record itself).
 *
 * The previous design excluded these tables entirely, on the reasoning that a
 * row without its file is a broken reference. That is true only if nothing
 * marks it as absent — and the cost of the exclusion was that a new phone
 * showed an empty gallery with no indication that anything had ever been in it.
 * An entry that says "not on this device" is strictly more information than no
 * entry at all.
 *
 * `sensitive` modules default to sync OFF and stay local unless the user turns
 * them on.
 */
export type SyncModule =
  | 'tasks'
  | 'notes'
  | 'habits'
  | 'journal'
  | 'calendar'
  | 'goals'
  | 'sleep'
  | 'study'
  | 'budget'
  | 'water'
  | 'gallery'
  | 'music'
  | 'private';

/**
 * How the engine addresses one table.
 *
 * `key` is the column the upsert conflicts on. It is `id` everywhere except the
 * per-module settings singletons, which have exactly one row per user and are
 * keyed by `user_id` — they have no id column, and inventing one would mean two
 * devices creating two "settings" rows for the same person.
 */
export type SyncTable = {
  name: string;
  key?: 'id' | 'user_id';
};

export type SyncModuleConfig = {
  key: SyncModule;
  labelKey: string;
  /** Tables synced for this module, parents before children. */
  tables: SyncTable[];
  /** Sensitive modules default OFF and stay local unless the user opts in. */
  sensitive: boolean;
};

/** Shorthand for the common case: an `id`-keyed table. */
const t = (name: string): SyncTable => ({ name });
/** A per-user singleton — one row, keyed by `user_id`. */
const singleton = (name: string): SyncTable => ({ name, key: 'user_id' });

export const SYNC_MODULES: SyncModuleConfig[] = [
  {
    key: 'tasks',
    labelKey: 'syncModule.tasks',
    // `note_tags` is not listed here: it is the shared tag vocabulary and
    // travels with the notes toggle, which is also where tags are managed. A
    // link whose tag has not arrived yet renders as nothing rather than
    // wrongly — the same trade the media rows already make.
    tables: [t('task_categories'), t('tasks'), t('task_subtasks'), t('task_tag_links')],
    sensitive: false,
  },
  {
    key: 'notes',
    labelKey: 'syncModule.notes',
    tables: [
      t('note_categories'),
      t('notes'),
      t('note_tags'),
      t('note_tag_links'),
      t('note_attachments'),
      // Wiki-style `[[links]]` between entries. Not notes-only in principle —
      // the table also carries journal/task/habit relations — but notes is
      // where they are authored, so it travels with the notes toggle.
      t('entry_links'),
    ],
    sensitive: false,
  },
  {
    key: 'habits',
    labelKey: 'syncModule.habits',
    tables: [
      t('habit_categories'),
      t('habits'),
      t('habit_routines'),
      t('habit_routine_items'),
      t('habit_logs'),
      t('habit_skips'),
    ],
    sensitive: false,
  },
  {
    key: 'journal',
    labelKey: 'syncModule.journal',
    tables: [
      t('journal_entries'),
      // Custom prompts only. The five seeded defaults have a NULL user_id and
      // so are never selected for push — they are app content, and every
      // device seeds its own copy.
      t('journal_prompts'),
      t('journal_reflections'),
      t('journal_attachments'),
    ],
    sensitive: false,
  },
  {
    key: 'calendar',
    labelKey: 'syncModule.calendar',
    tables: [t('calendar_events')],
    sensitive: false,
  },
  {
    key: 'goals',
    labelKey: 'syncModule.goals',
    tables: [t('goals'), t('goal_milestones'), t('goal_progress_logs')],
    sensitive: false,
  },
  {
    key: 'sleep',
    labelKey: 'syncModule.sleep',
    tables: [t('sleep_sessions'), singleton('sleep_settings')],
    sensitive: false,
  },
  {
    key: 'study',
    labelKey: 'syncModule.study',
    tables: [t('study_subjects'), t('study_sessions'), singleton('study_settings')],
    sensitive: false,
  },
  {
    key: 'water',
    labelKey: 'syncModule.water',
    tables: [t('water_intake_logs')],
    sensitive: false,
  },
  {
    key: 'budget',
    labelKey: 'syncModule.budget',
    tables: [
      t('budget_transactions'),
      t('budget_category_limits'),
      t('savings_goals'),
      t('budget_debts'),
      singleton('budget_settings'),
    ],
    sensitive: false,
  },
  {
    key: 'gallery',
    labelKey: 'syncModule.gallery',
    tables: [t('gallery_albums'), t('gallery_photos')],
    sensitive: false,
  },
  {
    key: 'music',
    labelKey: 'syncModule.music',
    tables: [t('songs'), t('playlists'), t('playlist_songs')],
    sensitive: false,
  },
  /**
   * The private space. `sensitive`, so it stays OFF until the user turns it on.
   *
   * What travels is the same ciphertext the device stores — the sync engine
   * moves `payload` verbatim and never sees inside it. What makes it readable
   * to the operator is the escrowed key (features/private/services/
   * vault-escrow.ts), not this.
   */
  {
    key: 'private',
    labelKey: 'syncModule.private',
    tables: [t('private_entries')],
    sensitive: true,
  },
];

/**
 * Columns that describe *this device* rather than the user's data. They are
 * never uploaded, and a pulled row never overwrites the local value.
 *
 * Two different kinds of harm, both of which were live before this existed:
 *
 *  - **OS notification handles.** `reminder_notification_id` is an identifier
 *    issued by this phone's notification scheduler. Copying another device's
 *    handle over it means the app later cancels or reschedules an id that does
 *    not exist here, and the real reminder is left running with nothing
 *    tracking it. Reminders that cannot be turned off are the worst kind.
 *  - **File paths.** `uri` and `thumbnail_uri` point into this app's private
 *    storage. Another device's path resolves to nothing here, so the row would
 *    render as a broken image rather than as absent media.
 *
 * `sync_status` and `server_updated_at` are per-device sync bookkeeping; they
 * were being uploaded and pulled back, which is round-tripping a column the
 * server has no opinion about.
 */
export const SYNC_DEVICE_LOCAL_COLUMNS: readonly string[] = [
  'sync_status',
  'server_updated_at',
  'reminder_notification_id',
  'uri',
  'thumbnail_uri',
];

/** Every table the engine touches, flattened. */
export const ALL_SYNC_TABLES: SyncTable[] = SYNC_MODULES.flatMap((m) => m.tables);

/** Just the names — for tests and diagnostics. */
export const ALL_SYNC_TABLE_NAMES: string[] = ALL_SYNC_TABLES.map((table) => table.name);

/** Default allow-sync map: sensitive modules OFF, the rest ON. */
export function defaultModuleFlags(): Record<SyncModule, boolean> {
  return SYNC_MODULES.reduce(
    (acc, m) => {
      acc[m.key] = !m.sensitive;
      return acc;
    },
    {} as Record<SyncModule, boolean>,
  );
}
