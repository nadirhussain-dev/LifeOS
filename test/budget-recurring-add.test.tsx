import { render } from '@testing-library/react-native';
import React from 'react';

import RecurringScreen from '@/app/budget/recurring';

/**
 * The reported bug, pinned at the level it happened: with rules on screen,
 * there must still be a way to add another.
 *
 * The add affordance used to be the `EmptyState`'s action and nothing else, so
 * it existed only while there were no rules. Saving the first one swapped in
 * the list branch, which had no add button anywhere, and a second recurring
 * payment became unreachable from this screen or any other.
 *
 * A render test rather than a source scan because the failure is about which
 * branch is on screen — the button was always *in the file*.
 */

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/lib/dialog-store', () => ({ confirm: jest.fn(async () => false) }));

const mockRecurring = jest.fn();
jest.mock('@/features/budget/hooks/use-recurring', () => ({
  useRecurring: () => mockRecurring(),
  useRecurringMutations: () => ({
    setActive: { mutate: jest.fn() },
    remove: { mutate: jest.fn() },
  }),
}));
jest.mock('@/features/budget/hooks/use-budget', () => ({
  useBudgetSettings: () => ({ data: { currency: 'USD' } }),
}));

const RULE = {
  id: 'r1',
  category: 'food',
  amountCents: 120000,
  frequency: 'monthly',
  interval: 1,
  isActive: true,
  note: 'Rent',
  anchorDate: '2026-01-01',
  lastPostedDate: null,
  createdAt: 0,
  updatedAt: 0,
};

// i18n is not initialised in unit tests, so `t` hands back the key. Asserting
// on the key is the stabler choice anyway: this test is about the button
// existing, not about what it is called this week.
const ADD_LABEL = 'budget.addRecurring';

beforeEach(() => {
  mockRecurring.mockReturnValue({ data: [], isError: false, error: null, refetch: jest.fn() });
});

it('offers the action on the empty state', async () => {
  const view = await render(<RecurringScreen />);
  // The empty state renders its action as a labelled button; the Fab is there
  // too. Either satisfies the screen — this is the branch that was never broken.
  expect(
    view.queryAllByText(ADD_LABEL).length + view.queryAllByLabelText(ADD_LABEL).length,
  ).toBeGreaterThan(0);
});

it('still offers one once a rule exists — the reported bug', async () => {
  mockRecurring.mockReturnValue({
    data: [RULE],
    isError: false,
    error: null,
    refetch: jest.fn(),
  });
  const view = await render(<RecurringScreen />);
  // Before the fix this branch rendered the list and nothing else, so a second
  // recurring payment could not be created at all.
  expect(view.getAllByLabelText(ADD_LABEL).length).toBeGreaterThan(0);
});
