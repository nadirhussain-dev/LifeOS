import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HUB_SECTIONS } from '@/features/hub/config/modules';
import { SEGMENT_TO_MODULE } from '@/features/hub/config/route-modules';
import { refreshModuleFlags } from '@/features/module-flags/services/module-flags';
import {
  isModuleEnabled,
  moduleDisabledMessage,
  useModuleFlagsStore,
} from '@/features/module-flags/store/module-flags-store';

/**
 * The remote kill switch is the one feature here that can make the app *less*
 * useful, aimed at every user at once. These tests hold the two properties that
 * keep it safe to own: it fails open, and it never touches data.
 *
 * ## Why these are no longer assertions about the source text
 *
 * The fail-open tests used to read these two files as strings and check that
 * one contained `'!== false'` and that the other's `runRefresh` did not contain
 * `'clear()'`. Both properties were the right ones; asserting them that way was
 * not. A substring check passes when the string sits in a comment, fails on a
 * rename that changes nothing, and — the part that matters — says nothing about
 * what the code *does*. `flags[id]?.enabled !== false` and
 * `flags[id]?.enabled === true` both contain `'!== false'` if the file happens
 * to mention it elsewhere, and only one of them fails open.
 *
 * They are now driven through the real store and the real refresh, with the
 * network mocked, so each one fails if and only if the behaviour regresses.
 */

const mockRpc = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));
jest.mock('@/lib/env', () => ({ isSupabaseConfigured: true }));

const mockResync = jest.fn();
jest.mock('@/features/notifications/services/reminder-scheduler', () => ({
  resyncAllReminders: () => mockResync(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useModuleFlagsStore.getState().clear();
});

describe('module flags fail open', () => {
  it('treats a module with no entry as enabled', () => {
    // Absence has to mean enabled in three situations at once: no row on the
    // server, nothing in the cache, and no successful fetch yet. Collapsing
    // them any other way means a network blip strips somebody's app bare.
    expect(isModuleEnabled('journal')).toBe(true);
    expect(isModuleEnabled('a-module-that-does-not-exist')).toBe(true);
  });

  it('honours an explicit off', () => {
    // The other half: fail-open must not mean "never off".
    useModuleFlagsStore.getState().setFlags({ journal: { enabled: false, message: null } });

    expect(isModuleEnabled('journal')).toBe(false);
    expect(isModuleEnabled('notes')).toBe(true);
  });

  it('keeps the cache when the fetch errors', async () => {
    // The mirror of failing open. If the operator pulled a module because it
    // corrupts data, a flaky connection must not hand it back.
    useModuleFlagsStore.getState().setFlags({ journal: { enabled: false, message: 'Paused' } });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'network' } });

    await refreshModuleFlags();

    expect(isModuleEnabled('journal')).toBe(false);
  });

  it('keeps the cache when the fetch throws', async () => {
    useModuleFlagsStore.getState().setFlags({ journal: { enabled: false, message: 'Paused' } });
    mockRpc.mockRejectedValue(new Error('offline'));

    await refreshModuleFlags();

    expect(isModuleEnabled('journal')).toBe(false);
  });

  it('keeps the cache when the response has no data', async () => {
    useModuleFlagsStore.getState().setFlags({ journal: { enabled: false, message: 'Paused' } });
    mockRpc.mockResolvedValue({ data: null, error: null });

    await refreshModuleFlags();

    expect(isModuleEnabled('journal')).toBe(false);
  });

  it('applies an empty response as "everything is fine"', async () => {
    // An empty list is the server's way of saying no module is switched off,
    // and it must be applied rather than treated as a failure — otherwise a
    // module can never be switched back on.
    useModuleFlagsStore.getState().setFlags({ journal: { enabled: false, message: 'Paused' } });
    mockRpc.mockResolvedValue({ data: [], error: null });

    await refreshModuleFlags();

    expect(isModuleEnabled('journal')).toBe(true);
  });

  it('carries the operator message only while the module is off', async () => {
    mockRpc.mockResolvedValue({
      data: [{ module: 'journal', enabled: false, message: 'Back on Tuesday' }],
      error: null,
    });

    await refreshModuleFlags();

    expect(moduleDisabledMessage('journal')).toBe('Back on Tuesday');
    // An enabled module has nothing to explain, so nothing should be shown.
    expect(moduleDisabledMessage('notes')).toBeNull();
  });

  it('ignores a row with no module name rather than caching it under undefined', async () => {
    mockRpc.mockResolvedValue({
      data: [
        { enabled: false, message: 'nameless' },
        { module: 'notes', enabled: false },
      ],
      error: null,
    });

    await refreshModuleFlags();

    expect(isModuleEnabled('notes')).toBe(false);
    expect(Object.keys(useModuleFlagsStore.getState().flags)).toEqual(['notes']);
  });

  it('rebuilds reminders only when the disabled set actually changed', async () => {
    // A resync cancels and re-schedules everything the app owns. Doing it on
    // every foreground would churn the whole OS queue for no reason.
    mockRpc.mockResolvedValue({
      data: [{ module: 'journal', enabled: false, message: null }],
      error: null,
    });
    await refreshModuleFlags();
    expect(mockResync).toHaveBeenCalledTimes(1);

    // Same answer again: nothing to do.
    await refreshModuleFlags();
    expect(mockResync).toHaveBeenCalledTimes(1);

    // Now it changes back.
    mockRpc.mockResolvedValue({ data: [], error: null });
    await refreshModuleFlags();
    expect(mockResync).toHaveBeenCalledTimes(2);
  });

  it('does not delete or migrate anything when a module is switched off', () => {
    // Stays a read of the migration: the property is about what the SQL does,
    // and the SQL is not reachable from here. `npm run test:sql` applies it.
    const migration = readFileSync(
      join(__dirname, '..', '..', 'supabase', 'migrations', '0011_module_flags.sql'),
      'utf8',
    );
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
