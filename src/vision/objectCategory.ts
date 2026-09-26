import type { ObjectCategory } from '@/types';

/**
 * Detected label → the music layer's ObjectCategory (icon and first-guess role).
 * Kept here rather than in src/vision/objectRoles.ts, which the music code owns.
 * Covers both the everyday-objects vocabulary and the COCO fallback names.
 */
const CATEGORY: Record<string, ObjectCategory> = {
  cup: 'cup',
  mug: 'cup',
  bowl: 'cup',
  glass: 'glass',
  'wine glass': 'glass',
  bottle: 'bottle',
  'water bottle': 'bottle',
  can: 'bottle',
  table: 'table',
  desk: 'table',
  'dining table': 'table',
  chair: 'table',
  laptop: 'laptop',
  keyboard: 'laptop',
  mouse: 'laptop',
  'computer mouse': 'laptop',
  monitor: 'laptop',
  tv: 'laptop',
  tablet: 'laptop',
  keys: 'keys',
  scissors: 'keys',
  spoon: 'keys',
  fork: 'keys',
  knife: 'keys',
  plant: 'plant',
  'potted plant': 'plant',
  book: 'book',
  notebook: 'book',
  phone: 'phone',
  'cell phone': 'phone',
  remote: 'phone',
  box: 'box',
  clock: 'box',
};

export function categoryFor(label: string | null | undefined): ObjectCategory {
  if (!label) return 'unknown';
  return CATEGORY[label.trim().toLowerCase()] ?? 'unknown';
}
