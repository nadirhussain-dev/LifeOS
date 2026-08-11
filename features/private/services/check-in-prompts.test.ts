import { nextCheckInPrompt } from '@/features/private/services/check-in-prompts';

describe('nextCheckInPrompt', () => {
  it('is deterministic — the same date always returns the same prompt', () => {
    const date = new Date(2026, 7, 10);
    expect(nextCheckInPrompt(date)).toBe(nextCheckInPrompt(new Date(2026, 7, 10)));
  });

  it('returns a key under the private.checkIn namespace', () => {
    expect(nextCheckInPrompt(new Date(2026, 7, 10))).toMatch(/^private\.checkIn\./);
  });

  it('rotates across the year rather than returning one fixed prompt', () => {
    const prompts = new Set<string>();
    for (let day = 0; day < 365; day += 1) {
      prompts.add(nextCheckInPrompt(new Date(2026, 0, 1 + day)));
    }
    expect(prompts.size).toBeGreaterThan(1);
  });

  it('does not crash on the leap-year day', () => {
    expect(() => nextCheckInPrompt(new Date(2028, 1, 29))).not.toThrow();
  });

  it('two consecutive days usually differ (rotation, not a static prompt)', () => {
    const day1 = nextCheckInPrompt(new Date(2026, 2, 1));
    const day2 = nextCheckInPrompt(new Date(2026, 2, 2));
    expect(day1).not.toBe(day2);
  });
});
