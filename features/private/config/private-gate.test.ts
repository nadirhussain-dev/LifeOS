import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PRIVATE_SPACE_MODULE_ID,
  isPrivatePath,
  privateModuleForPath,
} from '@/features/hub/config/route-modules';
import {
  isBehindClosedPrivateSpace,
  moduleMayBeShownIn,
} from '@/features/hub/services/module-gate';
import {
  PRIVATE_MODULES,
  PRIVATE_MODULE_IDS,
  PRIVATE_SPACE_SWITCH,
} from '@/features/private/config/private-modules';

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

  it('is not named on the one other screen that lists every module', () => {
    /*
     * Sync's "what syncs" mapped SYNC_MODULES unconditionally, so a closed
     * space still had a "Private space" toggle sitting under Music. The rule
     * above is about the door, but the harm is the name appearing at all, and
     * this screen prints the name of every module in the app.
     */
    const sync = read('app/settings/sync.tsx');
    expect(sync).toContain('PRIVATE_SPACE_MODULE_ID');
    expect(sync).not.toMatch(/\{SYNC_MODULES\.map\(/);
  });
});

describe('the switch an operator actually has', () => {
  /*
   * The gap that made the rest of this file moot in practice: the guard, the
   * seed and the entry point all read the `private` umbrella, and no screen in
   * the console could write it. Both operator lists were
   * `HUB_SECTIONS + PRIVATE_MODULES`, which is the six rooms — so an operator
   * could switch off every room while the door stayed as the seed left it, and
   * could not open the space at all.
   */
  it('offers the umbrella, not only the rooms behind it', () => {
    expect(PRIVATE_SPACE_SWITCH.id).toBe(PRIVATE_SPACE_MODULE_ID);
    for (const screen of ['app/settings/operator.tsx', 'app/settings/operator/account.tsx']) {
      const source = read(screen);
      expect({ screen, offers: source.includes('PRIVATE_SPACE_SWITCH') }).toEqual({
        screen,
        offers: true,
      });
    }
  });

  it('keeps the umbrella out of the rooms', () => {
    // Every other consumer of PRIVATE_MODULES means rooms — setup, the decoy
    // filter, `suggestedFor`, the Hub. A seventh entry there to serve the
    // console would put the space inside itself.
    expect(PRIVATE_MODULE_IDS).not.toContain(PRIVATE_SPACE_MODULE_ID);
    expect(PRIVATE_MODULES.map((m) => m.id)).not.toContain(PRIVATE_SPACE_MODULE_ID);
  });
});

describe('who the switches reach', () => {
  const migration = read('supabase/migrations/0076_module_flags_reach_guests.sql');

  /*
   * `my_module_flags()` is the only thing that ever fills the client's flag
   * cache, so whoever cannot call it is a user for whom every switch in the
   * table — this gate included — silently does nothing. 0024 shut guests out
   * twice: the grant, and a filter that compared two nulls with `=`.
   */
  it('lets a signed-out client ask', () => {
    expect(migration).toMatch(/grant execute on function public\.my_module_flags\(\) to anon/);
  });

  it('answers a null uid instead of null-propagating the filter away', () => {
    // `null = null` is null, not true, so the grant alone would still have
    // returned an empty set — which the client reads as "nothing is off".
    expect(migration).toContain('is not distinct from (select auth.uid())');
    expect(migration).not.toMatch(/coalesce\(u\.user_id, \(select auth\.uid\(\)\)\) =/);
  });

  it('does not widen the per-user half to reach them', () => {
    // A guest has no overrides to read, and `module_flags_user` is the one
    // part of this that is genuinely about named accounts.
    expect(migration).not.toMatch(/grant[^;]*module_flags_user[^;]*anon/);
  });
});

describe('the umbrella dominates the modules inside it', () => {
  const closed = { private: { enabled: false } };
  const open = { private: { enabled: true } };

  it('shuts every private module while the space is shut', () => {
    /*
     * The leak this closes. `flags['cycle']` and `flags['private']` are two
     * independent switches, so an operator turning Cycle back on while leaving
     * the space closed — a reasonable-looking action — would have put Cycle's
     * entries into search and the insight engine while `/private/cycle` was
     * still being bounced by the route guard.
     */
    for (const id of PRIVATE_MODULE_IDS) {
      expect({ id, shut: isBehindClosedPrivateSpace(id, closed) }).toEqual({ id, shut: true });
      expect(
        moduleMayBeShownIn(id, {
          flags: { ...closed, [id]: { enabled: true } },
          overrides: {},
          privatised: [],
          unlocked: true,
        }),
      ).toBe(false);
    }
  });

  it('claims nothing outside the private space', () => {
    for (const id of ['habits', 'journal', 'budget', 'gallery', 'rewards']) {
      expect({ id, shut: isBehindClosedPrivateSpace(id, closed) }).toEqual({ id, shut: false });
    }
  });

  it('does not open a module just because the space is open', () => {
    // The reverse must not hold: opening the door does not open every room.
    expect(isBehindClosedPrivateSpace('cycle', open)).toBe(false);
    expect(
      moduleMayBeShownIn('cycle', {
        flags: { ...open, cycle: { enabled: false } },
        overrides: {},
        privatised: [],
        unlocked: true,
      }),
    ).toBe(false);
  });

  it('treats an absent umbrella row as open, like every other flag', () => {
    // 0011 rule 1 — absent means enabled — still applies. 0074 is what makes
    // the shipped default closed, by writing an explicit row.
    expect(isBehindClosedPrivateSpace('cycle', {})).toBe(false);
  });

  it('keeps the runtime id list in step with the modules themselves', () => {
    // `PRIVATE_MODULE_IDS` is written out rather than derived, so this is what
    // stops a sixth module being added and silently escaping the umbrella.
    expect([...PRIVATE_MODULE_IDS].sort()).toEqual(PRIVATE_MODULES.map((m) => m.id).sort());
  });
});

describe('what the OS is allowed to say', () => {
  it('checks the umbrella before naming a module on a lock screen', () => {
    // The out-of-app answer, and the leak with the widest audience: a reminder
    // naming Cycle tells anyone glancing at the phone that this space exists.
    const source = read('features/notifications/services/notification-visibility.ts');
    const fn = source.slice(source.indexOf('export function moduleMayBeNamed'));
    expect(fn.slice(0, 600)).toContain('isBehindClosedPrivateSpace');
  });
});
