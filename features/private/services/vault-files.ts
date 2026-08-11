import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import {
  decryptBytes,
  encryptBytes,
  randomBytes,
  toBase64,
} from '@/features/private/services/vault-crypto';
import { vaultKey } from '@/features/private/store/private-store';
import { hasMediaAccess } from '@/lib/media-permissions';

/**
 * Encrypted-at-rest file storage for the vault.
 *
 * The Progress Gallery copies picked media into the app's document directory as
 * plain files (see features/gallery/services/gallery-storage.ts). That is fine
 * for a photo of a plant. It is not fine here, so this differs in four ways,
 * each closing a specific way the old approach leaks:
 *
 *  - **Bytes are sealed** under the vault key. The file on disk is
 *    indistinguishable from noise without it.
 *  - **Names are random and extensionless.** `IMG_4471.jpg` in a directory
 *    listing tells a story before anything is opened; `a3f1…` does not.
 *  - **The directory carries `.nomedia`**, so Android's media scanner does not
 *    index it and the OS gallery never shows a thumbnail of vault content.
 *  - **Thumbnails are encrypted too.** An encrypted original next to a
 *    plaintext preview protects nothing.
 *
 * Decryption is to memory (a data URI), never to a temp file. A decrypted copy
 * on disk outlives the lock and is exactly the artefact this feature exists to
 * avoid.
 */

const VAULT_DIRECTORY = 'private-vault';

/** Well under the gallery's 30 MB video ceiling, and deliberately so: every
 * byte here is encrypted and decrypted in JavaScript, and a 30 MB video would
 * take long enough to look like a hang. Images are the use case. */
export const MAX_VAULT_BYTES = 8 * 1024 * 1024;
export const MAX_VAULT_MB = 8;

function vaultDirectory(): Directory {
  const directory = new Directory(Paths.document, VAULT_DIRECTORY);
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  // Android's MediaStore skips any directory containing this file. Cheap, and
  // the difference between "hidden" and "in the phone's photo grid".
  const marker = new File(directory, '.nomedia');
  if (!marker.exists) {
    try {
      marker.create();
    } catch {
      // Best effort — a failure here costs indexing, not confidentiality.
    }
  }
  return directory;
}

/** An opaque, extensionless name. Nothing about it hints at the content. */
function randomName(): string {
  return toBase64(randomBytes(18)).replace(/[^a-zA-Z0-9]/g, '');
}

export type StoredVaultFile = {
  /** Name inside the vault directory — the only thing the DB row records. */
  fileName: string;
  byteLength: number;
};

export type PickedVaultMedia = {
  file: StoredVaultFile;
  width: number | null;
  height: number | null;
  mimeType: string;
};

/** Seals `bytes` into a new vault file. */
export function writeVaultFile(bytes: Uint8Array): StoredVaultFile | null {
  const key = vaultKey();
  if (!key) return null;

  const fileName = randomName();
  const file = new File(vaultDirectory(), fileName);
  file.create({ overwrite: true });
  file.write(encryptBytes(key, bytes));
  return { fileName, byteLength: bytes.length };
}

/** Opens a vault file. Returns null when locked, missing, or sealed under the
 * other space's key. */
export function readVaultFile(fileName: string): Uint8Array | null {
  const key = vaultKey();
  if (!key) return null;

  const file = new File(vaultDirectory(), fileName);
  if (!file.exists) return null;
  try {
    return decryptBytes(key, file.bytesSync());
  } catch {
    return null;
  }
}

/**
 * A data URI for rendering. In memory only — see the note at the top about why
 * this is not a temp file.
 */
export function readVaultFileAsDataUri(fileName: string, mimeType: string): string | null {
  const bytes = readVaultFile(fileName);
  if (!bytes) return null;
  return `data:${mimeType};base64,${toBase64(bytes)}`;
}

export function deleteVaultFile(fileName: string): void {
  const file = new File(vaultDirectory(), fileName);
  if (file.exists) {
    try {
      file.delete();
    } catch {
      // A file that will not delete is still unreadable without the key.
    }
  }
}

/** Removes every stored blob. Called when the space is destroyed. */
export function deleteAllVaultFiles(): void {
  const directory = vaultDirectory();
  try {
    directory.delete();
  } catch {
    // Fall through: the keys are gone, so the bytes are noise regardless.
  }
}

/**
 * Picks images and seals them straight into the vault.
 *
 * Note what does *not* happen: the picked file is never copied to the app's
 * document directory in the clear first. It goes from the picker's cache to
 * sealed bytes in one step, so there is no window in which a plaintext copy
 * exists under our control.
 */
export async function pickIntoVault(
  source: 'library' | 'camera',
): Promise<{ items: PickedVaultMedia[]; rejectedOversize: number; permissionDenied: boolean }> {
  if (!vaultKey()) return { items: [], rejectedOversize: 0, permissionDenied: false };

  if (!(await hasMediaAccess(source === 'camera' ? 'camera' : 'library'))) {
    return { items: [], rejectedOversize: 0, permissionDenied: true };
  }

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 0.9,
    allowsMultipleSelection: source === 'library',
    exif: false, // Location and camera serial travel in EXIF. Not here.
  };

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

  if (result.canceled) return { items: [], rejectedOversize: 0, permissionDenied: false };

  const items: PickedVaultMedia[] = [];
  let rejectedOversize = 0;

  for (const asset of result.assets) {
    const source$ = new File(asset.uri);
    if (!source$.exists) continue;
    if ((source$.size ?? 0) > MAX_VAULT_BYTES) {
      rejectedOversize += 1;
      continue;
    }

    const stored = writeVaultFile(source$.bytesSync());
    if (!stored) continue;

    // The picker's copy is in the OS cache and would be cleaned up eventually;
    // eventually is not good enough for something the user just chose to hide.
    try {
      source$.delete();
    } catch {
      // Not ours to delete on every platform. The sealed copy is what matters.
    }

    items.push({
      file: stored,
      width: asset.width ?? null,
      height: asset.height ?? null,
      mimeType: asset.mimeType ?? 'image/jpeg',
    });
  }

  return { items, rejectedOversize, permissionDenied: false };
}
