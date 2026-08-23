import { cva, type VariantProps } from 'class-variance-authority';
import { Text as RNText, type TextProps } from 'react-native';

import { cn } from '@/lib/utils';

const textVariants = cva('text-foreground', {
  variants: {
    variant: {
      default: 'text-base',
      heading: 'text-2xl font-sora-extrabold tracking-tight',
      subheading: 'text-lg font-sora-semibold',
      muted: 'text-sm text-muted-foreground',
      caption: 'text-xs text-muted-foreground',
      // 11px uppercase eyebrow/label — the "micro" step of the type scale.
      micro: 'text-[11px] uppercase tracking-wide font-sora-medium text-muted-foreground',
      /**
       * 12px uppercase divider above a group of rows or fields.
       *
       * The heavier, one-step-larger sibling of `micro`, and a real role rather
       * than a second opinion about the same one: `micro` is an *eyebrow* — it
       * names the thing directly beneath it (a module identity over a screen
       * title, a unit under a number) and has to stay quieter than what it
       * labels. This one is a *divider* — it separates one group of content
       * from the next, has whitespace on both sides, and has to hold its own
       * against the card edges around it, which 11px medium does not.
       *
       * It existed before this variant did, as
       * `variant="caption" className="font-sora-semibold uppercase tracking-wide"`
       * copy-pasted into 65 places — including `ListSectionHeader`, so lists
       * and dashboards disagreed about section labels by construction. Naming
       * it is what stops the two roles from drifting into three.
       */
      sectionLabel: 'text-xs uppercase tracking-wide font-sora-semibold text-muted-foreground',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

type Props = TextProps & VariantProps<typeof textVariants> & { className?: string };

export function Text({ className, variant, ...props }: Props) {
  // Cap dynamic-type scaling so large OS font sizes don't overflow the app's
  // fixed-height rows/controls. Overridable per-use (props spread wins).
  return (
    <RNText
      maxFontSizeMultiplier={1.4}
      className={cn(textVariants({ variant }), className)}
      {...props}
    />
  );
}
