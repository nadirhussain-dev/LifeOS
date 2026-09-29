import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every scheduler is reachable from the launch rebuild.
 *
 * `resyncAllReminders()` is the app's only self-healing mechanism: it cancels
 * the whole OS queue and rebuilds it from durable state, which is what recovers
 * reminders lost to a permission that was not granted yet, a category toggled
 * off and on, a restored backup, or a bug. A module it cannot reach gets the
 * cancel and not the rebuild — so being outside the rebuild is strictly worse
 * than never having been wired into it at all.
 *
 * The streak reminders were exactly that. They scheduled, they were not in the
 * rebuild, and the launch `cancelAllScheduled()` deleted them with nothing to
 * put them back; whether the evening reminder survived a given start-up came
 * down to which of two independent launch effects finished second.
 *
 * Nothing could have caught that except somebody noticing. The rebuild is a
 * hand-maintained list of steps in one file, and the failure is *silent* —
 * adding a scheduler and forgetting the step produces no error, no warning, and
 * a feature that looks like it works. This test is the missing constraint: it
 * walks the import graph from the rebuild's roots and fails if any module that
 * schedules is not in it.
 *
 * Source-level rather than runtime, for the same reason data-coverage.test.ts
 * greps `reminder-scheduler.ts` for `features/private`: the property is about
 * which modules the rebuild can reach, and importing them all to find out would
 * be the very coupling the registration indirection exists to avoid.
 */

const ROOT = join(__dirname, '..', '..', '..');

/*
 * Every repo-relative path in this file is built with forward slashes, and
 * `join(ROOT, …)` is used only to touch the filesystem — Node accepts `/` on
 * Windows for that.
 *
 * It used to mix the two: `walk` and `resyncRoots` produced OS separators while
 * `resolveImport` produced `@/`-style forward slashes for two of its three
 * candidates. The reachability set and the scheduler list were therefore in
 * different alphabets on Windows, every lookup missed, and the suite reported
 * all seventeen schedulers as unreachable. CI runs on Linux, where the two
 * alphabets are the same — so this was green in the only place anybody looked
 * and red on every Windows checkout.
 */

/** The three primitives that put something in the OS queue. Anything calling
 *  one of these owes the rebuild a way to call it back. */
const SCHEDULER_CALLS = [
  'scheduleOneTimeNotification(',
  'scheduleDailyNotification(',
  'scheduleWeeklyNotification(',
];

/**
 * Where the rebuild starts.
 *
 * `reminder-scheduler.ts` itself, plus every `register-reminders.ts` — the
 * side-effect modules that call `registerReminderStep`. The rebuild deliberately
 * cannot import those directly (see its header, and the private space's), so
 * they are roots in their own right rather than nodes under the first one.
 */
function resyncRoots(): string[] {
  const roots = ['features/notifications/services/reminder-scheduler.ts'];
  for (const feature of readdirSync(join(ROOT, 'features'))) {
    const candidate = `features/${feature}/services/register-reminders.ts`;
    try {
      statSync(join(ROOT, candidate));
      roots.push(candidate);
    } catch {
      // Most features have none; that is the common case, not an error.
    }
  }
  return roots;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\./.test(entry)) out.push(rel);
  }
  return out;
}

/** `@/features/x/y` → the file it resolves to, or null for anything outside
 *  the app's own source (node modules, `lib/`, type-only paths that vanish). */
function resolveImport(spec: string): string | null {
  if (!spec.startsWith('@/')) return null;
  const base = spec.slice(2);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    try {
      if (statSync(join(ROOT, candidate)).isFile()) return candidate;
    } catch {
      // Try the next extension.
    }
  }
  return null;
}

function importsOf(file: string): string[] {
  const source = readFileSync(join(ROOT, file), 'utf8');
  const specs = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  // Side-effect imports carry no `from`, and they are exactly how the
  // registration modules are pulled in.
  specs.push(...[...source.matchAll(/^import\s+'([^']+)';/gm)].map((m) => m[1]));
  return specs.map(resolveImport).filter((f): f is string => f !== null);
}

/** Everything the rebuild can reach, transitively. */
function reachableFromResync(): Set<string> {
  const seen = new Set<string>();
  const queue = resyncRoots();
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...importsOf(file));
  }
  return seen;
}

describe('resync coverage', () => {
  it('reaches every module that schedules a notification', () => {
    const schedulers = walk('features').filter((file) => {
      const source = readFileSync(join(ROOT, file), 'utf8');
      return SCHEDULER_CALLS.some((call) => source.includes(call));
    });

    // Guards the guard: a refactor that renames the primitives would otherwise
    // leave this asserting nothing at all, silently and forever.
    expect(schedulers.length).toBeGreaterThan(10);

    const reachable = reachableFromResync();
    const orphans = schedulers.filter((file) => !reachable.has(file));

    expect(orphans).toEqual([]);
  });

  it('starts from the scheduler and every registration module', () => {
    const roots = resyncRoots();
    expect(roots).toContain('features/notifications/services/reminder-scheduler.ts');
    // The three that exist today. A new one is picked up automatically by
    // `resyncRoots`; this asserts the discovery itself works, so the test above
    // cannot pass by finding no roots and therefore no orphans.
    expect(roots).toContain('features/private/services/register-reminders.ts');
    expect(roots).toContain('features/insights/services/register-reminders.ts');
  });

  it('registration modules are actually imported by the app', () => {
    // A `register-reminders.ts` that nothing imports registers nothing: the
    // call is a load-time side effect. This is the other half of the same
    // guarantee, and it is a root only because the root layout pulls it in.
    const layout = readFileSync(join(ROOT, 'app', '_layout.tsx'), 'utf8');
    for (const root of resyncRoots()) {
      if (!root.endsWith('register-reminders.ts')) continue;
      expect(layout).toContain(`@/${root.replace(/\.ts$/, '')}`);
    }
  });
});
