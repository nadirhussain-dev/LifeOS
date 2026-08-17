import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { MAILER_TEMPLATES } from '../../scripts/auth-config.mjs';

/**
 * That every outbound email says Daykeep.
 *
 * These templates are pasted into Supabase Auth → Email Templates by hand, so
 * nothing imports them, nothing renders them under test, and no typecheck ever
 * looks at them. That is exactly how all three kept the "LifeOS" wordmark
 * through the rename — the app was fully rebranded while the first email a new
 * user ever received still showed the old name.
 *
 * Source text is the only thing there is to assert on, and it is enough: the
 * question is whether the old brand appears, which is answerable statically.
 * The invite email that goes out through Resend is covered separately, by
 * supabase/functions/send-invite/index.test.ts, which actually executes it.
 */

const DIR = __dirname;
const templates = readdirSync(DIR).filter((f) => f.endsWith('.html'));

/** A guard that guards nothing is worse than none — if the templates are ever
 *  moved, this fails rather than passing over an empty list. */
it('finds the auth email templates', () => {
  expect(templates).toEqual(
    expect.arrayContaining([
      'confirm-signup.html',
      'magic-link.html',
      'reset-password.html',
      'email-change.html',
      'reauthentication.html',
    ]),
  );
});

/**
 * The list the deploy script applies and the files on disk are the same set.
 *
 * These fail in opposite directions and both are silent. A file with no entry
 * in MAILER_TEMPLATES is never uploaded, so the project keeps sending
 * Supabase's stock email while the repository contains a branded one that
 * looks applied. An entry with no file makes the script throw at step 4 —
 * after it has already repointed SMTP — leaving the project half-configured.
 */
describe('the deploy script', () => {
  it('applies exactly the templates that exist', () => {
    expect(MAILER_TEMPLATES.map((t) => t.file).sort()).toEqual([...templates].sort());
  });

  /** The subject is set by the script; the same line is repeated in a comment
   *  at the top of each file for whoever pastes one in by hand. Two copies of
   *  a string drift, and the drift shows up in somebody's inbox. */
  it.each(MAILER_TEMPLATES)('$file documents the subject the script sets', (template) => {
    expect(readFileSync(join(DIR, template.file), 'utf8')).toContain(template.subject);
  });
});

describe.each(templates)('%s', (file) => {
  const html = readFileSync(join(DIR, file), 'utf8');

  it('carries no trace of the old brand', () => {
    expect(html).not.toMatch(/LifeOS/i);
    // The specific shape the rename left behind: a wordmark split across a
    // span so a plain "LifeOS" search never found it.
    expect(html).not.toMatch(/Life<span/);
  });

  it('shows the Daykeep wordmark', () => {
    expect(html).toContain('Daykeep');
  });

  /** The wordmark is one solid colour, matching components/animated-splash.tsx.
   *  The `.accent` dark-mode rule existed only for the old two-tone lockup, so
   *  a reference to it here means half a wordmark is being coloured again. */
  it('does not resurrect the two-tone lockup', () => {
    expect(html).not.toContain('class="accent"');
  });
});
