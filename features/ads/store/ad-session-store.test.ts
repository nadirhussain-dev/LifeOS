import { useAdSessionStore } from '@/features/ads/store/ad-session-store';

/**
 * Session bookkeeping for the pacing rules.
 *
 * Both halves are easy to get subtly wrong in ways nothing reports: a session
 * that never resets means a user sees ads only on their first check-in of the
 * day, and a "first session" that is always true means they never see one at
 * all.
 */
const DAY = 24 * 60 * 60 * 1000;
const MONDAY_9AM = 1_700_000_000_000;

describe('the ad session', () => {
  beforeEach(() =>
    useAdSessionStore.setState({
      sessionDay: null,
      firstSessionToday: true,
      lastShownAt: null,
      shownThisSession: 0,
      sessionStartedAt: 0,
    }),
  );

  it('treats the first session on a new day as the first', () => {
    useAdSessionStore.getState().beginSession(MONDAY_9AM);
    expect(useAdSessionStore.getState().firstSessionToday).toBe(true);
  });

  it('treats a later session on the same day as not the first', () => {
    useAdSessionStore.getState().beginSession(MONDAY_9AM);
    useAdSessionStore.getState().beginSession(MONDAY_9AM + 3 * 60 * 60 * 1000);
    expect(useAdSessionStore.getState().firstSessionToday).toBe(false);
  });

  it('is the first again tomorrow', () => {
    useAdSessionStore.getState().beginSession(MONDAY_9AM);
    useAdSessionStore.getState().beginSession(MONDAY_9AM + DAY);
    expect(useAdSessionStore.getState().firstSessionToday).toBe(true);
  });

  it('resets the spent slots on a new session but keeps the cooldown', () => {
    useAdSessionStore.getState().beginSession(MONDAY_9AM);
    useAdSessionStore.getState().recordShown(MONDAY_9AM + 60_000);
    expect(useAdSessionStore.getState().shownThisSession).toBe(1);

    useAdSessionStore.getState().beginSession(MONDAY_9AM + 2 * 60 * 60 * 1000);
    // The cap is per session, so it starts again...
    expect(useAdSessionStore.getState().shownThisSession).toBe(0);
    // ...but the 180-second floor between two full-screen ads is not, or
    // backgrounding the app would reset it free of charge.
    expect(useAdSessionStore.getState().lastShownAt).toBe(MONDAY_9AM + 60_000);
  });

  it('moves the session start, so the launch guard measures the current session', () => {
    useAdSessionStore.getState().beginSession(MONDAY_9AM);
    useAdSessionStore.getState().beginSession(MONDAY_9AM + DAY);
    expect(useAdSessionStore.getState().sessionStartedAt).toBe(MONDAY_9AM + DAY);
  });
});
