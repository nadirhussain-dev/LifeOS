import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  drainWidgetActions,
  enqueueWidgetAction,
  localDateKey,
  readWidgetActions,
} from '@/features/widgets/services/widget-actions';

/**
 * The widget's tap queue is the one place in the app where a write is deferred
 * across a process boundary, so its two dangerous properties are worth pinning:
 * it must not replay (water is append-only, so a replayed tap invents a glass
 * nobody drank), and it must not misfile a tap made near midnight.
 */

beforeEach(async () => {
  await drainWidgetActions();
});

describe('localDateKey', () => {
  it('uses the local calendar day, not UTC', () => {
    // The reason the action carries a date at all. A glass logged at 11:50pm and
    // drained when the app opens at 8am must land on the day it was drunk — and
    // building the key from toISOString() is how it lands on the wrong one. Two
    // prior instances of exactly this mistake are fixed in 3dd6f71 and a7dfbdc.
    const lateNight = new Date(2026, 4, 17, 23, 50);
    expect(localDateKey(lateNight.getTime())).toBe('2026-05-17');
  });

  it('pads months and days', () => {
    expect(localDateKey(new Date(2026, 0, 3, 12, 0).getTime())).toBe('2026-01-03');
  });
});

describe('the queue', () => {
  it('keeps taps in the order they were made', async () => {
    await enqueueWidgetAction({ kind: 'water', ml: 250, at: 1, logDate: '2026-05-17' });
    await enqueueWidgetAction({ kind: 'habit-done', habitId: 'h1', at: 2, logDate: '2026-05-17' });

    const queued = await readWidgetActions();
    expect(queued.map((a) => a.kind)).toEqual(['water', 'habit-done']);
  });

  it('empties on drain, so nothing is applied twice', async () => {
    // `logWater` appends rather than upserts, so a queue that survived its own
    // drain would add a glass on every launch, forever.
    await enqueueWidgetAction({ kind: 'water', ml: 250, at: 1, logDate: '2026-05-17' });

    expect(await drainWidgetActions()).toHaveLength(1);
    expect(await drainWidgetActions()).toHaveLength(0);
  });

  it('drops the oldest rather than growing without limit', async () => {
    // A pocket-tapping accident should cost the earliest taps, not the phone's
    // ability to write its own preferences.
    for (let i = 0; i < 60; i += 1) {
      await enqueueWidgetAction({ kind: 'water', ml: i, at: i, logDate: '2026-05-17' });
    }

    const queued = await readWidgetActions();
    expect(queued).toHaveLength(50);
    expect((queued[0] as { ml: number }).ml).toBe(10);
    expect((queued[49] as { ml: number }).ml).toBe(59);
  });

  it('survives a corrupted queue rather than throwing', async () => {
    // This is read on launch, ahead of the first frame. A half-written value
    // from an older build must cost the queue, not the app.
    await AsyncStorage.setItem('lifeos.widget.actions.v1', '{not json');

    expect(await readWidgetActions()).toEqual([]);
  });
});
