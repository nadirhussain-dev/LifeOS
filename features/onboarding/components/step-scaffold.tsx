import { type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { typography } from '@/constants/design-tokens';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  eyebrow?: string;
  title: string;
  body?: string;
  /** Ornament above the heading — a brand mark or an icon plate. Kept distinct
   *  from `children` because everything below the heading is the part people
   *  interact with, and an icon that lands there reads as a control. */
  above?: ReactNode;
  /** The interactive part of the step. */
  children?: ReactNode;
  /** Pinned to the bottom. One primary action per step, by convention. */
  footer: ReactNode;
  /**
   * Centres the content and uses the largest type. For the three steps that are
   * a statement rather than a question — welcome, the lock offer, and the
   * finish — where a form-shaped layout would undersell the moment.
   */
  hero?: boolean;
  /** Lets a tall step scroll instead of squashing. */
  scroll?: boolean;
};

/**
 * The shared frame every onboarding step renders into.
 *
 * It exists so the seven steps cannot drift apart. The previous flow inlined all
 * five of its screens in one component and each had already grown its own
 * spacing, its own heading size and its own idea of where the footer sat — small
 * differences that read, one screen after another, as the app not being sure of
 * itself.
 *
 * Type comes from the scale rather than from Tailwind size classes: `display` and
 * `h1` are the two steps of it that were built for exactly this and were being
 * approximated with `text-4xl`/`text-3xl` at slightly wrong tracking.
 */
export function StepScaffold({
  eyebrow,
  title,
  body,
  above,
  children,
  footer,
  hero,
  scroll,
}: Props) {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();

  const heading = hero ? typography.display : typography.h1;

  const header = (
    <View className="gap-2.5">
      {above ? <View className="mb-4">{above}</View> : null}
      {eyebrow ? <Text variant="micro">{eyebrow}</Text> : null}
      <Text
        style={{
          fontSize: heading.size,
          lineHeight: heading.lineHeight,
          fontFamily: heading.family,
          letterSpacing: heading.tracking,
          color: c.foreground,
        }}
      >
        {title}
      </Text>
      {body ? (
        <Text
          style={{
            fontSize: typography.bodyLg.size,
            lineHeight: typography.bodyLg.lineHeight,
            color: c.mutedForeground,
          }}
        >
          {body}
        </Text>
      ) : null}
    </View>
  );

  const content = hero ? (
    <View className="flex-1 justify-center gap-7">
      {header}
      {children}
    </View>
  ) : (
    <View className="flex-1 gap-6 pt-6">
      {header}
      {children}
    </View>
  );

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-grow px-6"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {content}
        </ScrollView>
      ) : (
        <View className="flex-1 px-6">{content}</View>
      )}

      <View className="gap-2.5 px-6" style={{ paddingBottom: insets.bottom + 16, paddingTop: 14 }}>
        {footer}
      </View>
    </KeyboardAvoidingView>
  );
}
