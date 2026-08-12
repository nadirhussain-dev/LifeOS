import { File } from 'expo-file-system';
import * as Network from 'expo-network';

import { useAuthStore } from '@/features/auth/services/auth-store';
import { useBillingStore } from '@/features/billing/store/billing-store';
import {
  MEDIA_BUCKET,
  MEDIA_TABLES,
  mediaObjectPath,
  mimeFor,
  type MediaTable,
} from '@/features/media-sync/config';
import { useMediaSyncStore } from '@/features/media-sync/store/media-sync-store';
import { useSyncStore } from '@/features/sync/store/sync-store';
import { getRawDb } from '@/database/client';
import { LOCAL_USER_ID } from '@/lib/local-user';
import { reportError } from '@/lib/error-reporting';
import { supabase } from '@/lib/supabase';

/**
 * Uploads media files whose bytes have never left this device.
 *
 * ## Resumable by construction, not by protocol
 *
 * There is no upload-session state to resume, because there is nothing to
 * resume *into*: each file is one request, and `remote_path` on the owning row
 * is the record that it succeeded. Interrupt this at any point — a killed app, a
 * dead network, a battery — and the next run picks up exactly the rows whose
 * `remote_path` is still null. That is a smaller mechanism than a chunked
 * resumable protocol and it survives more failures, because the only state it
 * keeps is a column that was already being synced.
 *
 * The object path is deterministic (`<uid>/<table>/<row id>`), so a retry that
 * duplicated an upload overwrites rather than accumulating — a half-finished
 * previous attempt cannot leave an orphan nobody will ever delete.
 *
 * ## It yields to everything
 *
 * Bytes are the least urgent thing this app syncs. A batch limit per run keeps
 * one enormous library from monopolising the connection, and every failure is
 * counted and skipped rather than thrown, so a single unreadable file cannot
 * stop the other two hundred.
 */

/** Files per run. Small on purpose: the user's rows and their reminders matter
 *  more than their photo library, and this runs after both. */
const BATCH = 8;

/** Above this, the file is skipped with a note rather than attempted. Matches
 *  the bucket's own `file_size_limit` in 0026, so the refusal happens here with
 *  a reason instead of at the far end with a 413. */
const MAX_OBJECT_BYTES = 50 * 1024 * 1024;

export type MediaUploadResult = {
  uploaded: number;
  skipped: number;
  failed: number;
  /** True when the server refused on quota — the caller stops rather than
   *  grinding through the rest of the library collecting the same error. */
  quotaReached: boolean;
};

type PendingRow = { id: string; uri: string };

/**
 * Whether the device is currently on a connection this app is willing to
 * spend someone's cellular data allowance on, when they've asked to stay off
 * it. Treated conservatively: only a definite Wi-Fi or Ethernet connection
 * counts as "yes" — an undetermined type or a failed check default to "no",
 * because guessing wrong in the direction of "used their data anyway" is the
 * one that actually costs them money.
 */
async function onWifi(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return (
      state.type === Network.NetworkStateType.WIFI ||
      state.type === Network.NetworkStateType.ETHERNET
    );
  } catch {
    return false;
  }
}

/** How stale `usage` is allowed to be before this run re-checks it rather
 *  than trusting the last figure — long enough that a normal run of several
 *  small files in a row doesn't re-fetch it every time, short enough that a
 *  quota reached from another device is noticed within a few runs. */
const USAGE_MAX_AGE_MS = 5 * 60_000;

export async function uploadPendingMedia(): Promise<MediaUploadResult> {
  const result: MediaUploadResult = { uploaded: 0, skipped: 0, failed: 0, quotaReached: false };

  const uid = useAuthStore.getState().user?.id;
  const { enabled, wifiOnly } = useMediaSyncStore.getState();
  if (!uid || !enabled) return result;

  // Checked first, and cheaply — a local device query, no round trip —
  // before spending a network request on anything else this function does.
  // Not a failure: the pending count is untouched, and the next run (the
  // next scheduled sync, or the app coming back to the foreground) tries
  // again, by which point the phone may well be back on Wi-Fi.
  if (wifiOnly && !(await onWifi())) return result;

  // Ask permission before spending a single request.
  //
  // Two separate server-side rules gate this bucket (0035, 0037): a free
  // plan is refused outright, on top of — not instead of — the plan-derived
  // byte ceiling every plan (including free, for what it uses elsewhere) is
  // held to. Checking both here, before the batch starts, means a free
  // account or a full one finds out from one cheap cache read instead of
  // discovering it eight uploads at a time by pattern-matching each one's
  // error message. Both triggers stay the real enforcement regardless; this
  // is purely about not wasting requests on a permission that already
  // hasn't been granted.
  // `checkedAt === null` means this cache has never actually been confirmed
  // by the server — its `planId` is still sitting at the store's own
  // default of 'free' (billing-store.ts), which a genuine Plus subscriber
  // can briefly see right after a fresh install or relaunch, before
  // useBillingSync()'s first round trip lands. Blocking on an unconfirmed
  // cache would tell a paying customer they're blocked when nobody has
  // actually checked yet; skipping the pre-check here just means this run
  // falls through to the real, authoritative check — the upload attempt
  // itself, enforced server-side by 0035's trigger — instead of a false
  // negative enforced by a value nothing has verified.
  const billing = useBillingStore.getState();
  if (billing.checkedAt !== null && billing.planId === 'free') {
    useMediaSyncStore.getState().setLastError('quota');
    result.quotaReached = true;
    return result;
  }

  const usage = useMediaSyncStore.getState().usage;
  if (!usage || Date.now() - usage.checkedAt > USAGE_MAX_AGE_MS) {
    await refreshMediaUsage();
  }
  const freshUsage = useMediaSyncStore.getState().usage;
  if (freshUsage && freshUsage.usedBytes >= freshUsage.quotaBytes) {
    useMediaSyncStore.getState().setLastError('quota');
    result.quotaReached = true;
    return result;
  }

  const moduleFlags = useSyncStore.getState().modules;
  let budget = BATCH;

  for (const media of MEDIA_TABLES) {
    if (budget <= 0 || result.quotaReached) break;
    // A module whose rows are not syncing must not have its bytes syncing
    // either — otherwise turning Gallery off in Settings would stop the
    // captions travelling and keep uploading the photographs.
    if (!(moduleFlags[media.module as keyof typeof moduleFlags] ?? false)) continue;

    const rows = pendingRows(media, budget);
    for (const row of rows) {
      if (result.quotaReached) break;
      budget -= 1;
      const outcome = await uploadOne(uid, media, row);
      if (outcome === 'uploaded') result.uploaded += 1;
      else if (outcome === 'skipped') result.skipped += 1;
      else if (outcome === 'quota') {
        result.quotaReached = true;
        result.failed += 1;
      } else result.failed += 1;
    }
  }

  useMediaSyncStore.getState().setPending(countPendingMedia());
  return result;
}

/** Rows that own a local file and have never been uploaded. */
function pendingRows(media: MediaTable, limit: number): PendingRow[] {
  try {
    return getRawDb().getAllSync<PendingRow>(
      `SELECT id, ${media.localColumn} AS uri FROM ${media.table}
        WHERE user_id = ?
          AND ${media.remoteColumn} IS NULL
          AND ${media.localColumn} IS NOT NULL
          AND ${media.localColumn} <> ''
          AND deleted_at IS NULL
        LIMIT ?`,
      [LOCAL_USER_ID, limit],
    );
  } catch {
    // A table this build does not have yet must not sink the others.
    return [];
  }
}

/** How many files are still waiting, across every media table. Drives the
 *  count on the settings screen. */
export function countPendingMedia(): number {
  let total = 0;
  for (const media of MEDIA_TABLES) {
    try {
      const row = getRawDb().getFirstSync<{ n: number }>(
        `SELECT count(*) AS n FROM ${media.table}
          WHERE user_id = ? AND ${media.remoteColumn} IS NULL
            AND ${media.localColumn} IS NOT NULL AND ${media.localColumn} <> ''
            AND deleted_at IS NULL`,
        [LOCAL_USER_ID],
      );
      total += row?.n ?? 0;
    } catch {
      /* table not ready */
    }
  }
  return total;
}

type Outcome = 'uploaded' | 'skipped' | 'failed' | 'quota';

async function uploadOne(uid: string, media: MediaTable, row: PendingRow): Promise<Outcome> {
  let bytes: Uint8Array;
  let size = 0;

  try {
    const file = new File(row.uri);
    if (!file.exists) {
      // The row points at a file this device no longer has — imported on
      // another phone, or cleared by the OS. Nothing to upload and nothing
      // wrong; leaving remote_path null lets the device that *does* have it
      // do the work.
      return 'skipped';
    }
    size = file.size ?? 0;
    if (size > MAX_OBJECT_BYTES) return 'skipped';
    bytes = await file.bytes();
  } catch (error) {
    reportError(error, { scope: 'media-upload:read' });
    return 'failed';
  }

  const path = mediaObjectPath(uid, media.table, row.id, row.uri);

  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, bytes, {
    contentType: mimeFor(row.uri),
    // Deterministic path plus upsert: a retry after a half-finished attempt
    // replaces the object rather than failing or orphaning it.
    upsert: true,
  });

  if (error) {
    // 0026's trigger raises with 'media storage quota exceeded'. Recognised so
    // the run stops and the user is told, instead of the whole library failing
    // one file at a time with the same message.
    if (/quota/i.test(error.message)) {
      useMediaSyncStore.getState().setLastError('quota');
      return 'quota';
    }
    reportError(error, { scope: 'media-upload:put' });
    return 'failed';
  }

  markUploaded(media, row.id, path);
  return 'uploaded';
}

/**
 * Records the object path, and bumps `updated_at` so the change is pushed.
 *
 * Without the bump the sync engine's `WHERE updated_at > cursor` would skip it
 * and the other devices would never learn the bytes exist — the same delete-sync
 * bug the audit found in every repository, in a new place.
 */
function markUploaded(media: MediaTable, id: string, path: string): void {
  try {
    getRawDb().runSync(
      `UPDATE ${media.table} SET ${media.remoteColumn} = ?, updated_at = ? WHERE id = ?`,
      [path, Date.now(), id],
    );
  } catch (error) {
    reportError(error, { scope: 'media-upload:mark' });
  }
}

/** Reads usage and the quota from the server, for the settings screen. */
export async function refreshMediaUsage(): Promise<void> {
  const uid = useAuthStore.getState().user?.id;
  if (!uid) return;

  const [used, quota] = await Promise.all([
    supabase.rpc('media_bytes_used'),
    supabase.rpc('media_quota_bytes'),
  ]);
  if (used.error || quota.error) return;

  useMediaSyncStore.getState().setUsage({
    usedBytes: Number(used.data ?? 0),
    quotaBytes: Number(quota.data ?? 0),
    checkedAt: Date.now(),
  });
}
