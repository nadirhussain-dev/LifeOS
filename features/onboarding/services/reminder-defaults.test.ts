import { remindersForFocus } from '@/features/onboarding/services/reminder-defaults';

/**
 * Which reminders first run switches on.
 *
 * The failure worth guarding is asymmetric. A reminder that fails to switch on
 * is a feature the user has to find in Settings — annoying. A reminder that
 * switches on for a module they never chose is a notification they cannot trace
 * back to anything they said, and the reflex is to disable the whole category
 * — which costs them the reminders they did want. So "only what was asked for"
 * is the property pinned hardest here.
 */
describe('remindersForFocus', () => {
  it('turns on nothing when no focus areas were chosen', () => {
    // Skipping the focus step must leave a silent app, not a default barrage.
    expect(remindersForFocus([])).toEqual([]);
  });

  it('turns on only the modules behind the chosen areas', () => {
    expect(remindersForFocus(['journal', 'water'])).toEqual(['journal', 'water']);
  });

  it('does not infer one module from another', () => {
    // Picking Sleep must not produce a hydration schedule on the grounds that
    // both are "wellbeing". A notification the user cannot trace to an answer
    // they gave is the one that gets the category switched off.
    expect(remindersForFocus(['sleep'])).toEqual([]);
  });

  it('ignores focus areas that have no defaultable reminder', () => {
    // Habits, tasks, budget and sleep are all real focus areas whose reminders
    // cannot honestly be defaulted on — see the service header for why each is
    // excluded. They must not appear here just because they were chosen.
    expect(remindersForFocus(['habits', 'tasks', 'budget', 'sleep', 'fitness'])).toEqual([]);
  });

  it('turns on everything defaultable when everything is chosen', () => {
    expect(remindersForFocus(['journal', 'study', 'goals', 'water']).sort()).toEqual([
      'goals',
      'journal',
      'study',
      'water',
    ]);
  });
});
