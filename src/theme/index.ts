/**
 * WorldJam visual language.
 *
 * Clean, minimal, dark. Apple-inspired spacing and typography with the
 * WorldJam personality. Near-black surfaces let camera and waveforms dominate.
 * Touch targets are generous for use while tapping physical objects.
 */

export const colors = {
  bg: '#000000',
  surface: 'rgba(18, 18, 20, 0.92)',
  surfaceSolid: '#121214',
  surfaceRaised: 'rgba(28, 28, 32, 0.95)',
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(255, 255, 255, 0.18)',

  text: '#F5F5F7',
  textDim: 'rgba(245, 245, 247, 0.55)',
  textFaint: 'rgba(245, 245, 247, 0.30)',

  // The signature accent — used only for live/sounding state.
  accent: '#FF453A',
  accentDim: 'rgba(255, 69, 58, 0.15)',

  live: '#30D158',
  liveDim: 'rgba(48, 209, 88, 0.12)',
  warn: '#FFD60A',
  danger: '#FF453A',
  ai: '#BF5AF2',
  aiDim: 'rgba(191, 90, 242, 0.12)',

  /** The blue accent for selection and interactive elements. */
  vibe: '#0A84FF',
  vibeDim: 'rgba(10, 132, 255, 0.12)',

  /**
   * Per-object accents. Assigned in order as objects are captured.
   */
  objectPalette: [
    '#FF9F0A', // orange
    '#FFD60A', // yellow
    '#FF375F', // pink
    '#64D2FF', // cyan
    '#30D158', // green
    '#BF5AF2', // purple
    '#5AC8FA', // teal
    '#FF6482', // rose
    '#FF9F0A', // amber
    '#5E5CE6', // indigo
    '#32D74B', // lime
  ] as string[],
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const type = {
  display: { fontSize: 30, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 20, fontWeight: '600' as const, letterSpacing: -0.3 },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '600' as const },
  mono: { fontSize: 12, fontWeight: '500' as const, letterSpacing: 0.3 },
  caption: { fontSize: 11, fontWeight: '500' as const, letterSpacing: 0.6 },
} as const;

/** Minimum touch target — these are hit while looking at a physical object. */
export const HIT_SIZE = 56;
