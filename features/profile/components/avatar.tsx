import { Image } from 'expo-image';
import { type LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { avatarUrl, signedAvatarUrl } from '@/features/profile/services/avatar';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';

type Props = {
  /** Storage path from the profile row, not a URL — see services/avatar.ts. */
  path: string | null;
  /** Cache-buster. Changes every time the picture is replaced. */
  updatedAt: number | null;
  /** Rendered underneath the picture, and left showing if it never arrives. */
  initials: string;
  /** Diameter in px. Type scales with it so one component covers 28 → 112. */
  size: number;
  /** Shown instead of initials when there is no name to derive them from. */
  icon?: LucideIcon;
};

/**
 * A profile picture, with the initials *underneath* rather than instead.
 *
 * The bug this exists to fix: the profile screen used to choose between the
 * picture and the initials on `path !== null`. But a path only says a row
 * points at an object — it says nothing about whether that object can actually
 * be fetched. A bucket that isn't public (0036 postdates the feature, so any
 * project whose `avatars` bucket was made by hand is exactly this case), an
 * upload that half-landed, a device that's offline, or a 404 already in
 * expo-image's disk cache all produce the same thing: a URL that resolves to
 * nothing, an `<Image>` that draws nothing, and an empty tinted circle where
 * the initials fallback should have been. The fallback was unreachable in every
 * case it was written for.
 *
 * So the initials are always rendered, and the picture is layered on top of
 * them. Nothing to fall *back* to — the floor is already there. A failure then
 * has exactly one visible consequence: the layer on top goes away.
 *
 * A failure also earns one retry through a signed URL, which is the one repair
 * the client can actually perform (see `signedAvatarUrl`). If that fails too
 * the picture is genuinely unreachable and the initials stand.
 */
export function Avatar({ path, updatedAt, initials, size, icon: Icon }: Props) {
  const { c } = useTheme();

  const publicUrl = avatarUrl(path, updatedAt);

  /**
   * 'public' → the constructed URL, 'signed' → the retry, 'failed' → give up.
   *
   * Keyed on the URL rather than reset by an effect on mount: a picture that
   * failed must not be retried on every re-render, but a *new* picture (or the
   * same one re-uploaded, which changes `updatedAt`) has to start over from
   * 'public'. Comparing against the URL that produced the current state is
   * what distinguishes those two.
   */
  const [attempt, setAttempt] = useState<{
    for: string | null;
    phase: 'public' | 'signed' | 'failed';
    url: string | null;
    /** True once pixels have actually arrived, which is the only moment the
     *  layer underneath is safe to drop. */
    loaded: boolean;
  }>({
    for: publicUrl,
    phase: 'public',
    url: publicUrl,
    loaded: false,
  });

  useEffect(() => {
    if (attempt.for !== publicUrl) {
      setAttempt({ for: publicUrl, phase: 'public', url: publicUrl, loaded: false });
    }
  }, [publicUrl, attempt.for]);

  const handleError = () => {
    if (attempt.phase !== 'public') {
      setAttempt((previous) => ({ ...previous, phase: 'failed', url: null, loaded: false }));
      return;
    }
    void signedAvatarUrl(path, updatedAt).then((signed) => {
      setAttempt((previous) =>
        // Another picture may have arrived while the signing round-tripped.
        previous.for !== publicUrl
          ? previous
          : signed
            ? { for: publicUrl, phase: 'signed', url: signed, loaded: false }
            : { for: publicUrl, phase: 'failed', url: null, loaded: false },
      );
    });
  };

  const url = attempt.for === publicUrl ? attempt.url : publicUrl;
  const loadedUrl = attempt.for === publicUrl && attempt.loaded;

  return (
    <View
      className="items-center justify-center overflow-hidden rounded-full"
      style={{ width: size, height: size, backgroundColor: alpha(c.accent, 0.14) }}
    >
      {/* Initials rather than a generic silhouette: a profile without a picture
          should still read as a person.

          Taken out of the tree entirely once the picture is up, rather than
          merely covered — a photo that turns out to carry transparency (the
          picker crops to JPEG, but the bucket accepts PNG and WebP too) would
          otherwise show a letter through it. */}
      {loadedUrl ? null : Icon ? (
        <Icon size={Math.round(size * 0.36)} color={c.accent} strokeWidth={1.6} />
      ) : (
        <Text
          className="font-sora-extrabold"
          style={{
            color: c.accent,
            fontSize: Math.round(size * 0.32),
            // Both, always. `Text`'s default variant carries Tailwind's
            // `text-base`, which sets a line height of 24 as well as a size of
            // 16 — and overriding only the size leaves that 24 in place. At the
            // profile screen's 112pt the glyphs are 36pt tall inside a 24pt
            // line box, so the initials were clipped top and bottom; the small
            // Hub chip escaped it only because 13 happens to fit under 24.
            // 1.12 is the ratio the display/stat steps of the type scale use
            // (constants/design-tokens.ts).
            lineHeight: Math.round(size * 0.32 * 1.12),
            // Android adds font-metric padding on top of that line box and
            // centres the text within the padded result, which reintroduces a
            // vertical shift at large sizes. iOS ignores this.
            includeFontPadding: false,
          }}
        >
          {initials}
        </Text>
      )}

      {url ? (
        <Image
          source={{ uri: url }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          // Keyed on the URL so the cache-buster actually busts the in-memory
          // view as well as the disk entry.
          recyclingKey={url}
          transition={150}
          onLoad={() =>
            setAttempt((previous) =>
              previous.url === url ? { ...previous, loaded: true } : previous,
            )
          }
          onError={handleError}
          accessible={false}
        />
      ) : null}
    </View>
  );
}
