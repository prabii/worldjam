/**
 * Gradients and glow tokens taken from the WorldJam design system artwork.
 *
 * Every gradient here is a pair sampled from the reference image rather than
 * invented, so components built from these read as one family. Colours are
 * ordered light-to-dark along the direction the artwork uses (top-left to
 * bottom-right), which is what makes the buttons look lit from above.
 */

/** Tuple type LinearGradient requires: at least two stops. */
export type GradientStops = readonly [string, string, ...string[]];

export const gradients = {
  /** The signature brand gradient. */
  brand: ['#0A84FF', '#BF5AF2', '#FF375F'] as const,
  /** Shorter two-stop version for smaller controls. */
  brandShort: ['#0A84FF', '#BF5AF2'] as const,

  /** Per-action tints. */
  scan: ['#5E5CE6', '#BF5AF2'] as const,
  capture: ['#BF5AF2', '#FF375F'] as const,
  ar: ['#0A84FF', '#64D2FF'] as const,
  compose: ['#FF9F0A', '#FF453A'] as const,
  play: ['#30D158', '#5AC8FA'] as const,

  /** Transport-control surface: near-black with a subtle lift. */
  control: ['#1C1C1E', '#0C0C0E'] as const,
  /** Record button. */
  record: ['#FF453A', '#FF375F'] as const,

  /** Card surface behind object thumbnails. */
  card: ['#1C1C1E', '#0C0C0E'] as const,
} as const;

/**
 * Glow presets.
 *
 * React Native shadows only render outward on iOS; on Android `elevation`
 * produces a grey drop shadow that cannot be tinted. These values are
 * therefore paired with a coloured border in the components rather than
 * relied on alone — the border is what actually reads as a glow on Android.
 */
export const glow = {
  soft: (color: string) => ({
    shadowColor: color,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  }),
  strong: (color: string) => ({
    shadowColor: color,
    shadowOpacity: 0.7,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
  }),
} as const;

/** Role labels and their accent, matching the object cards in the artwork. */
export const roleAccents: Record<string, string> = {
  kick: '#F472B6',
  snare: '#FB923C',
  hat: '#38BDF8',
  perc: '#C084FC',
  bass: '#F59E0B',
  lead: '#34D399',
  texture: '#818CF8',
};
