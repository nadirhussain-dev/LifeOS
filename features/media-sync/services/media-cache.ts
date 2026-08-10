import { Directory, File, Paths } from 'expo-file-system';

import { MEDIA_BUCKET, extensionOf } from '@/features/media-sync/config';
import { getRawDb } from '@/database/client';
import { reportError } from '@/lib/error-reporting';
import { supabase } from '@/lib/supabase';

/**
 * Fetches media this device does not hold, on demand.
 *
 * ## Why on demand rather than on sync
 *
 * The alternative is downloading every photo the account has ever taken onto
 * every device it signs into, which is the behaviour that makes people
 * uninstall a photo app. A row arrives from another device carrying a
 * `remote_path` and no local file; the UI shows "Not on this device"
 * (`isOnThisDevice`) until something actually asks for the bytes, and then this
 * fetches them once and keeps them.
 *
 * ## The cache is a cache
 *
 * Files land in a dedicated directory, and the local column is pointed at them
 * exactly as if they had been imported here. Nothing distinguishes a downloaded
 * file from an original afterwards, which is the point — every screen in the app
 * already knows how to render a local URI, and none of them should learn about
 * storage paths.
 *
 * Deliberately no eviction. Adding one means deciding what to delete from
 * somebody's photo library, which is not a decision to make implicitly; the
 * files are the same ones the device would have held had they been imported
 * here, and `clearMediaCache` is offered instead so it is a choice.
 */

const CACHE_DIRNAME = 'media-cache';

function cacheDirectory(): Directory {
  const dir = new Directory(Paths.document, CACHE_DIRNAME);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** In-flight downloads, so two components asking for the same photo in the same
 *  frame produce one request rather than two. */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Returns a local URI for a remote object, downloading it if necessary, and
 * points the owning row at it.
 *
 * Returns null rather than throwing when the bytes cannot be had — offline, a
 * deleted object, a revoked session. The caller shows the same "not on this
 * device" state it was already showing.
 */
export function ensureLocalCopy(params: {
  table: string;
  rowId: string;
  remotePath: string;
  localColumn?: string;
}): Promise<string | null> {
  const key = params.remotePath;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const job = download(params).finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

async function download(params: {
  table: string;
  rowId: string;
  remotePath: string;
  localColumn?: string;
}): Promise<string | null> {
  const localColumn = params.localColumn ?? 'uri';

  try {
    const target = new File(cacheDirectory(), `${params.rowId}${extensionOf(params.remotePath)}`);
    // Already fetched on a previous run — point the row at it and stop. The
    // row's own column can be empty while the file exists, because the column
    // is per-device and the file survives a reinstall of the row.
    if (target.exists) {
      pointRowAt(params.table, params.rowId, localColumn, target.uri);
      return target.uri;
    }

    const { data, error } = await supabase.storage.from(MEDIA_BUCKET).download(params.remotePath);
    if (error || !data) return null;

    const bytes = new Uint8Array(await data.arrayBuffer());
    target.create({ overwrite: true });
    target.write(bytes);

    pointRowAt(params.table, params.rowId, localColumn, target.uri);
    return target.uri;
  } catch (error) {
    reportError(error, { scope: 'media-cache:download' });
    return null;
  }
}

/**
 * Points the row at the downloaded file — **without** touching `updated_at`.
 *
 * The local path is device-local (it is in `SYNC_DEVICE_LOCAL_COLUMNS` for
 * exactly this reason), so bumping the row would push this device's private
 * filesystem path to every other device and, worse, would make a download look
 * like an edit to the conflict detector added for sync.
 */
function pointRowAt(table: string, rowId: string, column: string, uri: string): void {
  try {
    getRawDb().runSync(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, [uri, rowId]);
  } catch (error) {
    reportError(error, { scope: 'media-cache:point' });
  }
}

/** Total bytes held by the cache, for the settings screen. */
export function cachedBytes(): number {
  try {
    const dir = new Directory(Paths.document, CACHE_DIRNAME);
    if (!dir.exists) return 0;
    return dir
      .list()
      .reduce((sum, entry) => sum + (entry instanceof File ? (entry.size ?? 0) : 0), 0);
  } catch {
    return 0;
  }
}

/**
 * Deletes every downloaded file.
 *
 * Only ever removes files this device *downloaded* — originals imported here
 * live elsewhere and are untouched. Rows keep their `remote_path`, so anything
 * cleared can be fetched again; what is lost is offline access, not data.
 */
export function clearMediaCache(): void {
  try {
    const dir = new Directory(Paths.document, CACHE_DIRNAME);
    if (dir.exists) dir.delete();
  } catch (error) {
    reportError(error, { scope: 'media-cache:clear' });
  }
}
