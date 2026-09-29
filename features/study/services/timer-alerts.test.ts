import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  STUDY_KEY_PREFIX,
  TIMER_PHASE_END_KEY,
} from '@/features/notifications/services/notification-keys';
import { alertKeysFor } from '@/features/study/services/timer-alerts';

const LOCALES = ['en', 'ar', 'ur', 'hi'] as const;

describe('the pomodoro phase-end alarm', () => {
  it('is keyed outside the study reminder prefix', () => {
    // `study-reminders.ts` rebuilds its weekly set with
    // `cancelScheduledByKeyPrefix(STUDY_KEY_PREFIX)`. A timer alarm keyed under
    // that prefix would be cancelled by somebody opening study reminder
    // settings mid-session: the countdown keeps running and simply never goes
    // off, with nothing on screen or in the queue saying why. The two keys look
    // like they belong together, which is the whole danger.
    expect(TIMER_PHASE_END_KEY.startsWith(STUDY_KEY_PREFIX)).toBe(false);
  });

  it('uses one key for both phases', () => {
    // Only one phase runs at a time, so entering a phase must *replace* the
    // alarm for the one just left rather than queue alongside it. Two keys
    // would leave the focus alarm armed through the break.
    const focus = alertKeysFor('focus');
    const brk = alertKeysFor('break');
    expect(focus).not.toEqual(brk);
    // ...different copy, same identity — the identity lives in the key.
    expect(TIMER_PHASE_END_KEY).toBe('timer:phase-end');
  });

  it('names copy that exists in every language', () => {
    // The alarm text is resolved through `t` at schedule time; a key with no
    // translation schedules a notification whose body is the key itself.
    const keys = [...Object.values(alertKeysFor('focus')), ...Object.values(alertKeysFor('break'))];
    for (const locale of LOCALES) {
      const path = join(__dirname, '..', '..', '..', 'lib', 'i18n', 'locales', `${locale}.json`);
      const messages = JSON.parse(readFileSync(path, 'utf8')) as Record<
        string,
        Record<string, string>
      >;
      for (const key of keys) {
        const [namespace, name] = key.split('.');
        expect(typeof messages[namespace]?.[name]).toBe('string');
        expect(messages[namespace][name].length).toBeGreaterThan(0);
      }
    }
  });
});
