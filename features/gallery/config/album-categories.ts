import {
  Award,
  Dumbbell,
  GraduationCap,
  Images,
  Scale,
  Sparkles,
  User,
  type LucideIcon,
} from '@/components/ui/icons';
import type { AlbumCategory } from '@/features/gallery/types/gallery.types';

export type AlbumCategoryMeta = {
  id: AlbumCategory;
  labelKey: string;
  icon: LucideIcon;
};

/**
 * What a subject is tracking. Identity is carried by the icon and the label —
 * deliberately *not* by a per-category color.
 *
 * These used to hold seven saturated tints, which put a rainbow on every screen
 * and borrowed other modules' identities (violet is Journal's, orange is
 * Fitness's). In a media module the photos are the color; chrome stays neutral
 * and only the one Progress tint marks what's interactive. Icons also survive
 * grayscale and color-blindness, which a seven-hue code never did.
 */
export const ALBUM_CATEGORIES: AlbumCategoryMeta[] = [
  { id: 'gym', labelKey: 'albumCategory.gym', icon: Dumbbell },
  { id: 'body', labelKey: 'albumCategory.body', icon: User },
  { id: 'weight_loss', labelKey: 'albumCategory.weight_loss', icon: Scale },
  { id: 'certificates', labelKey: 'albumCategory.certificates', icon: GraduationCap },
  { id: 'achievements', labelKey: 'albumCategory.achievements', icon: Award },
  { id: 'memories', labelKey: 'albumCategory.memories', icon: Sparkles },
  { id: 'custom', labelKey: 'albumCategory.custom', icon: Images },
];

const BY_ID = new Map(ALBUM_CATEGORIES.map((c) => [c.id, c]));

export function albumCategoryMeta(id: AlbumCategory): AlbumCategoryMeta {
  return BY_ID.get(id) ?? ALBUM_CATEGORIES[ALBUM_CATEGORIES.length - 1];
}
