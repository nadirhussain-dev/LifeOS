import { FlexWidget, TextWidget } from 'react-native-android-widget';

import { DARK, type WidgetPalette } from '@/features/widgets/components/palette';
import { WIDGET_ACTIONS, WIDGET_LINKS } from '@/features/widgets/config';
import type { TodaySnapshot } from '@/features/widgets/services/widget-snapshot';

/**
 * Today's habits, tickable from the home screen.
 *
 * Its own widget rather than more rows on "Today": a list needs height and a
 * glance needs none, and the two want different sizes on the launcher's grid.
 *
 * A tap marks the habit done. It does not toggle — see the comment on the row
 * below, which is the one genuinely arguable decision here.
 */
export function HabitsWidget({
  snapshot,
  palette = DARK,
}: {
  snapshot: TodaySnapshot;
  palette?: WidgetPalette;
}) {
  const { habits, show, text } = snapshot;
  const visible = show.habits ? habits : [];

  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: WIDGET_LINKS.habits }}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        backgroundColor: palette.bg,
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 14,
      }}
    >
      <TextWidget
        text={text.habits || text.heading}
        style={{
          fontSize: 12,
          color: palette.muted,
          fontFamily: 'sans-serif-medium',
          letterSpacing: 1,
          marginBottom: 4,
        }}
      />

      {visible.length === 0 ? (
        /* Same string as the Today widget's empty state, and for the same
           reason: "your habits are hidden" would announce on the home screen
           precisely what hiding them was for. Nothing here distinguishes
           "private", "switched off", "none due today" or "never synced". */
        <TextWidget
          text={text.empty}
          style={{ fontSize: 15, color: palette.muted, fontFamily: 'sans-serif-medium' }}
        />
      ) : (
        visible.map((habit) => (
          <FlexWidget
            key={habit.id}
            /*
              Marks done; it does not un-tick. Two reasons, and the second is the
              real one. A home-screen control has no confirmation and no undo, so
              the destructive direction should not be one accidental tap away.
              And `logHabit` upserts on (habit_id, log_date), so a repeated tap
              is a no-op rather than a double count — which is what makes it safe
              to fire from a queue that may replay. Un-ticking is in the app,
              one tap further away, where there is somewhere to say so.
            */
            clickAction={habit.done ? 'OPEN_URI' : WIDGET_ACTIONS.toggleHabit}
            clickActionData={habit.done ? { uri: WIDGET_LINKS.habits } : { habitId: habit.id }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              width: 'match_parent',
              paddingVertical: 5,
            }}
          >
            <FlexWidget
              style={{
                width: 20,
                height: 20,
                borderRadius: 10,
                marginRight: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: habit.done ? palette.done : palette.card,
              }}
            >
              <TextWidget
                text={habit.done ? '✓' : ''}
                style={{
                  fontSize: 12,
                  color: palette.onAccent,
                  fontFamily: 'sans-serif-medium',
                }}
              />
            </FlexWidget>
            <TextWidget
              text={habit.name}
              style={{
                fontSize: 14,
                color: habit.done ? palette.muted : palette.text,
                fontFamily: 'sans-serif-medium',
              }}
            />
          </FlexWidget>
        ))
      )}
    </FlexWidget>
  );
}
