import { Lightbulb, ListChecks, Sun, Users, type LucideIcon } from '@/components/ui/icons';

export type NoteTemplate = {
  id: string;
  icon: LucideIcon;
  titleKey: string;
  bodyKey: string;
};

/**
 * Built-in quick-start content for the new-note screen — a fixed, curated
 * set rather than a user-editable template system, which is a much larger
 * feature (a template CRUD flow, a picker for managing them) than "give a
 * blank note some structure to start from" actually calls for.
 */
export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: 'meeting',
    icon: Users,
    titleKey: 'notes.templateMeeting',
    bodyKey: 'notes.templateMeetingBody',
  },
  { id: 'daily', icon: Sun, titleKey: 'notes.templateDaily', bodyKey: 'notes.templateDailyBody' },
  {
    id: 'checklist',
    icon: ListChecks,
    titleKey: 'notes.templateChecklist',
    bodyKey: 'notes.templateChecklistBody',
  },
  {
    id: 'idea',
    icon: Lightbulb,
    titleKey: 'notes.templateIdea',
    bodyKey: 'notes.templateIdeaBody',
  },
];
