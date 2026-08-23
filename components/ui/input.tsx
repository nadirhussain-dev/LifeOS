import { forwardRef, useState, type ComponentType, type ReactNode } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { radius } from '@/constants/design-tokens';
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
  /** Accessory inside the border, before the input — currency, search icon. */
  leading?: ReactNode;
  /** Accessory inside the border, after the input — eye toggle, unit, clear. */
  trailing?: ReactNode;
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
   * themselves that way, so they migrated with no visual change at all.
   *
   * `card` is for the fields drawn as content cards (a note body, a long
   * description) — the case `components/ui/card.tsx` calls out in its own
   * docstring as "a few are TextInput (fields drawn as cards)".
   *
   * `bare` draws no surface, for an input sitting inside a row its parent has
   * already bordered and laid out.
   */
  surface?: 'field' | 'card' | 'bare';
  /** Padding for `surface="card"`, matching the card scale. */
  cardPadding?: 'none' | 'sm' | 'md' | 'lg' | 'row' | 'rowLg';
  /**
   * Elevation for `surface="card"`. Defaults to `flat`, which is `cardClass`'s
   * own default — most of the card-shaped fields were flat, and defaulting to
   * `e1` here would have quietly added a shadow to each of them.
   */
  cardElevation?: 'flat' | 'e1' | 'e2';
  /**
   * The underlying input element. Defaults to React Native's `TextInput`.
   *
   * Exists for `BottomSheetTextInput` from @gorhom/bottom-sheet, which the eight
   * fields inside sheets have to use — a plain `TextInput` in a bottom sheet does
   * not lift itself above the keyboard. They were the last hold-outs from this
   * component, and the reason was never the styling; it was the element.
   */
  as?: ComponentType<TextInputProps>;
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
    cardPadding = 'md',
    cardElevation = 'flat',
    as: Element = TextInput,
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

  /*
   * A bare field with nothing around it renders as just the `TextInput`, with no
   * wrapper views at all.
   *
   * 42 of the hand-rolled inputs sit inside a row their parent has already
   * bordered and laid out, usually as `flex-1` beside an icon. Wrapping those in
   * two extra views to migrate them would risk a layout shift on every one for
   * no gain — the surface, the border and the spacing are the parent's. This
   * path gives them the placeholder token, the dynamic-type cap and the invalid
   * announcement, and changes nothing about where anything sits.
   *
   * They do not get the focus halo. That is honest rather than ideal: the border
   * it would ring belongs to the parent, so indicating focus properly means
   * lifting the whole row in here — worth doing per screen, as AuthField did,
   * and not something a bulk migration should decide.
   */
  const unwrapped = bare && !label && !error && !hint && !leading && !trailing;

  const surfaceClass =
    surface === 'card'
      ? cardClass({ padding: cardPadding, elevation: cardElevation })
      : surface === 'field'
        ? 'rounded-2xl border bg-card px-4'
        : '';

  /*
   * Built once so the element can be swapped without restating them.
   *
   * The ref reaches the default `TextInput` only. `BottomSheetTextInput` types
   * its own ref as `TextInput | undefined`, which is not assignable to a
   * `Ref<TextInput>`, and none of the eight sheet fields take one — widening the
   * `as` contract to `any` to paper over that would be the only `any` here.
   */
  const inputProps: TextInputProps & { className?: string } = {
    placeholderTextColor: c.mutedForeground,
    /*
     * Android draws its own underline behind every `TextInput`, and it is
     * tinted with the platform accent — which in this app is emerald. So on
     * Android a field rendered inside our own rounded, bordered surface also
     * carried a green line and, on the focused state, a green wash bleeding out
     * under the bottom edge of the field. It reads as a rendering bug because
     * it is one: two focus indicators, one of them not ours and neither of them
     * agreeing with the other.
     *
     * `transparent` rather than a colour, because this component already has a
     * focus indicator — the border changes to `ring` and the halo appears
     * behind it. The platform's job here is to draw text and a cursor.
     *
     * On the props object rather than at each call site: there were 75
     * hand-rolled fields before this component existed, and the whole reason it
     * exists is that a detail every call site has to remember is a detail most
     * of them will not.
     */
    underlineColorAndroid: 'transparent',
    // Matches components/ui/text.tsx, for the reason given there.
    maxFontSizeMultiplier: 1.4,
    onFocus: (e) => {
      setFocused(true);
      onFocus?.(e);
    },
    onBlur: (e) => {
      setFocused(false);
      onBlur?.(e);
    },
    className: cn(
      bare ? 'text-foreground' : 'flex-1 py-3 font-sans text-base text-foreground',
      className,
    ),
    ...props,
    /*
     * After the spread, deliberately.
     *
     * React Native has no `invalid` accessibility state (the platform union is
     * disabled/selected/checked/busy/expanded), so an invalid field is announced
     * by folding the message into its label. That has to beat a caller-supplied
     * label rather than lose to it, or the error stays red text a screen reader
     * only reaches if the user happens to swipe onto it — "never colour alone"
     * applies to assistive tech first.
     */
    accessibilityLabel:
      [props.accessibilityLabel ?? label, error].filter(Boolean).join(', ') || undefined,
  };

  const input =
    Element === TextInput ? <TextInput ref={ref} {...inputProps} /> : <Element {...inputProps} />;

  if (unwrapped) return input;

  const field = (
    <View
      className={cn('flex-row items-center', surfaceClass, fieldClassName)}
      style={bare ? undefined : { borderColor }}
    >
      {leading}
      {input}
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
         * The halo. Geometry is unconditional and only the colour changes, so
         * gaining focus cannot shift layout.
         *
         * Radius and padding sit in the same object as the colour, deliberately.
         * They were a `rounded-3xl p-0.5` className while the colour came from
         * `style`, and the corners did not survive it: the halo painted a
         * *square* of tinted green behind a fully rounded field, so focusing the
         * email field on the sign-in screen showed four green corners around the
         * pill. Whatever the merge order is doing, geometry that has to agree
         * with a colour should not be able to disagree with it, and one object
         * has no order to get wrong.
         *
         * 32 against the 28 the field carries: geometrically 30 is exact, but 30
         * is not on the scale, and an off-scale literal is what this component
         * exists to stop other people writing. Taken from the `radius` token
         * rather than typed, so it moves if the scale does. 32 reads as a soft
         * outer glow; 28 would clip the corners it is meant to surround.
         */
        <View
          style={{
            borderRadius: radius['3xl'],
            padding: 2,
            backgroundColor: focused ? alpha(c.ring, 0.18) : 'transparent',
          }}
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
