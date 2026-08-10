import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAX_SUGGESTIONS,
  STARTER_HABITS,
  suggestedHabits,
} from '@/features/onboarding/config/starter-habits';
import { FOCUS_AREAS } from '@/features/profile/constants';
import type { FocusArea } from '@/features/profile/store/profile-store';

const ROOT = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/**
 * First-run setup is the one screen every single user sees and most of them see
 * exactly once. These cover the parts that fail silently — an ordering mistake
 * in the gate, or a suggestion list that quietly serves nobody.
 */

describe('the welcome comes before the sign-in wall', () => {
  // The app used to send every unauthenticated visitor to (auth)/login, so the
  // first screen of the app was a password field. Both gates were reordered; if
  // either drifts back the regression is invisible to anyone with a session,
  // which is everybody who works on it.
  it('checks onboarding before the session in the index redirect', () => {
    const source = read('app/index.tsx');
    const onboardingGate = source.indexOf('!onboardingComplete');
    const sessionGate = source.indexOf('!session && !isGuest');
    expect(onboardingGate).toBeGreaterThan(-1);
    expect(sessionGate).toBeGreaterThan(-1);
    expect(onboardingGate).toBeLessThan(sessionGate);
  });

  it('checks onboarding before the session in the auth gate', () => {
    const source = read('features/auth/hooks/use-auth-gate.ts');
    const effect = source.slice(source.indexOf('useEffect('));
    const onboardingGate = effect.indexOf('!onboardingComplete');
    const authedGate = effect.indexOf('if (!authed)');
    expect(onboardingGate).toBeGreaterThan(-1);
    expect(authedGate).toBeGreaterThan(-1);
    expect(onboardingGate).toBeLessThan(authedGate);
  });

  it('lets an unonboarded visitor reach the auth stack', () => {
    // Onboarding sends people into (auth) itself — "use email instead" and
    // "already have an account". Redirecting them straight back out would make
    // both links dead ends, and the failure only shows on a fresh install.
    const source = read('features/auth/hooks/use-auth-gate.ts');
    expect(source).toContain('!inOnboarding && !inAuthGroup');
  });
});

describe('starter habits', () => {
  it('suggests nothing when nothing was picked', () => {
    // The flow drops the whole step in this case rather than showing an empty
    // screen with a Continue button.
    expect(suggestedHabits([])).toEqual([]);
  });

  it('never floods the step, however many areas are picked', () => {
    const everything = FOCUS_AREAS.map((area) => area.id);
    expect(suggestedHabits(everything).length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
  });

  it('leads with the area picked first', () => {
    // Ordered by the user's own picks, not by the order of the config, so the
    // first suggestion belongs to the first thing they said mattered.
    const [first] = suggestedHabits(['budget', 'sleep']);
    expect(first.focus).toBe('budget');
  });

  it('offers something for every focus area', () => {
    // A focus area with no suggestion makes "make it yours" silently thinner the
    // more specific somebody's answer was — the exact opposite of the intent.
    const covered = new Set(STARTER_HABITS.map((habit) => habit.focus));
    const uncovered = FOCUS_AREAS.map((area) => area.id).filter((id) => !covered.has(id));
    expect(uncovered).toEqual([]);
  });

  it('points every suggestion at a real focus area', () => {
    const known = new Set<FocusArea>(FOCUS_AREAS.map((area) => area.id));
    const orphans = STARTER_HABITS.filter((habit) => !known.has(habit.focus)).map((h) => h.id);
    expect(orphans).toEqual([]);
  });

  it('gives every suggestion a unique id', () => {
    // Ids are what the draft store ticks and what the seeder looks up, so a
    // duplicate would create two habits from one checkbox.
    const ids = STARTER_HABITS.map((habit) => habit.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('measures every habit that claims a target', () => {
    const malformed = STARTER_HABITS.filter(
      (habit) => (habit.targetValue == null) !== (habit.unitKey == null),
    ).map((habit) => habit.id);
    expect(malformed).toEqual([]);
  });
});

describe('the seed only claims what it created', () => {
  it('counts habits as they succeed, not as they are requested', () => {
    // The final screen reads from this result. Counting requests instead would
    // let it congratulate somebody for a habit whose insert failed — a lie they
    // discover thirty seconds later, on the screen where it isn't.
    const source = read('features/onboarding/services/seed-from-onboarding.ts');
    const loop = source.slice(source.indexOf('for (const id of'));
    const increment = loop.indexOf('habitsCreated += 1');
    const catchBlock = loop.indexOf('} catch');
    expect(increment).toBeGreaterThan(-1);
    expect(increment).toBeLessThan(catchBlock);
  });

  it('isolates each piece so one failure cannot cost the others', () => {
    const source = read('features/onboarding/services/seed-from-onboarding.ts');
    expect(source.match(/catch \(error\)/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
