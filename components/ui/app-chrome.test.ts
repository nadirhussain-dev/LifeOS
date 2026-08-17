import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The three pieces of chrome that wrap every screen: the grain, the scene
 * padding, and the system bars.
 *
 * All three failed the same way — silently, everywhere at once, and only on a
 * device. None of them throws, none of them fails a type check, and the code
 * that produced each one reads correctly. They are only wrong in the rendered
 * result, which is exactly the category a test like this can still catch by
 * asserting on the decision rather than the pixels.
 */

const ROOT = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('the film grain', () => {
  /**
   * `resizeMode="repeat"` is not implemented by Android's New Architecture
   * renderer. It does not warn or throw — it draws the tile once, at its
   * natural size, in the top-left corner. So the grain textured a 128dp square
   * of each screen and nothing else, and the OLED banding it exists to dither
   * went undithered everywhere below that square.
   */
  it('is tiled without resizeMode="repeat" — here or anywhere else', () => {
    const offenders: string[] = [];
    for (const path of sourceFiles()) {
      for (const line of read(path).split('\n')) {
        // Prose about the trap is not the trap. Without this, grain.tsx's own
        // explanation of why it no longer uses `repeat` would fail the test
        // that exists because it no longer uses `repeat`.
        if (/^\s*(\*|\/\/)/.test(line)) continue;
        if (/resizeMode=["']repeat["']|resizeMode:\s*['"]repeat['"]/.test(line)) {
          offenders.push(path);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /** The rule only applies because the app is on the New Architecture; if that
   *  ever changes, this test's reason for existing changes with it. */
  it('is guarding a New Architecture build', () => {
    expect(
      JSON.parse(read('app.json')).expo.android.newArchEnabled ??
        JSON.parse(read('app.json')).expo.newArchEnabled,
    ).toBe(true);
  });

  /** Tiles are positioned against the window, so a rotation or a fold has to
   *  re-lay them out rather than leave a bare strip down one edge. */
  it('re-tiles when the window changes size', () => {
    expect(read('components/ui/grain.tsx')).toContain('useWindowDimensions');
  });
});

describe('the navigation bar', () => {
  const layout = read('app/_layout.tsx');

  /**
   * `edgeToEdgeEnabled` draws the app under the system bars. The top inset was
   * handled by `ScreenHeader` from the beginning; the bottom one was handled
   * nowhere, so the last line of every scrolled screen sat behind the bar.
   */
  it('keeps scene content clear of it', () => {
    expect(layout).toContain('useSafeAreaInsets');
    expect(layout).toMatch(
      /contentStyle:\s*\{\s*backgroundColor:\s*background,\s*paddingBottom:\s*bottom/,
    );
  });

  /** The tab bar already insets itself, so padding its scene as well would
   *  lift it off the bottom edge. */
  it('leaves the tab group to inset itself', () => {
    expect(layout).toMatch(
      /name="\(tabs\)"\s+options=\{\{\s*contentStyle:\s*\{\s*backgroundColor:\s*background\s*\}\s*\}\}/,
    );
    expect(read('components/ui/tab-bar.tsx')).toContain('insets.bottom');
  });

  /** The app's theme is its own setting, so the OS bars have to be told about
   *  it — a dark app under a white navigation bar reads as a fault. */
  it('follows the app’s theme rather than the phone’s', () => {
    expect(layout).toContain('<SystemBarsBridge />');
    const bridge = read('components/ui/system-bars.tsx');
    expect(bridge).toContain('expo-navigation-bar');
    expect(bridge).toContain("scheme === 'dark' ? 'light' : 'dark'");
  });

  /**
   * Both calls are unsupported in some edge-to-edge combinations by design,
   * and absent entirely until a native build picks the module up. Neither is
   * worth crashing the app at launch over.
   */
  it('cannot crash the app when the native call is unavailable', () => {
    const bridge = read('components/ui/system-bars.tsx');
    expect(bridge).toContain('try {');
    expect(bridge).toContain('.catch(');
  });
});

/** Every .tsx under the app's own source roots. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${entry}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (entry.endsWith('.tsx')) out.push(rel);
    }
  };
  for (const root of ['app', 'components', 'features']) walk(root);
  return out;
}
