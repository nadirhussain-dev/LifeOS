/**
 * Media byte sync — which tables carry files, and where those files live.
 *
 * 0016 made media *metadata* sync (albums, captions, ordering, favourites) and
 * deliberately left the bytes on the device that imported them. This is the
 * other half, and it is opt-in and quota'd because at any scale it is the line
 * item that dominates the bill.
 */

export const MEDIA_BUCKET = 'media';

/**
 * The four tables that own files, and the column holding the local path.
 *
 * `remote_path` has existed on all of them since 0016 with nothing writing it.
 * Keyed by table name because the uploader works generically — the same reason
 * the sync engine does.
 */
export type MediaTable = {
  table: string;
  /** Column holding the on-device URI. */
  localColumn: string;
  /** Column holding the storage object path once uploaded. */
  remoteColumn: string;
  /** Sync module that owns it, so the opt-in can follow the module toggles. */
  module: string;
};

export const MEDIA_TABLES: MediaTable[] = [
  { table: 'gallery_photos', localColumn: 'uri', remoteColumn: 'remote_path', module: 'gallery' },
  { table: 'songs', localColumn: 'uri', remoteColumn: 'remote_path', module: 'music' },
  { table: 'note_attachments', localColumn: 'uri', remoteColumn: 'remote_path', module: 'notes' },
  {
    table: 'journal_attachments',
    localColumn: 'uri',
    remoteColumn: 'remote_path',
    module: 'journal',
  },
];

/**
 * Object path for one file: `<uid>/<table>/<row id><ext>`.
 *
 * The uid comes first because every storage policy in 0026 is "the first path
 * segment is your own uid", and a layout that puts anything else first makes
 * that check impossible to write. The row id makes the path deterministic, so
 * re-uploading the same row overwrites rather than accumulating.
 */
export function mediaObjectPath(uid: string, table: string, rowId: string, uri: string): string {
  return `${uid}/${table}/${rowId}${extensionOf(uri)}`;
}

/** The extension, lowercased, or '' — used only to keep object names honest;
 *  nothing reads it back. */
export function extensionOf(uri: string): string {
  const withoutQuery = uri.split('?')[0];
  const lastDot = withoutQuery.lastIndexOf('.');
  const lastSlash = withoutQuery.lastIndexOf('/');
  if (lastDot <= lastSlash) return '';
  const ext = withoutQuery.slice(lastDot).toLowerCase();
  // A "." followed by half a filename is not an extension.
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '';
}

/** Best-effort MIME from the extension. Storage rejects anything outside the
 *  bucket's allowlist (0026), so a wrong guess fails loudly rather than
 *  storing something mislabelled. */
export function mimeFor(uri: string): string {
  switch (extensionOf(uri)) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.heic':
      return 'image/heic';
    case '.gif':
      return 'image/gif';
    case '.mp4':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.mp3':
      return 'audio/mpeg';
    case '.m4a':
      return 'audio/x-m4a';
    case '.aac':
      return 'audio/aac';
    case '.wav':
      return 'audio/wav';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}
