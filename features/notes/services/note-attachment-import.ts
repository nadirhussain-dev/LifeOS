import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';

function getNoteFilesDirectory(): Directory {
  const directory = new Directory(Paths.document, 'note-files');
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export type PickedNoteFile = { uri: string; kind: 'pdf' | 'file' };

/**
 * Copies the picked file into the app's own document storage — a
 * document-picker URI isn't guaranteed to survive a relaunch (especially an
 * iCloud-backed file on iOS), the same concern
 * features/music/services/song-import.ts already solves for songs.
 *
 * The destination filename keeps the original name after a timestamp
 * prefix — `note_attachments` has no filename column, so the display name
 * shown in the UI is recovered from this later rather than stored twice.
 */
export async function pickNoteFile(): Promise<PickedNoteFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];

  const directory = getNoteFilesDirectory();
  const destination = new File(directory, `${Date.now()}-${asset.name}`);
  try {
    new File(asset.uri).copy(destination);
  } catch {
    return null;
  }

  const isPdf = asset.mimeType === 'application/pdf' || asset.name.toLowerCase().endsWith('.pdf');
  return { uri: destination.uri, kind: isPdf ? 'pdf' : 'file' };
}

/** Recovers a display name from the copied file's own URI (see above). */
export function fileNameFromUri(uri: string): string {
  const last = uri.split('/').pop() ?? uri;
  return decodeURIComponent(last.replace(/^\d+-/, ''));
}
