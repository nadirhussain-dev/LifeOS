import {
  MEDIA_BUCKET,
  MEDIA_TABLES,
  extensionOf,
  mediaObjectPath,
  mimeFor,
} from '@/features/media-sync/config';

/**
 * Media object paths, and the first test `features/media-sync` has had.
 *
 * The load-bearing rule is stated in the file itself: every storage policy in
 * 0026 is "the first path segment is your own uid". A path that puts anything
 * else first does not fail closed — it fails the policy check, which means
 * uploads break; or worse, a layout change that moved the uid later would make
 * the policy unwriteable and the fix would look like loosening it.
 *
 * The second rule is determinism: the row id in the path is what makes a
 * re-upload overwrite rather than accumulate. Without it, every retry of a
 * flaky upload bills for another copy.
 */

describe('mediaObjectPath', () => {
  it('puts the uid first, because every storage policy checks that segment', () => {
    const path = mediaObjectPath('uid-123', 'gallery_photos', 'photo-9', 'file:///a/b.jpg');

    expect(path.split('/')[0]).toBe('uid-123');
    expect(path).toBe('uid-123/gallery_photos/photo-9.jpg');
  });

  it('is deterministic, so a re-upload overwrites rather than accumulating', () => {
    const once = mediaObjectPath('uid', 'songs', 'song-1', 'file:///x/track.mp3');
    const twice = mediaObjectPath('uid', 'songs', 'song-1', 'file:///different/path/track.mp3');

    expect(twice).toBe(once);
  });

  it('keeps a row with no usable extension addressable', () => {
    // A file with no extension still has to get a path; dropping the row would
    // mean it never syncs and nothing reports why.
    const path = mediaObjectPath('uid', 'note_attachments', 'att-1', 'file:///a/noext');

    expect(path).toBe('uid/note_attachments/att-1');
  });
});

describe('extensionOf', () => {
  it('lowercases the extension', () => {
    expect(extensionOf('file:///a/PHOTO.JPG')).toBe('.jpg');
    expect(extensionOf('file:///a/Clip.MoV')).toBe('.mov');
  });

  it('ignores a query string', () => {
    // Signed URLs and content:// URIs both carry them.
    expect(extensionOf('https://host/a/b.png?token=abc')).toBe('.png');
  });

  it('is empty when there is no extension', () => {
    expect(extensionOf('file:///a/b')).toBe('');
    expect(extensionOf('')).toBe('');
  });

  it('does not mistake a dotted directory for an extension', () => {
    // `lastDot <= lastSlash` is the guard. Without it this returns "./b".
    expect(extensionOf('file:///a.dir/b')).toBe('');
  });

  it('rejects half a filename after a dot', () => {
    // The documented rule: 1–5 alphanumerics. A trailing sentence is not an
    // extension, and appending it to an object name would produce a path the
    // bucket refuses on a rule nobody would think to check.
    expect(extensionOf('file:///a/b.thisisnotanextension')).toBe('');
    expect(extensionOf('file:///a/b.')).toBe('');
    expect(extensionOf('file:///a/b.a-b')).toBe('');
  });

  it('accepts extensions at both ends of the allowed length', () => {
    expect(extensionOf('file:///a/b.m')).toBe('.m');
    expect(extensionOf('file:///a/b.heics')).toBe('.heics');
  });
});

describe('mimeFor', () => {
  it('maps the formats the bucket allows', () => {
    expect(mimeFor('a.jpg')).toBe('image/jpeg');
    expect(mimeFor('a.jpeg')).toBe('image/jpeg');
    expect(mimeFor('a.png')).toBe('image/png');
    expect(mimeFor('a.webp')).toBe('image/webp');
    expect(mimeFor('a.heic')).toBe('image/heic');
    expect(mimeFor('a.gif')).toBe('image/gif');
    expect(mimeFor('a.mp4')).toBe('video/mp4');
    expect(mimeFor('a.mov')).toBe('video/quicktime');
    expect(mimeFor('a.mp3')).toBe('audio/mpeg');
    expect(mimeFor('a.m4a')).toBe('audio/x-m4a');
    expect(mimeFor('a.aac')).toBe('audio/aac');
    expect(mimeFor('a.wav')).toBe('audio/wav');
    expect(mimeFor('a.pdf')).toBe('application/pdf');
  });

  it('is case-insensitive, since it reads through extensionOf', () => {
    expect(mimeFor('PHOTO.JPEG')).toBe('image/jpeg');
  });

  it('falls back to octet-stream for anything unrecognised', () => {
    // Deliberate per the file's comment: storage rejects what is outside the
    // allowlist, so a wrong guess fails loudly rather than storing something
    // mislabelled.
    expect(mimeFor('a.xyz')).toBe('application/octet-stream');
    expect(mimeFor('a')).toBe('application/octet-stream');
  });
});

describe('MEDIA_TABLES', () => {
  it('covers the four tables that own files, once each', () => {
    const tables = MEDIA_TABLES.map((t) => t.table);

    expect(tables.sort()).toEqual([
      'gallery_photos',
      'journal_attachments',
      'note_attachments',
      'songs',
    ]);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it('gives every table a module, so the opt-in can follow the module toggles', () => {
    // A table with no module would upload regardless of whether its module's
    // sync toggle is off — bytes leaving the device against an explicit choice.
    for (const table of MEDIA_TABLES) {
      expect(table.module.length).toBeGreaterThan(0);
      expect(table.localColumn.length).toBeGreaterThan(0);
      expect(table.remoteColumn.length).toBeGreaterThan(0);
    }
  });

  it('never reads and writes the same column', () => {
    // Local URI and remote object path in one column would overwrite the
    // device's own path on first upload, and the file would stop resolving
    // locally.
    for (const table of MEDIA_TABLES) {
      expect(table.localColumn).not.toBe(table.remoteColumn);
    }
  });

  it('names one bucket', () => {
    expect(MEDIA_BUCKET).toBe('media');
  });
});
