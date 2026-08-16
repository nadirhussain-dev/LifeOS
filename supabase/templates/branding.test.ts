import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
    expect.arrayContaining(['confirm-signup.html', 'magic-link.html', 'reset-password.html']),
  );
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
