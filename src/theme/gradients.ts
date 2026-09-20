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
  /** The signature cyan→magenta of the logo and primary CTA. */
  brand: ['#4DA6FF', '#A855F7', '#EC4899'] as const,
  /** Shorter two-stop version for smaller controls. */
  brandShort: ['#5B9DFF', '#C158E8'] as const,

  /** Per-action tints from the icon row in the artwork. */
  scan: ['#6366F1', '#8B5CF6'] as const,
  capture: ['#C026D3', '#EC4899'] as const,
  ar: ['#0EA5E9', '#22D3EE'] as const,
  compose: ['#F97316', '#EF4444'] as const,
  play: ['#22C55E', '#14B8A6'] as const,

  /** Transport-control surface: near-black with a subtle lift. */
  control: ['#1A1D26', '#0E1016'] as const,
  /** Record button. */
  record: ['#F43F5E', '#DC2626'] as const,

  /** Card surface behind object thumbnails. */
  card: ['#161A24', '#0C0E14'] as const,
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
