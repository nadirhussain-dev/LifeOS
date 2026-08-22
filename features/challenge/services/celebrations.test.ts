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

  it('names the event it stopped at, so one sheet is chosen rather than two', () => {
    const { blockedBy } = celebrationsFor(newestFirst(event(1, 'demoted')), 0);
    expect(blockedBy?.kind).toBe('demoted');
  });

  it('stops at a payout too, so it cannot be missed', () => {
    /*
     * The whole reason `reward_granted` blocks rather than toasting. A toast is
     * gone in three seconds and only fires if somebody is holding the phone;
     * the walk halting here means force-quitting on the sheet shows it again
     * next time, which is what a rung that paid out ninety days of Premium is
     * worth.
     */
    const events = newestFirst(event(1, 'tier_reached'), event(2, 'reward_granted'));
    const { show, watermark, blockedBy } = celebrationsFor(events, 0);
    expect(show.map((e) => e.kind)).toEqual(['tier_reached']);
    expect(blockedBy?.id).toBe(2);
    // Stops *before* the payout, so acknowledging the sheet is the only thing
    // that can move the watermark past it.
    expect(watermark).toBe(1);
  });

  it('when a fall and a payout are both unseen, the older one goes first', () => {
    // Both need a sheet and there is one surface. Being congratulated on a
    // payout and then told you fell off the rung is the wrong way round, and
    // two modals racing is worse than either.
    const events = newestFirst(event(1, 'demoted'), event(2, 'reward_granted'));
    expect(celebrationsFor(events, 0).blockedBy?.kind).toBe('demoted');

    const other = newestFirst(event(1, 'reward_granted'), event(2, 'demoted'));
    expect(celebrationsFor(other, 0).blockedBy?.kind).toBe('reward_granted');
  });

  it('reports nothing blocking when the walk ran clean', () => {
    // The screen keys both sheets off this, so "nothing to show" has to be
    // null rather than a stale last event.
    expect(celebrationsFor(newestFirst(event(1, 'tier_reached')), 0).blockedBy).toBeNull();
  });
});
