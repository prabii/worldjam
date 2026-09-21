import type { MusicalRole, ObjectCategory } from '@/types';

/**
 * Maps a detected object to its musical role.
 *
 * This is a lookup table rather than a model call, deliberately. Once YOLO
 * says "bottle", deciding that a bottle is a hit is a fact about the product,
 * not a judgement — and a table answers in microseconds where a model call
 * would add seconds and could disagree with itself between frames.
 *
 * The captured audio still overrides this: inferRole() in dsp/analysis.ts
 * looks at the actual recording, and a hollow plastic bottle struck softly
 * genuinely is a different instrument from one struck hard. The table is the
 * starting guess shown on the camera overlay before anything is recorded.
 */

/** COCO class names YOLO returns, mapped to our categories. */
export const COCO_TO_CATEGORY: Record<string, ObjectCategory> = {
  cup: 'cup',
  'wine glass': 'glass',
  bottle: 'bottle',
  bowl: 'cup',
  'dining table': 'table',
  laptop: 'laptop',
  keyboard: 'laptop',
  'cell phone': 'phone',
  book: 'book',
  'potted plant': 'plant',
  vase: 'glass',
  scissors: 'keys',
  remote: 'phone',
  mouse: 'phone',
  clock: 'box',
  spoon: 'keys',
  fork: 'keys',
  knife: 'keys',
  chair: 'table',
  couch: 'box',
  bed: 'box',
  tv: 'box',
  microwave: 'box',
  oven: 'box',
  toaster: 'box',
  sink: 'glass',
  refrigerator: 'box',
};

export interface RoleInfo {
  role: MusicalRole;
  /** Short label shown on the camera overlay, e.g. "Percussion". */
  display: string;
  /** Descriptive traits, as in the object-detail screen. */
  traits: string[];
  /** One line about why this object makes a good instrument. */
  blurb: string;
  color: string;
}

/**
 * Role per object category.
 *
 * The assignments follow the physics: a hollow ceramic cup rings briefly and
 * sits in the midrange, so it works as percussion; a large wooden table has
 * mass and a low fundamental, so it carries bass. Getting these right is what
 * makes a first arrangement sound intentional rather than random.
 */
export const CATEGORY_ROLES: Record<ObjectCategory, RoleInfo> = {
  cup: {
    role: 'perc',
    display: 'Percussion',
    traits: ['Ceramic', 'Hollow', 'Percussive', 'Warm'],
    blurb: 'A simple cup, a world of rhythm.',
    color: '#C084FC',
  },
  glass: {
    role: 'hat',
    display: 'Chime',
    traits: ['Glass', 'Ringing', 'Bright', 'Sustained'],
    blurb: 'Glass sings longer than anything else on the table.',
    color: '#38BDF8',
  },
  bottle: {
    role: 'snare',
    display: 'Hit',
    traits: ['Plastic', 'Resonant', 'Sharp', 'Bright'],
    blurb: 'A bottle hits hard and gets out of the way.',
    color: '#EC4899',
  },
  table: {
    role: 'kick',
    display: 'Bass',
    traits: ['Wood', 'Dense', 'Low', 'Solid'],
    blurb: 'The table is the biggest drum in the room.',
    color: '#FBBF24',
  },
  laptop: {
    role: 'texture',
    display: 'Synth',
    traits: ['Metal', 'Clicky', 'Digital', 'Tight'],
    blurb: 'Keys and casing: a machine that plays itself.',
    color: '#A78BFA',
  },
  keys: {
    role: 'hat',
    display: 'Clicks',
    traits: ['Metal', 'Jangling', 'Bright', 'Short'],
    blurb: 'Keys are a shaker you already carry.',
    color: '#FB923C',
  },
  plant: {
    role: 'texture',
    display: 'Ambient',
    traits: ['Organic', 'Soft', 'Rustling', 'Airy'],
    blurb: 'Leaves fill the space between the beats.',
    color: '#34D399',
  },
  book: {
    role: 'snare',
    display: 'Thump',
    traits: ['Paper', 'Damped', 'Flat', 'Dry'],
    blurb: 'A closed book is a snare with no ring.',
    color: '#F472B6',
  },
  phone: {
    role: 'hat',
    display: 'Tick',
    traits: ['Glass', 'Flat', 'Tight', 'Modern'],
    blurb: 'Small, sharp, and always within reach.',
    color: '#60A5FA',
  },
  box: {
    role: 'kick',
    display: 'Boom',
    traits: ['Hollow', 'Deep', 'Boxy', 'Round'],
    blurb: 'Anything hollow wants to be a kick drum.',
    color: '#F59E0B',
  },
  clap: {
    role: 'snare',
    display: 'Clap',
    traits: ['Body', 'Sharp', 'Human', 'Dry'],
    blurb: 'The instrument you never leave behind.',
    color: '#FB7185',
  },
  voice: {
    role: 'lead',
    display: 'Voice',
    traits: ['Human', 'Melodic', 'Expressive', 'Lead'],
    blurb: 'Your voice leads; everything else follows.',
    color: '#A78BFA',
  },
  unknown: {
    role: 'perc',
    display: 'Percussion',
    traits: ['Unknown', 'Percussive'],
    blurb: 'Every object has a sound worth hearing.',
    color: '#94A3B8',
  },
};

/** Maps a YOLO class name to a category, or null when we have no mapping. */
export function categoryForCocoClass(className: string): ObjectCategory | null {
  return COCO_TO_CATEGORY[className.toLowerCase()] ?? null;
}

export function roleInfoFor(category: ObjectCategory): RoleInfo {
  return CATEGORY_ROLES[category] ?? CATEGORY_ROLES.unknown;
}

/**
 * A friendly display name for a category.
 *
 * Title-cased rather than the raw enum, since this appears directly on the
 * camera overlay next to the object.
 */
export function displayNameFor(category: ObjectCategory): string {
  const names: Record<ObjectCategory, string> = {
    cup: 'Cup',
    glass: 'Glass',
    bottle: 'Bottle',
    table: 'Table',
    laptop: 'Laptop',
    keys: 'Keys',
    plant: 'Plant',
    book: 'Book',
    phone: 'Phone',
    box: 'Box',
    clap: 'Clap',
    voice: 'Voice',
    unknown: 'Object',
  };
  return names[category] ?? 'Object';
}
