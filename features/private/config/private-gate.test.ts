import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PRIVATE_SPACE_MODULE_ID,
  isPrivatePath,
  privateModuleForPath,
} from '@/features/hub/config/route-modules';
import { PRIVATE_MODULES } from '@/features/private/config/private-modules';

const ROOT = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/**
 * The private space ships switched off (0074) and stays off until an operator
 * turns it on.
 *
 * The gate has to be complete rather than mostly complete, because the screens
 * it is easiest to forget are the ones that belong to no module — the unlock
 * pad, setup, transfer, receive — and those are exactly the door rather than
 * the rooms behind it.
 */

describe('what the umbrella flag covers', () => {
  it('recognises every /private path, module or not', () => {
    for (const path of [
      '/private',
      '/private/unlock',
      '/private/setup',
      '/private/settings',
      '/private/insights',
      '/private/transfer',
      '/private/receive',
      '/private/cycle',
      '/private/albums/abc',
      '/private/albums/abc/notes',
    ]) {
      expect({ path, inside: isPrivatePath(path) }).toEqual({ path, inside: true });
    }
  });

  it('claims nothing outside it', () => {
    for (const path of ['/', '/(tabs)/hub', '/settings', '/privateer', '/gallery/private']) {
      expect({ path, inside: isPrivatePath(path) }).toEqual({ path, inside: false });
    }
  });

  it('covers the screens that belong to no module', () => {
    /*
     * The gap this closes. `privateModuleForPath` answers null for the space's
     * own screens — it maps a *second* segment, and these have none it knows —
     * so a guard built only on it would hide Cycle and Recovery while leaving
     * the unlock pad, setup and the space's home wide open.
     */
    for (const path of ['/private', '/private/unlock', '/private/setup', '/private/transfer']) {
      expect(privateModuleForPath(path)).toBeNull();
      expect(isPrivatePath(path)).toBe(true);
    }
  });
});

describe('the seed', () => {
  const migration = read('supabase/migrations/0074_private_space_off_until_admin.sql');

  it('switches off the umbrella and every module behind it', () => {
    // A module absent from the seed is a module `module_flags` treats as
    // enabled (0011 rule 1) — the right default for an ordinary module and the
    // wrong one for these.
    const seeded = [...migration.matchAll(/\('([a-z-]+)',\s*false/g)].map((m) => m[1]);

    expect(seeded).toContain(PRIVATE_SPACE_MODULE_ID);
    for (const module of PRIVATE_MODULES) {
      expect({ module: module.id, seeded: seeded.includes(module.id) }).toEqual({
        module: module.id,
        seeded: true,
      });
    }
  });

  it('never re-closes a space an operator has already opened', () => {
    // `do nothing`, not `do update`. Re-applying the migration must not take
    // back a decision the console has since made.
    expect(migration).toContain('on conflict (module) do nothing');
  });

  it('carries no message, because a message is a disclosure', () => {
    /*
     * Everywhere else `message` is the operator's explanation for an outage.
     * Here it would describe a feature the user is not supposed to know exists
     * — `private-modules.ts`'s first rule, applied to the door.
     */
    expect(migration).not.toMatch(
      /\(\s*'(private|cycle|recovery|intimacy|vault)'[^)]*'[^']+',\s*null,\s*now/,
    );
  });
});

describe('the guard', () => {
  const guard = read('features/module-flags/hooks/use-module-access.ts');

  it('checks the space before the modules inside it', () => {
    const umbrella = guard.indexOf('PRIVATE_SPACE_MODULE_ID');
    const perModule = guard.indexOf('privateModuleForPath(pathname)');
    expect(umbrella).toBeGreaterThan(-1);
    expect(perModule).toBeGreaterThan(-1);
    expect(umbrella).toBeLessThan(perModule);
  });

  it('sends a closed space somewhere outside itself', () => {
    /*
     * The per-module branch redirects to `/private` — the space's own home,
     * which is right when the space is open and the module is not. A closed
     * space has no home to send anyone to, and redirecting there would land
     * back inside the thing being refused, forever.
     */
    const branch = guard.slice(
      guard.indexOf('isPrivatePath(pathname)'),
      guard.indexOf('const privateModuleId'),
    );
    expect(branch).toContain("router.replace('/(tabs)/hub')");
    expect(branch).not.toContain("'/private'");
  });
});

describe('the way in', () => {
  it('is absent rather than disabled while the space is off', () => {
    // A greyed-out row tells a snooping partner exactly what is being hidden,
    // which is the thing the feature exists to prevent.
    const settings = read('app/settings/index.tsx');
    expect(settings).toContain('privateHidden || privateSpaceOff ? null : (');
  });
});
