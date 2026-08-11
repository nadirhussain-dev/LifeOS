import * as ImagePicker from 'expo-image-picker';

/**
 * Whether the OS grants access to the camera or photo library, requesting it
 * first if it has never been asked.
 *
 * Shared by every feature that launches the image picker (gallery, the
 * profile avatar, the private vault) so a denial is checked for the same way
 * everywhere. Before this existed, `gallery-storage.ts`'s `pickMedia()` was
 * the only call site that actually checked — `features/profile/services/
 * avatar.ts` and `features/private/services/vault-files.ts` both launched the
 * picker directly and let a denial look identical to the user simply
 * cancelling, with no way to tell them how to fix it.
 */
export async function hasMediaAccess(source: 'camera' | 'library'): Promise<boolean> {
  const { granted } =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  return granted;
}
