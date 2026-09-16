import en from '@/lib/i18n/locales/en.json';

import { ALBUM_CATEGORIES, albumCategoryMeta } from '@/features/gallery/config/album-categories';
import type { AlbumCategory } from '@/features/gallery/types/gallery.types';

/**
 * The album category registry, and the first test `features/gallery` has had.
 *
 * `albumCategoryMeta` never returns undefined — it falls back to the last entry
 * — which is the right call for a screen that must render whatever the database
 * holds, and also the reason a missing category is invisible. A row added to the
 * union without a meta entry silently renders as "Custom" with the wrong icon,
 * on somebody's album, forever. So the exhaustiveness is asserted directly.
 */

/**
 * Every member of the union, listed so the compiler enforces the list.
 *
 * `satisfies` plus the `Record` means adding a member to `AlbumCategory` without
 * adding it here is a type error rather than a test that quietly checks six of
 * seven. That is the whole point: a runtime list cannot be derived from a type,
 * so this is the one place the two are tied together.
 */
const ALL_CATEGORIES = {
  gym: true,
  body: true,
  weight_loss: true,
  certificates: true,
  achievements: true,
  memories: true,
  custom: true,
} satisfies Record<AlbumCategory, true>;

const EVERY_CATEGORY = Object.keys(ALL_CATEGORIES) as AlbumCategory[];

describe('album categories', () => {
  it('has a meta entry for every category in the union', () => {
    const registered = new Set(ALBUM_CATEGORIES.map((c) => c.id));
    const missing = EVERY_CATEGORY.filter((id) => !registered.has(id));

    expect(missing).toEqual([]);
  });

  it('resolves each category to its own entry, not the fallback', () => {
    // The fallback is what makes a missing entry invisible, so each id is
    // checked to come back as itself rather than merely as something.
    for (const id of EVERY_CATEGORY) {
      expect(albumCategoryMeta(id).id).toBe(id);
    }
  });

  it('has no duplicate ids', () => {
    // A duplicate means the `BY_ID` map silently keeps the last one, and the
    // earlier entry's icon never appears.
    const ids = ALBUM_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('falls back to Custom rather than crashing on an unknown category', () => {
    // Reachable: a row written by a newer build, then synced to this one.
    const meta = albumCategoryMeta('not_a_category' as AlbumCategory);

    expect(meta.id).toBe('custom');
  });

  it('gives every category an icon', () => {
    // The comment on this file says identity is carried by the icon and the
    // label, deliberately not by colour — so a missing icon leaves a category
    // with no identity at all.
    for (const category of ALBUM_CATEGORIES) {
      expect(category.icon).toBeTruthy();
    }
  });

  it('points every label key at a string that exists in en.json', () => {
    // `check:i18n` catches a key used in code and absent from the locale, but
    // these keys are assembled from `id`, so a renamed category would show the
    // raw path on the album screen instead.
    const labels = (en as { albumCategory: Record<string, string> }).albumCategory;

    for (const category of ALBUM_CATEGORIES) {
      const [namespace, key] = category.labelKey.split('.');
      expect(namespace).toBe('albumCategory');
      expect(typeof labels[key]).toBe('string');
      expect(labels[key].length).toBeGreaterThan(0);
    }
  });

  it('keeps Custom last, because the fallback is positional', () => {
    // `albumCategoryMeta` returns `ALBUM_CATEGORIES[length - 1]` for anything
    // unknown. Reordering the list would change what an unknown category
    // becomes — silently, and to something with a real meaning like "Gym".
    expect(ALBUM_CATEGORIES[ALBUM_CATEGORIES.length - 1].id).toBe('custom');
  });
});
