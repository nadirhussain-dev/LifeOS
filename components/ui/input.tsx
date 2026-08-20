import { forwardRef, useState, type ReactNode } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';
import { cn } from '@/lib/utils';

type Props = Omit<TextInputProps, 'placeholderTextColor'> & {
  /** Micro label above the field. */
  label?: string;
  /** Validation message. Present → the field reads as invalid and says why. */
  error?: string;
  /** Quiet helper line below the field. Hidden while `error` is showing. */
  hint?: string;
  /** Accessory inside the border, after the input — eye toggle, unit, clear. */
  trailing?: ReactNode;
  /** Accessory inside the border, before the input — currency, search icon. */
  leading?: ReactNode;
  /** Classes for the input itself. */
  className?: string;
  /** Classes for the label + field + message stack. */
  containerClassName?: string;
  /** Classes for the bordered row holding leading + input + trailing. */
  fieldClassName?: string;
  /**
   * The surface the field is drawn on.
   *
   * `field` is the app's existing field shape, which is exactly
   * `cardClass({ padding: 'row' })` — 29 of the hand-rolled inputs already drew
   * themselves that way, so they migrate with no visual change at all.
   *
   * `card` is for the fields drawn as content cards (a note body, a long
   * description) — the case `components/ui/card.tsx` calls out in its own
   * docstring as "a few are TextInput (fields drawn as cards)".
   *
   * `bare` draws no surface, for an input that sits inside a row its parent has
   * already bordered. It still gets the placeholder colour, the dynamic-type
   * cap and the invalid announcement; it cannot get the halo, because the
   * border it would ring belongs to something else.
   */
  surface?: 'field' | 'card' | 'bare';
};

/**
 * The one text field.
 *
 * The kit had a Button, a Card, a Segmented, a StarRating and a WeekdayPicker,
 * and no input — so all 110 `TextInput`s across 75 files were hand-assembled,
 * and every field-level concern was a repeated omission rather than one bug:
 *
 *   • `placeholderTextColor` was correct in all 117 uses, but only because
 *     three cohorts of copy-paste happened to agree on `mutedForeground`
 *     (spelled three different ways). Nothing caught the 118th site.
 *   • `--ring` and `--input` were defined in all three token layers — CSS vars,
 *     Tailwind config, design-tokens — and consumed by literally nothing. All
 *     223 field borders used `border-border`. This is their first consumer.
 *   • No field in the app had a visible focus state. Four of 75 files had an
 *     `onFocus` at all and two of those used it to scroll. On a multi-field
 *     form nothing said where the keyboard was pointed — a polish gap when
 *     sighted, a navigation failure on an external keyboard or Switch Control.
 *   • `Text` caps dynamic type at 1.4× so large OS font sizes can't overflow
 *     fixed-height rows. Zero of the 110 inputs carried that cap, so at max
 *     text size a field's value outgrew its own label.
 *
 * The focus halo is drawn by the wrapper's always-present 2px padding rather
 * than by growing the border, so gaining focus cannot shift layout — a field
 * that nudges its neighbours when tapped is worse than no indicator at all.
 *
 * `leading`/`trailing` sit inside the border because the accessory belongs to
 * the field: an eye toggle outside the box reads as a separate control, and the
 * hand-rolled fields that got this right had each rebuilt the border row to do
 * it. The border lives on that row, not on the `TextInput`, which is what lets
 * an accessory share it.
 */
export const Input = forwardRef<TextInput, Props>(function Input(
  {
    label,
    error,
    hint,
    leading,
    trailing,
    className,
    containerClassName,
    fieldClassName,
    surface = 'field',
    onFocus,
    onBlur,
    ...props
  },
  ref,
) {
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error ? c.error : focused ? c.ring : c.input;
  const bare = surface === 'bare';

  const surfaceClass =
    surface === 'card'
      ? cardClass({ padding: 'md', elevation: 'e1' })
      : surface === 'field'
        ? 'rounded-2xl border bg-card px-4'
        : '';

  const field = (
    <View
      className={cn('flex-row items-center', surfaceClass, fieldClassName)}
      style={bare ? undefined : { borderColor }}
    >
      {leading}
      <TextInput
        ref={ref}
        placeholderTextColor={c.mutedForeground}
        // Matches components/ui/text.tsx, for the reason given there.
        maxFontSizeMultiplier={1.4}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        className={cn('flex-1 py-3 font-sans text-base text-foreground', className)}
        {...props}
        /*
         * After the spread, deliberately.
         *
         * React Native has no `invalid` accessibility state (the platform
         * union is disabled/selected/checked/busy/expanded), so an invalid
         * field is announced by folding the message into its label. That
         * has to beat a caller-supplied label rather than lose to it, or
         * the error stays red text a screen reader only reaches if the user
         * happens to swipe onto it — "never colour alone" applies to
         * assistive tech first.
         */
        accessibilityLabel={
          [props.accessibilityLabel ?? label, error].filter(Boolean).join(', ') || undefined
        }
      />
      {trailing}
    </View>
  );

  return (
    <View className={cn('gap-1.5', containerClassName)}>
      {label ? <Text variant="micro">{label}</Text> : null}

      {bare ? (
        field
      ) : (
        /*
         * The halo. Padding is unconditional and only its colour changes, so
         * gaining focus cannot shift layout.
         *
         * 32px outer against the 28px field: geometrically 30 is exact, but the
         * radius scale in tailwind.config.js runs 20 → 28 → 32 with nothing
         * between, and an off-scale literal here is what this component exists
         * to stop other people writing. 32 reads as a soft outer glow; 28 would
         * clip the corners it is meant to surround.
         */
        <View
          className="rounded-3xl p-0.5"
          style={{ backgroundColor: focused ? alpha(c.ring, 0.18) : 'transparent' }}
        >
          {field}
        </View>
      )}

      {error ? (
        <Text
          variant="caption"
          style={{ color: c.error }}
          // So a screen reader hears the message when it appears, not only if
          // the user happens to swipe back onto the field.
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption">{hint}</Text>
      ) : null}
    </View>
  );
});
