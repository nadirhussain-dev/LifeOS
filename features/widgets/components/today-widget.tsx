import { FlexWidget, TextWidget } from 'react-native-android-widget';

import { DARK, type HexColor, type WidgetPalette } from '@/features/widgets/components/palette';
import { WIDGET_ACTIONS, WIDGET_LINKS } from '@/features/widgets/config';
import type { TodaySnapshot } from '@/features/widgets/services/widget-snapshot';

/**
 * The "Today at a glance" home-screen widget: tasks due, habits left, and water
 * progress. Built with react-native-android-widget primitives (NOT React Native
 * View/Text) — this tree is rendered by the OS, so only widget components,
 * numeric dp sizes, Android system font families, and hex colors are allowed.
 *
 * Tapping a row deep-links into its screen; tapping the card opens the app. The
 * one exception is the water row's "+1", which does the work in place — see
 * `widget-actions.ts` for why a tap cannot simply write to the database.
 */

function Row({
  color,
  text,
  uri,
  palette,
  trailing,
}: {
  color: HexColor;
  text: string;
  uri: string;
  palette: WidgetPalette;
  trailing?: React.JSX.Element;
}) {
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flex: 1,
          paddingVertical: 4,
        }}
      >
        <FlexWidget
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: color,
            marginRight: 10,
          }}
        />
        <TextWidget
          text={text}
          style={{ fontSize: 15, color: palette.text, fontFamily: 'sans-serif-medium' }}
        />
      </FlexWidget>
      {trailing ?? <FlexWidget style={{ width: 0, height: 0 }} />}
    </FlexWidget>
  );
}

export function TodayWidget({
  snapshot,
  palette = DARK,
}: {
  snapshot: TodaySnapshot;
  palette?: WidgetPalette;
}) {
  const { show, text, waterGlassMl } = snapshot;
  const anyVisible = show.tasks || show.habits || show.water;

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'flex-start',
        backgroundColor: palette.bg,
        borderRadius: 20,
        paddingHorizontal: 18,
        paddingVertical: 16,
      }}
    >
      {/* Every string arrives already translated and already pluralised. This
          component does no formatting at all, because it renders in a headless
          context where i18next is not safe to initialise — see the `text` field
          in widget-snapshot.ts. */}
      <TextWidget
        text={text.heading}
        style={{
          fontSize: 12,
          color: palette.muted,
          fontFamily: 'sans-serif-medium',
          letterSpacing: 1,
        }}
      />
      {show.tasks ? (
        <Row color={palette.tasks} uri={WIDGET_LINKS.tasks} text={text.tasks} palette={palette} />
      ) : null}
      {show.habits ? (
        <Row
          color={palette.habits}
          uri={WIDGET_LINKS.habits}
          text={text.habits}
          palette={palette}
        />
      ) : null}
      {show.water ? (
        <Row
          color={palette.water}
          uri={WIDGET_LINKS.water}
          text={text.water}
          palette={palette}
          trailing={
            /* The only control on this widget. Logging a glass is the single
               most repeated action in the app and the one least worth opening
               the app for — which is exactly what a widget is for. */
            <FlexWidget
              clickAction={WIDGET_ACTIONS.addWater}
              clickActionData={{ ml: waterGlassMl }}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: palette.card,
                marginLeft: 8,
              }}
            >
              <TextWidget
                text="+1"
                style={{
                  fontSize: 13,
                  color: palette.water,
                  fontFamily: 'sans-serif-medium',
                }}
              />
            </FlexWidget>
          }
        />
      ) : null}
      {/*
        Every row hidden. This is what a widget shows when all three modules are
        private, switched off, or simply not synced yet, and it deliberately
        reads the same in all of those cases — "your habits are hidden" would
        announce on the home screen exactly what hiding them was meant to
        prevent. It stays tappable, so it is still a way into the app.
      */}
      {anyVisible ? null : (
        <TextWidget
          text={text.empty}
          style={{
            fontSize: 15,
            color: palette.muted,
            fontFamily: 'sans-serif-medium',
            marginTop: 6,
          }}
        />
      )}
    </FlexWidget>
  );
}
