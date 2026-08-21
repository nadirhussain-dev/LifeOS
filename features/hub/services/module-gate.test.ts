import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { WIDGET_MODULE, widgetAllowed } from '@/features/dashboard/config/widget-registry';
import { HUB_SECTIONS } from '@/features/hub/config/modules';
import { moduleForPath, SEGMENT_TO_MODULE } from '@/features/hub/config/route-modules';
import { moduleMayBeShownIn, type ModuleGateContext } from '@/features/hub/services/module-gate';
import type { SearchResultKind } from '@/features/search/services/global-search';

const readCode = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

const OPEN: ModuleGateContext = { flags: {}, overrides: {}, privatised: [], unlocked: false };

describe('moduleMayBeShownIn', () => {
  it('shows a module nothing has been said about', () => {
    expect(moduleMayBeShownIn('budget', OPEN)).toBe(true);
  });

  it('hides one the operator pulled', () => {
    expect(moduleMayBeShownIn('budget', { ...OPEN, flags: { budget: { enabled: false } } })).toBe(
      false,
    );
  });

  it('hides one the user closed', () => {
    expect(moduleMayBeShownIn('budget', { ...OPEN, overrides: { budget: false } })).toBe(false);
  });

  it('hides a privatised module while the vault is locked', () => {
    expect(moduleMayBeShownIn('budget', { ...OPEN, privatised: ['budget'] })).toBe(false);
  });

  it('shows a privatised module once the vault is open', () => {
    // The difference from `moduleMayBeNamed`, which fails a privatised module
    // whatever the vault is doing: this rule answers for a screen the user is
    // already looking at, and unlocking has to actually reveal something.
    expect(moduleMayBeShownIn('budget', { ...OPEN, privatised: ['budget'], unlocked: true })).toBe(
      true,
    );
  });

  it('leaves a module the onboarding guess merely dropped alone', () => {
    // Curation is a guess the user never confirmed. Its cards and hits are how
    // somebody discovers a module onboarding dropped on their behalf, so this
    // gate takes no notice of focus areas at all — only of `overrides`.
    expect(moduleMayBeShownIn('sleep', OPEN)).toBe(true);
  });

  it('never lets a switch on one module leak onto another', () => {
    expect(moduleMayBeShownIn('goals', { ...OPEN, privatised: ['budget'] })).toBe(true);
  });
});

describe('dashboard widget ownership', () => {
  const KNOWN_MODULES = new Set(Object.values(SEGMENT_TO_MODULE));

  it('names a real module for every widget that claims one', () => {
    // The gate answers `true` for an id it has never heard of — absence means
    // enabled, everywhere in this app. So a typo here does not fail loudly, it
    // silently un-gates the widget, which is the exact bug this map exists to
    // fix. Checked against the route map because that is the list the guard
    // itself keys on.
    const unknown = Object.entries(WIDGET_MODULE)
      .filter(([, owner]) => owner !== null && !KNOWN_MODULES.has(owner))
      .map(([id]) => id);
    expect(unknown).toEqual([]);
  });

  it('lets an unowned widget through and holds a gated one back', () => {
    const deny = () => false;
    expect(widgetAllowed('daily-quote', deny)).toBe(true);
    expect(widgetAllowed('recent-notes', deny)).toBe(false);
  });

  it('gates every widget whose module can be moved behind the vault', () => {
    // Timeline, Notes and Water are all `canBePrivate` and all three had a
    // widget reading straight from their tables, which is how a privatised
    // module kept its content on the home screen.
    const privatisable = new Set(
      HUB_SECTIONS.flatMap((section) => section.modules)
        .filter((module) => module.canBePrivate)
        .map((module) => module.id),
    );
    const owners = Object.values(WIDGET_MODULE).filter((owner) => owner !== null);
    expect(owners.filter((owner) => privatisable.has(owner as string)).sort()).toEqual([
      'notes',
      'timeline',
      'water',
    ]);
  });
});

describe('search kind ownership', () => {
  const source = readCode('features/search/services/search-sources.ts');
  const KINDS: SearchResultKind[] = [
    'task',
    'note',
    'habit',
    'goal',
    'journal',
    'transaction',
    'debt',
    'subject',
    'song',
    'playlist',
    'album',
  ];

  it('lists exactly the kinds the union declares', () => {
    // Keeps this test honest: the union is a type and cannot be read at
    // runtime, so the list above is hand-kept and would otherwise drift.
    const declared = readCode('features/search/services/global-search.ts')
      .split('export type SearchResultKind =')[1]
      .split(';')[0];
    const inUnion = [...declared.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(inUnion.sort()).toEqual([...KINDS].sort());
  });

  it('actually produces every kind it declares', () => {
    // A kind nothing emits is invisible: the only thing declaring it drives is
    // which results get *hidden* when its module is switched off. 'group' sat
    // in the union unproduced from the day search shipped, so Split looked
    // searchable and never was.
    const produced = new Set([...source.matchAll(/kind: '([a-z]+)' as const/g)].map((m) => m[1]));
    expect(KINDS.filter((kind) => !produced.has(kind))).toEqual([]);
  });

  it('can hide every kind it produces', () => {
    // Every produced kind must be reachable from one of the two owner lists —
    // `HUB_SECTIONS[].searchKinds` or `TAB_MODULE_KINDS` — or its module's
    // switch cannot suppress it.
    const hubKinds = HUB_SECTIONS.flatMap((section) =>
      section.modules.flatMap((module) => module.searchKinds),
    );
    const tabKinds = [
      ...(source.split('const TAB_MODULE_KINDS')[1] ?? '').split('};')[0].matchAll(/'([a-z]+)'/g),
    ].map((m) => m[1]);
    const owned = new Set<string>([...hubKinds, ...tabKinds]);
    expect(KINDS.filter((kind) => !owned.has(kind))).toEqual([]);
  });
});

describe('moduleForPath', () => {
  it('reads the module off an ordinary path', () => {
    expect(moduleForPath('/budget/transactions/x')).toBe('budget');
  });

  it('sees through a route group', () => {
    // Registries hold unresolved hrefs. `null` here would read as "belongs to
    // no module", which every gate treats as "always allowed".
    expect(moduleForPath('/(tabs)/habits')).toBe('habits');
    expect(moduleForPath('/(tabs)/journal')).toBe('journal');
  });

  it('still answers null for a route that genuinely owns no module', () => {
    expect(moduleForPath('/auth/sign-in')).toBeNull();
  });
});

describe('cross-module readers ask the gate', () => {
  // Every surface that renders or links into another module. Each was found
  // doing it unconditionally; this is what stops that returning quietly.
  it.each([
    ['app/(tabs)/index.tsx', 'widgetAllowed'],
    ['features/insights/hooks/use-insights.ts', 'useModuleGate'],
    ['features/search/services/search-sources.ts', 'moduleMayBeShown'],
    ['features/dashboard/components/quick-actions-sheet.tsx', 'useModuleGate'],
    ['features/dashboard/components/focus-shortcuts.tsx', 'useModuleGate'],
  ])('%s', (file, symbol) => {
    expect(readCode(file)).toContain(symbol);
  });

  it('offers the same quick actions to the sheet and the radial menu', () => {
    // They are the tap path and the long-press path onto one list; a gate
    // applied to one of them is worse than none, because the difference is
    // invisible until somebody long-presses.
    const screen = readCode('app/(tabs)/index.tsx');
    expect(screen).toContain('useQuickActions');
    expect(screen).not.toContain('QUICK_ACTIONS.map');
  });

  it('masks every insights input, not just the queries it owns', () => {
    // `useSleepSessions`, `useStudySessions` and `useTransactions` are the
    // modules' own shared hooks, so `enabled` cannot reach their caches — the
    // mask at the join is the part that holds.
    const insights = readCode('features/insights/hooks/use-insights.ts');
    for (const input of [
      'sleepSessions',
      'studySessions',
      'habits',
      'habitLogs',
      'transactions',
      'journalEntries',
      'tasks',
      'waterTotals',
    ]) {
      expect(insights).toMatch(new RegExp(`${input}: allowed\\('[a-z]+'\\) \\? ${input} : \\[\\]`));
    }
  });
});
