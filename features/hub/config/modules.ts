import {
  Clock3,
  GlassWater,
  GraduationCap,
  Images,
  Moon,
  Music2,
  Settings,
  StickyNote,
  Target,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native';
import { format } from 'date-fns';

import { moduleTints, type TintPair } from '@/constants/design-tokens';
import type { SearchResultKind } from '@/features/search/services/global-search';

/**
 * The Hub is LifeOS's "app drawer" — the bottom tab bar holds only the four
 * daily drivers (Dashboard, Tasks, Habits, Journal) plus this launcher, and
 * everything else lives here as a grid. Each entry is the single source of
 * truth for a module's identity: its accent tint, icon, and route. A module
 * flips from `status: 'soon'` to `'ready'` the moment its screens ship, which
 * is the only edit the Hub needs to surface a newly-built module.
 */
export type ModuleStatus = 'ready' | 'soon';

export type HubModule = {
  id: string;
  titleKey: string;
  subtitleKey: string;
  icon: LucideIcon;
  /**
   * Per-module identity color, designed for BOTH themes.
   *
   * Resolve it at the point of render with `resolveTint(module.tint, scheme)`.
   * Never reach for `.light` directly: every entry here used to do exactly
   * that, so the whole Hub grid kept its light-mode tints on a near-black
   * ground and no amount of dark-mode work in the token file reached it.
   */
  tint: TintPair;
  status: ModuleStatus;
  /** Resolved lazily so date-dependent destinations (timeline) stay correct. */
  getRoute: () => string;
  /**
   * Local tables this module owns.
   *
   * Only used when the user moves a module into the private space: its rows
   * then have to be left out of the plaintext export, and this is the map that
   * says which rows those are. Listed here rather than in the export because a
   * module's identity is defined in one place, and a list kept somewhere else
   * is a list that falls behind (see lib/data-coverage.test.ts for what that
   * cost last time).
   */
  tables: string[];
  /**
   * Search result kinds this module produces, so a privatised module's results
   * can be filtered out of global search.
   */
  searchKinds: SearchResultKind[];
  /**
   * False for modules that make no sense to hide.
   *
   * Settings is the app's own controls — hiding it behind the vault would take
   * away the screen holding the button that puts it back.
   */
  canBePrivate: boolean;
};

export type HubSection = {
  id: string;
  labelKey: string;
  modules: HubModule[];
};

export const HUB_SECTIONS: HubSection[] = [
  {
    id: 'growth',
    labelKey: 'hubSection.growth',
    modules: [
      {
        id: 'goals',
        titleKey: 'hubModule.goalsTitle',
        subtitleKey: 'hubModule.goalsSubtitle',
        icon: Target,
        tint: moduleTints.goals,
        status: 'ready',
        getRoute: () => '/goals',
        tables: ['goals', 'goal_milestones', 'goal_progress_logs'],
        searchKinds: ['goal'],
        canBePrivate: true,
      },
      {
        id: 'study',
        titleKey: 'hubModule.studyTitle',
        subtitleKey: 'hubModule.studySubtitle',
        icon: GraduationCap,
        tint: moduleTints.study,
        status: 'ready',
        getRoute: () => '/study',
        tables: ['study_subjects', 'study_sessions', 'study_settings'],
        searchKinds: ['subject'],
        canBePrivate: true,
      },
      {
        id: 'notes',
        titleKey: 'hubModule.notesTitle',
        subtitleKey: 'hubModule.notesSubtitle',
        icon: StickyNote,
        tint: moduleTints.notes,
        status: 'ready',
        getRoute: () => '/notes',
        tables: ['note_categories', 'notes', 'note_tags', 'note_tag_links', 'note_attachments'],
        searchKinds: ['note'],
        canBePrivate: true,
      },
      {
        id: 'timeline',
        titleKey: 'hubModule.timelineTitle',
        subtitleKey: 'hubModule.timelineSubtitle',
        icon: Clock3,
        tint: moduleTints.calendar,
        status: 'ready',
        getRoute: () => `/timeline/${format(new Date(), 'yyyy-MM-dd')}`,
        tables: ['calendar_events'],
        searchKinds: [],
        canBePrivate: true,
      },
    ],
  },
  {
    id: 'wellbeing',
    labelKey: 'hubSection.wellbeing',
    modules: [
      {
        id: 'sleep',
        titleKey: 'hubModule.sleepTitle',
        subtitleKey: 'hubModule.sleepSubtitle',
        icon: Moon,
        tint: moduleTints.sleep,
        status: 'ready',
        getRoute: () => '/sleep',
        tables: ['sleep_sessions', 'sleep_settings'],
        searchKinds: [],
        canBePrivate: true,
      },
      {
        id: 'water',
        titleKey: 'hubModule.waterTitle',
        subtitleKey: 'hubModule.waterSubtitle',
        icon: GlassWater,
        tint: moduleTints.water,
        status: 'ready',
        getRoute: () => '/water-intake/history',
        tables: ['water_intake_logs'],
        searchKinds: [],
        canBePrivate: true,
      },
    ],
  },
  {
    id: 'finance',
    labelKey: 'hubSection.finance',
    modules: [
      {
        id: 'budget',
        titleKey: 'hubModule.budgetTitle',
        subtitleKey: 'hubModule.budgetSubtitle',
        icon: Wallet,
        tint: moduleTints.budget,
        status: 'ready',
        getRoute: () => '/budget',
        tables: ['budget_transactions', 'savings_goals', 'budget_settings', 'budget_debts'],
        searchKinds: ['transaction', 'debt'],
        canBePrivate: true,
      },
      {
        id: 'split',
        titleKey: 'hubModule.splitTitle',
        subtitleKey: 'hubModule.splitSubtitle',
        icon: Users,
        // Shares Budget's teal deliberately: this is money, and the hue wheel
        // has no room left for a 12th identity that clears the others by 30°.
        tint: moduleTints.budget,
        status: 'ready',
        getRoute: () => '/split',
        tables: [],
        searchKinds: ['group'],
        canBePrivate: true,
      },
    ],
  },
  {
    id: 'memories',
    labelKey: 'hubSection.memories',
    modules: [
      {
        id: 'gallery',
        titleKey: 'hubModule.galleryTitle',
        subtitleKey: 'hubModule.gallerySubtitle',
        icon: Images,
        tint: moduleTints.gallery,
        status: 'ready',
        getRoute: () => '/gallery',
        tables: ['gallery_albums', 'gallery_photos'],
        searchKinds: ['album'],
        canBePrivate: true,
      },
      {
        id: 'music',
        titleKey: 'hubModule.musicTitle',
        subtitleKey: 'hubModule.musicSubtitle',
        icon: Music2,
        tint: moduleTints.music,
        status: 'ready',
        getRoute: () => '/music',
        tables: ['songs', 'playlists', 'playlist_songs'],
        searchKinds: ['song', 'playlist'],
        canBePrivate: true,
      },
    ],
  },
  {
    id: 'system',
    labelKey: 'hubSection.system',
    modules: [
      {
        id: 'settings',
        titleKey: 'hubModule.settingsTitle',
        subtitleKey: 'hubModule.settingsSubtitle',
        icon: Settings,
        tint: moduleTints.settings,
        status: 'ready',
        getRoute: () => '/settings',
        tables: [],
        searchKinds: [],
        canBePrivate: false,
      },
    ],
  },
];
