import { listDebts } from '@/features/budget/services/debts-repository';
import { listTransactions } from '@/features/budget/services/budget-repository';
import { listAlbumsWithCover } from '@/features/gallery/services/gallery-repository';
import { listGoals } from '@/features/goals/services/goals-repository';
import { listHabits } from '@/features/habits/services/habits-repository';
import { listRecentJournalEntries } from '@/features/journal/services/journal-repository';
import { listPlaylists } from '@/features/music/services/playlists-repository';
import { listSongs } from '@/features/music/services/songs-repository';
import { listNotes } from '@/features/notes/services/notes-repository';
import { listStudySubjects } from '@/features/study/services/study-repository';
import { listTasks } from '@/features/tasks/services/tasks-repository';
import { HUB_SECTIONS } from '@/features/hub/config/modules';
import { moduleMayBeShown } from '@/features/hub/services/module-gate';
import {
  compareResults,
  scoreMatch,
  snippet,
  type SearchResult,
  type SearchResultKind,
} from '@/features/search/services/global-search';
import { reportError } from '@/lib/error-reporting';

/**
 * Result kinds owned by a module that has no Hub tile.
 *
 * Tasks, Habits and Journal are bottom tabs, so they are absent from
 * `HUB_SECTIONS` and there is no `searchKinds` on them to read. Neither the
 * module manager nor the vault's module list offers them either, so they can
 * be neither closed nor privatised — but the operator can still pull one, and
 * without this their hits would outlive the switch that pulled it.
 *
 * The list is short and it is hand-kept, which is exactly the shape of thing
 * that falls behind; `search-coverage.test.ts` asserts that this and
 * `HUB_SECTIONS` between them account for every kind in `SearchResultKind`, so
 * a new kind cannot be added without an owner.
 */
const TAB_MODULE_KINDS: Record<string, readonly SearchResultKind[]> = {
  tasks: ['task'],
  habits: ['habit'],
  journal: ['journal'],
};

/**
 * Which result kinds must not appear, because their module may not be shown.
 *
 * Derived from the Hub registry's `searchKinds` rather than a second list here,
 * so a module cannot be switched off in one place and forgotten in the other.
 *
 * All three switches, not just the vault. Search used to check only whether a
 * module was privatised, which left the other two returning hits that deep-link
 * into a screen `useModuleRouteGuard` immediately redirects away from — a
 * result you can see, tap, and get bounced off, for a module the operator has
 * pulled or the user has closed.
 */
function hiddenSearchKinds(): Set<SearchResultKind> {
  const hidden = new Set<SearchResultKind>();

  const hideIfOff = (moduleId: string, kinds: readonly SearchResultKind[]) => {
    if (kinds.length === 0 || moduleMayBeShown(moduleId)) return;
    for (const kind of kinds) hidden.add(kind);
  };

  for (const section of HUB_SECTIONS) {
    for (const module of section.modules) hideIfOff(module.id, module.searchKinds);
  }
  for (const [moduleId, kinds] of Object.entries(TAB_MODULE_KINDS)) hideIfOff(moduleId, kinds);

  return hidden;
}

/**
 * Reads every module and returns what matches.
 *
 * Each source is wrapped individually: a module whose table is missing or
 * mid-migration must cost only its own results, never the whole search. That
 * matters more here than anywhere else in the app — search is the feature
 * people fall back on when they can't find something, so it failing entirely is
 * the worst possible moment for it to fail.
 *
 * Everything is local SQLite and reads are synchronous, so this stays a plain
 * function; the caller debounces.
 */
export function searchEverything(query: string, limit = 40): SearchResult[] {
  if (query.trim().length < 2) return [];

  /**
   * Result kinds belonging to a module the user has moved behind the vault and
   * has not unlocked.
   *
   * Filtered at the end rather than by skipping sources: the sources are the
   * per-module reads, and one of them silently not running is a much easier
   * thing to get subtly wrong than one predicate applied to a finished list.
   * Search is also the highest-consequence leak in the app — a title is enough
   * to give the whole thing away — so the check wants to be somewhere obvious.
   */
  const hiddenKinds = hiddenSearchKinds();

  const results: SearchResult[] = [];
  const collect = (name: string, run: () => SearchResult[]) => {
    try {
      results.push(...run());
    } catch (error) {
      reportError(error, { scope: `search:${name}` });
    }
  };

  collect('tasks', () =>
    listTasks('active', 'due-date')
      .map((task) => ({
        id: task.id,
        kind: 'task' as const,
        module: 'habit' as const,
        title: task.title,
        subtitle: snippet(task.notes, query),
        route: '/task/[id]',
        params: { id: task.id },
        score: scoreMatch(query, task.title, task.notes),
        updatedAt: task.updatedAt,
      }))
      .filter((r) => r.score > 0),
  );

  collect('notes', () =>
    listNotes()
      .map((note) => ({
        id: note.id,
        kind: 'note' as const,
        // Notes has had its own tint since the token pass; this said 'journal',
        // so every note in the results wore Journal's violet while its Hub tile
        // and every other surface showed it yellow. Tasks below genuinely do
        // borrow 'habit' — there is no `tasks` tint, by design.
        module: 'notes' as const,
        title: note.title || (note.body ?? '').slice(0, 40),
        subtitle: snippet(note.body, query),
        route: '/note/[id]',
        params: { id: note.id },
        score: scoreMatch(query, note.title, note.body),
        updatedAt: note.updatedAt,
      }))
      .filter((r) => r.score > 0),
  );

  collect('habits', () =>
    listHabits()
      .map((habit) => ({
        id: habit.id,
        kind: 'habit' as const,
        module: 'habit' as const,
        title: habit.name,
        subtitle: habit.unit ?? null,
        route: '/habit/[id]',
        params: { id: habit.id },
        score: scoreMatch(query, habit.name),
        updatedAt: habit.updatedAt,
      }))
      .filter((r) => r.score > 0),
  );

  collect('goals', () =>
    listGoals()
      .map((goal) => ({
        id: goal.id,
        kind: 'goal' as const,
        module: 'goals' as const,
        title: goal.title,
        subtitle: snippet(goal.description, query),
        route: '/goals/[id]',
        params: { id: goal.id },
        score: scoreMatch(query, goal.title, goal.description),
        updatedAt: goal.updatedAt,
      }))
      .filter((r) => r.score > 0),
  );

  collect('journal', () =>
    listRecentJournalEntries(400)
      .map((entry) => ({
        id: entry.id,
        kind: 'journal' as const,
        module: 'journal' as const,
        title: entry.entryDate,
        subtitle: snippet(entry.body, query),
        route: '/journal/[date]',
        params: { date: entry.entryDate },
        // Journal entries have no title, so the date stands in — but matching on
        // it would make every query for a number return a pile of dates.
        score: scoreMatch(query, '', entry.body),
        updatedAt: entry.updatedAt,
      }))
      .filter((r) => r.score > 0),
  );

  collect('budget', () =>
    listTransactions()
      .map((transaction) => ({
        id: transaction.id,
        kind: 'transaction' as const,
        module: 'budget' as const,
        title: transaction.note || transaction.category,
        subtitle: transaction.category,
        route: '/budget/transactions',
        score: scoreMatch(query, transaction.note ?? '', transaction.category),
        updatedAt: transaction.updatedAt,
      }))
      .filter((r) => r.score > 0),
  );

  collect('debts', () =>
    listDebts()
      .map((debt) => ({
        id: debt.id,
        kind: 'debt' as const,
        module: 'budget' as const,
        title: debt.counterparty,
        subtitle: snippet(debt.note, query),
        route: '/budget/debts/[id]',
        params: { id: debt.id },
        score: scoreMatch(query, debt.counterparty, debt.note),
        updatedAt: debt.updatedAt,
      }))
      .filter((r) => r.score > 0),
  );

  collect('study', () =>
    listStudySubjects()
      .map((subject) => ({
        id: subject.id,
        kind: 'subject' as const,
        module: 'study' as const,
        title: subject.name,
        subtitle: null,
        route: '/study',
        score: scoreMatch(query, subject.name),
        updatedAt: subject.createdAt,
      }))
      .filter((r) => r.score > 0),
  );

  collect('songs', () =>
    listSongs()
      .map((song) => ({
        id: song.id,
        kind: 'song' as const,
        module: 'music' as const,
        title: song.title,
        subtitle: song.artist,
        route: '/music/song/[id]',
        params: { id: song.id },
        score: scoreMatch(query, song.title, song.artist),
        updatedAt: song.addedAt,
      }))
      .filter((r) => r.score > 0),
  );

  collect('playlists', () =>
    listPlaylists()
      .map((playlist) => ({
        id: playlist.id,
        kind: 'playlist' as const,
        module: 'music' as const,
        title: playlist.name,
        subtitle: null,
        route: '/music/playlist/[id]',
        params: { id: playlist.id },
        score: scoreMatch(query, playlist.name),
        updatedAt: 0,
      }))
      .filter((r) => r.score > 0),
  );

  collect('gallery', () =>
    listAlbumsWithCover()
      .map((album) => ({
        id: album.id,
        kind: 'album' as const,
        module: 'gallery' as const,
        title: album.name,
        subtitle: null,
        route: '/gallery/album/[id]',
        params: { id: album.id },
        score: scoreMatch(query, album.name),
        updatedAt: album.updatedAt,
      }))
      .filter((r) => r.score > 0),
  );

  return results
    .filter((result) => !hiddenKinds.has(result.kind))
    .sort(compareResults)
    .slice(0, limit);
}
