import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * That a server-side secret never acquires a client-side prefix.
 *
 * `RESEND_API_KEY` sends mail as our domain and `EXPO_ACCESS_TOKEN` pushes to
 * our users. Both are read only by Deno inside Supabase's runtime. Metro
 * inlines every `EXPO_PUBLIC_*` name into the bundle, so prefixing either one —
 * or copying it into the app's `.env.example` where every name around it is
 * prefixed — puts it in an APK that anyone who installs the app can unzip.
 *
 * That mistake is silent in both directions: the build succeeds, and the
 * function keeps working because it reads its own environment regardless. This
 * is the only thing that would notice.
 */

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** Assignments only — the surrounding prose explains the prefix rule at length
 *  and must stay free to name it. */
const assignedNames = (file: string) =>
  [...file.matchAll(/^\s*([A-Z0-9_]+)\s*=/gm)].map((m) => m[1]);

const EDGE_ONLY = ['RESEND_API_KEY', 'INVITE_FROM', 'APP_INVITE_BASE_URL', 'EXPO_ACCESS_TOKEN'];

describe('supabase/.env.example', () => {
  const template = read('supabase/.env.example');
  const names = assignedNames(template);

  it('assigns nothing that Metro would inline into the bundle', () => {
    expect(names.filter((n) => n.startsWith('EXPO_PUBLIC_'))).toEqual([]);
  });

  /** The prefix is reserved: one such line makes the whole push fail, not just
   *  that line, which reads as "secrets are broken" rather than "remove this". */
  it('assigns no SUPABASE_ name, which the CLI rejects', () => {
    expect(names.filter((n) => n.startsWith('SUPABASE_'))).toEqual([]);
  });

  it('covers every secret the functions actually read', () => {
    for (const name of EDGE_ONLY) expect(names).toContain(name);
  });

  /** A template that ships a usable-looking key invites pushing it as-is. */
  it('ships placeholders, not values that could be mistaken for real', () => {
    expect(template).toContain('re_REPLACE_WITH_RESEND_API_KEY');
    expect(template).not.toMatch(/RESEND_API_KEY=re_[A-Za-z0-9]{16,}/);
  });
});

describe('the app env template', () => {
  const appTemplate = read('.env.example');

  it('does not assign any edge-only secret', () => {
    const names = assignedNames(appTemplate);
    for (const name of EDGE_ONLY) expect(names).not.toContain(name);
  });
});

describe('the functions themselves', () => {
  it.each(['send-invite', 'notify-group', 'notify-album'])(
    '%s reads no EXPO_PUBLIC_ name',
    (fn) => {
      const source = read(join('supabase', 'functions', fn, 'index.ts'));
      expect(source).not.toContain('EXPO_PUBLIC_');
    },
  );
});
