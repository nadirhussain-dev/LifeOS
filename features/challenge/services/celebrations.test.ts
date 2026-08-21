import { celebrationsFor } from '@/features/challenge/services/celebrations';
import type { ChallengeEvent } from '@/features/challenge/hooks/use-challenge';

const event = (id: number, kind: string): ChallengeEvent => ({
  id,
  kind,
  detail: {},
  createdAt: new Date(id * 1000).toISOString(),
});

/** As the query returns them: newest first. */
const newestFirst = (...events: ChallengeEvent[]) => [...events].reverse();

describe('celebrationsFor', () => {
  it('says nothing about events already seen', () => {
    const { show, watermark } = celebrationsFor(newestFirst(event(1, 'tier_reached')), 1);
    expect(show).toEqual([]);
    expect(watermark).toBe(1);
  });

  it('announces a rung, a shield and a win', () => {
    const events = newestFirst(
      event(1, 'tier_reached'),
      event(2, 'shield_earned'),
      event(3, 'completed'),
    );
    const { show, watermark } = celebrationsFor(events, 0);
    expect(show.map((e) => e.kind)).toEqual(['tier_reached', 'shield_earned', 'completed']);
    expect(watermark).toBe(3);
  });

  it('shows them oldest first, which is the order they happened', () => {
    const { show } = celebrationsFor(
      newestFirst(event(4, 'shield_earned'), event(9, 'completed')),
      0,
    );
    expect(show.map((e) => e.id)).toEqual([4, 9]);
  });

  it('stops at a fall so the demotion sheet still finds it', () => {
    /*
     * The watermark is shared. Advancing past an unseen `demoted` would swallow
     * the sheet's only trigger — the fall would never be shown and the win-back
     * notification, armed off the same event, would never be scheduled.
     */
    const events = newestFirst(
      event(1, 'tier_reached'),
      event(2, 'demoted'),
      event(3, 'shield_earned'),
    );
    const { show, watermark } = celebrationsFor(events, 0);
    expect(show.map((e) => e.id)).toEqual([1]);
    expect(watermark).toBe(1);
  });

  it('leaves the watermark alone when the very next event is a fall', () => {
    const { show, watermark } = celebrationsFor(newestFirst(event(7, 'demoted')), 6);
    expect(show).toEqual([]);
    expect(watermark).toBe(6);
  });

  it('walks past events that are seen but never announced', () => {
    // Otherwise an `enrolled` or `module_swapped` row would wedge the walk
    // behind something nothing will ever say out loud.
    const events = newestFirst(
      event(1, 'enrolled'),
      event(2, 'module_swapped'),
      event(3, 'tier_reached'),
    );
    const { show, watermark } = celebrationsFor(events, 0);
    expect(show.map((e) => e.id)).toEqual([3]);
    expect(watermark).toBe(3);
  });

  it('celebrates the season closing, which is written by the cron and not by a tap', () => {
    const { show } = celebrationsFor(newestFirst(event(2, 'season_ended')), 1);
    expect(show.map((e) => e.kind)).toEqual(['season_ended']);
  });
});
