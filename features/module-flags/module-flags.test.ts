import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HUB_SECTIONS } from '@/features/hub/config/modules';
import { SEGMENT_TO_MODULE } from '@/features/hub/config/route-modules';

/**
 * The remote kill switch is the one feature here that can make the app *less*
 * useful, aimed at every user at once. These tests hold the two properties that
 * keep it safe to own: it fails open, and it never touches data.
 */
const ROOT = join(__dirname, '..', '..');
const readCode = (path: string) =>
  readFileSync(join(ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

describe('module flags fail open', () => {
  it('treats an absent flag as enabled', () => {
    // Absence has to mean enabled in three places at once: no row on the
    // server, no entry in the cache, and no successful fetch yet. Collapsing
    // them any other way means a network blip strips somebody's app bare.
    const store = readCode('features/module-flags/store/module-flags-store.ts');
    expect(store).toContain('!== false');
  });

  it('never clears the cache when a fetch fails', () => {
    // The mirror of failing open: if the operator pulled a module because it
    // corrupts data, a flaky connection must not hand it back.
    const service = readCode('features/module-flags/services/module-flags.ts');
    const runRefresh = service.slice(service.indexOf('async function runRefresh'));
    expect(runRefresh).not.toContain('clear()');
    expect(runRefresh).toMatch(/catch\s*\{\s*\}/);
  });

  it('does not delete or migrate anything when a module is switched off', () => {
    const migration = readFileSync(join(ROOT, 'supabase/migrations/0011_module_flags.sql'), 'utf8');
    const body = migration.slice(migration.indexOf('create table'));
    // The only delete in the file is the one that removes a flag override.
    const deletes = body.match(/delete from [\w.]+/gi) ?? [];
    expect(deletes).toEqual(['delete from public.module_flags']);
  });
});

describe('module registry', () => {
  const modules = HUB_SECTIONS.flatMap((section) => section.modules);

  it('gives every module a route the guard can recognise', () => {
    // A module whose first path segment is not in the map is ungated: it would
    // stay reachable after being switched off or made private.
    const known = new Set(Object.values(SEGMENT_TO_MODULE));
    const unmapped = modules.filter((m) => !known.has(m.id)).map((m) => m.id);
    expect(unmapped).toEqual([]);
  });

  it("points every module's route at its own segment", () => {
    // Catches the copy-paste where a new module keeps the route it was cloned
    // from — which would gate the wrong module and count usage under it too.
    const mismatched = modules
      .filter((m) => {
        const segment = m.getRoute().split('?')[0].split('/').filter(Boolean)[0] ?? '';
        return SEGMENT_TO_MODULE[segment] !== m.id;
      })
      .map((m) => m.id);
    expect(mismatched).toEqual([]);
  });

  it('lets every module that can be made private be excluded from the export', () => {
    // A privatised module with no `tables` would silently keep exporting its
    // rows into the plaintext backup — the failure would be invisible until
    // somebody opened the JSON.
    // Checked against `tables` directly. This used to filter to modules with
    // `searchKinds` first, as a stand-in for "owns user data" — which stopped
    // meaning that the moment Split's unproduced 'group' kind was removed, and
    // would have quietly narrowed the check to nothing rather than failing.
    const withoutTables = modules
      .filter((m) => m.canBePrivate && m.tables.length === 0)
      .map((m) => m.id);
    // Split is the deliberate exception: its data lives on the server in
    // shared group tables, not in local ones this app may drop from an export.
    expect(withoutTables).toEqual(['split']);
  });

  it('refuses to let Settings be hidden', () => {
    const settings = modules.find((m) => m.id === 'settings');
    expect(settings?.canBePrivate).toBe(false);
  });
});
