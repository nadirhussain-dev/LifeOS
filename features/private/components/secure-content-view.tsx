import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { EyeOff, Flag } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useSecureScreen } from '@/features/private/components/secure-screen';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

/**
 * The viewer for content somebody else shared with you.
 *
 * What it actually enforces, and what it cannot
 * ---------------------------------------------
 * Enforced: screenshots and screen recording are blocked, there is no save
 * button, no share sheet, and no long-press menu; the viewer's own name is
 * watermarked across the content; the owner can revoke access server-side.
 *
 * Not enforced, and impossible to enforce: somebody photographing the screen
 * with a second phone. No app on any platform prevents that — the pixels have
 * to reach a human eye, and a camera can be pointed at the same place.
 *
 * That limit is why the watermark is here and why it carries the viewer's name
 * rather than a decorative logo. It cannot stop a photograph; it makes a
 * photograph traceable to whoever took it, which is the deterrent that actually
 * works between people who know each other. The notice below says all of this
 * to the viewer, in plain words, because the person deciding whether to share
 * something intimate deserves an accurate model of what they are getting.
 */
type Props = {
  children: ReactNode;
  /** Watermarked across the content — the viewer's name or email. */
  viewerLabel: string;
  onReport?: () => void;
};

export function SecureContentView({ children, viewerLabel, onReport }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();

  // Blocks capture for as long as this is mounted, and releases on unmount.
  useSecureScreen();

  return (
    <View className="flex-1">
      <View className="flex-1">
        {/*
          No `onLongPress`, no Pressable wrapper, and expo-image's context menu
          is never enabled — the long-press "Save image" affordance is a
          platform default that has to be actively not opted into.
        */}
        <View pointerEvents="box-none" className="flex-1">
          {children}
        </View>

        {/*
          Watermark. Diagonal, repeated, low-contrast: readable enough to
          identify in a photograph, faint enough not to ruin the content. Not
          pointer-interactive, so it never blocks a scroll underneath.
        */}
        <View pointerEvents="none" className="absolute inset-0 justify-around overflow-hidden">
          {Array.from({ length: 6 }).map((_, row) => (
            <View key={row} className="flex-row justify-around">
              {Array.from({ length: 2 }).map((__, column) => (
                <Text
                  key={column}
                  style={{
                    color: alpha(theme.foreground, 0.16),
                    fontSize: 12,
                    transform: [{ rotate: '-30deg' }],
                  }}
                >
                  {viewerLabel}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </View>

      <View className="gap-2 px-4 pb-4 pt-3">
        <View
          className="flex-row items-start gap-2.5 rounded-2xl px-4 py-3"
          style={{ backgroundColor: alpha(theme.accent, 0.1) }}
        >
          <EyeOff size={17} color={theme.accent} strokeWidth={1.9} />
          <Text variant="caption" className="flex-1">
            {t('sharing.viewerNotice')}
          </Text>
        </View>

        {onReport ? (
          <Pressable
            accessibilityRole="button"
            onPress={onReport}
            className="flex-row items-center justify-center gap-2 rounded-2xl border border-border py-3"
          >
            <Flag size={16} color={theme.mutedForeground} />
            <Text variant="muted">{t('sharing.report')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * An image inside a SecureContentView.
 *
 * `cachePolicy="none"` for the same reason the vault grid uses it: a cached
 * decode of shared content is a copy of shared content sitting outside the
 * viewer, surviving revocation and the lock.
 */
export function SecureImage({ uri }: { uri: string }) {
  return (
    <Image
      source={{ uri }}
      style={{ width: '100%', height: '100%' }}
      contentFit="contain"
      cachePolicy="none"
      // No placeholder blurhash: it would persist a low-resolution version of
      // the content in the component tree after the source is revoked.
      transition={0}
    />
  );
}
