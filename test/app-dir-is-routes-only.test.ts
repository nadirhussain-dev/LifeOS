import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

/**
 * Nothing but routes lives under `app/`.
 *
 * ## The build this broke
 *
 * Expo Router loads the route tree with a `require.context` over `app/`, and
 * its filter is:
 *
 *   /^(?:\.\/)(?!(?:(?:(?:.*\+api)|(?:\+html)|(?:\+middleware)))\.[tj]sx?$).*(?:\.ios|\.web)?\.[tj]sx?$/
 *
 * Read it for what it excludes and the list is three names long. Everything
 * else ending `.ts`/`.tsx` anywhere under `app/` is pulled into the production
 * bundle — including a test file.
 *
 * `app/screen-error-states.test.ts` imported `node:fs`, which does not exist in
 * React Native, so `expo export` died with "Unable to resolve module node:fs"
 * and every EAS build failed in the Bundle JavaScript phase. It was invisible
 * to `typecheck`, `lint` and `jest`, all of which happily resolve `node:fs`,
 * and the only job that would have caught it — bundling — was not in CI. The
 * builds failed for a week.
 *
 * ## Why a rule rather than "remember not to"
 *
 * A colocated test beside the screen it covers is a good instinct and it is
 * what put the file there. The instinct is right everywhere else in this
 * codebase; `app/` is the one directory where it produces a broken release
 * binary, and nothing about the directory says so. So the rule is written down
 * where it fails fast, and `npm run bundle:check` in CI is the backstop that
 * catches whatever else gets into the bundle by another route.
 */
describe('the app directory holds routes and nothing else', () => {
  const offenders: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(test|spec)\.[jt]sx?$/.test(entry)) {
        offenders.push(path.slice(ROOT.length + 1));
      }
    }
  };
  walk(join(ROOT, 'app'));

  it('contains no test files, because the router bundles every one of them', () => {
    // Put them in `test/`. They run from there unchanged — jest's testMatch is
    // `**/*.test.ts(x)` and nothing in either moved file referenced its own
    // location.
    expect(offenders).toEqual([]);
  });

  it('is actually looking at something', () => {
    // Guards the walk: a rename that pointed this at an empty directory would
    // make the assertion above pass forever while proving nothing.
    const routes: string[] = [];
    const count = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) count(path);
        else if (entry.endsWith('.tsx')) routes.push(path);
      }
    };
    count(join(ROOT, 'app'));
    expect(routes.length).toBeGreaterThan(50);
  });
});
