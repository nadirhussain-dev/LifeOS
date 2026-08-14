import { spreadAcross, timeSlots } from '@/features/water-intake/services/water-schedule';
import type { WaterReminderSettings } from '@/features/water-intake/types/water-intake.types';

/**
 * The arithmetic that decides how much of the pending-notification queue
 * hydration consumes. iOS keeps 64 pending notifications and silently discards
 * the rest, so a hydration window that asks for 27 slots is not just noisy —
 * it can cost a task due-time its place in the queue.
 */

const settings = (over: Partial<WaterReminderSettings> = {}): WaterReminderSettings =>
  ({
    enabled: true,
    startHour: 8,
    endHour: 21,
    intervalMinutes: 60,
    ...over,
  }) as WaterReminderSettings;

const label = (slot: { hour: number; minute: number }) =>
  `${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}`;

describe('timeSlots', () => {
  it('covers the window at the requested interval', () => {
    const slots = timeSlots(settings());
    expect(label(slots[0])).toBe('08:00');
    expect(label(slots[slots.length - 1])).toBe('21:00');
  });

  it('returns nothing for a window that ends before it starts', () => {
    expect(timeSlots(settings({ startHour: 21, endHour: 8 }))).toEqual([]);
  });

  it('caps a greedy window instead of scheduling all of it', () => {
    // Every 30 minutes from 08:00 to 21:00 is 27 slots — nearly half the whole
    // platform allowance, for the least important reminder in the app.
    const slots = timeSlots(settings({ intervalMinutes: 30 }));
    expect(slots.length).toBeLessThanOrEqual(24);
    // Still spans the window rather than stopping early.
    expect(label(slots[slots.length - 1])).toBe('21:00');
  });
});

describe('spreadAcross', () => {
  /**
   * Built here rather than from `timeSlots`, which reads `Platform.OS` for its
   * own cap (12 slots on iOS, 24 elsewhere) and would make these assertions
   * depend on which platform the test runner reports.
   *
   * 08:00 … 21:00 on the hour: 14 slots.
   */
  const slots = Array.from({ length: 14 }, (_, i) => ({ hour: 8 + i, minute: 0 }));

  it('leaves the list alone when everything fits', () => {
    expect(spreadAcross(slots, slots.length)).toEqual(slots);
    expect(spreadAcross(slots, 99)).toEqual(slots);
  });

  it('keeps both ends of the window when it has to thin out', () => {
    // The failure this prevents: taking the first N would stop reminding at
    // lunchtime, leaving the whole evening uncovered.
    const chosen = spreadAcross(slots, 4);
    expect(chosen).toHaveLength(4);
    expect(label(chosen[0])).toBe('08:00');
    expect(label(chosen[3])).toBe('21:00');
  });

  it('spaces the survivors evenly rather than clumping them', () => {
    // 14 hourly slots down to 4: every 13/3 ≈ 4.33 indices.
    expect(spreadAcross(slots, 4).map(label)).toEqual(['08:00', '12:00', '17:00', '21:00']);
  });

  it('schedules nothing when there is no room left', () => {
    expect(spreadAcross(slots, 0)).toEqual([]);
    expect(spreadAcross(slots, -3)).toEqual([]);
  });

  it('keeps the start of the window when only one slot is free', () => {
    expect(spreadAcross(slots, 1).map(label)).toEqual(['08:00']);
  });

  it('never returns a hole', () => {
    // Math.round on a fractional step is where an off-by-one would produce an
    // undefined entry, which becomes a crash at the scheduling call.
    for (let permitted = 1; permitted <= slots.length; permitted++) {
      const chosen = spreadAcross(slots, permitted);
      expect(chosen).toHaveLength(permitted);
      expect(chosen.every(Boolean)).toBe(true);
    }
  });
});
