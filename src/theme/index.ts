/**
 * WorldJam visual language.
 *
 * The app is used with a camera open in a room, often dim, at arm's length,
 * while the user is tapping physical objects. So: near-black surfaces that let
 * the camera feed dominate, one hot accent for anything that makes sound, and
 * touch targets big enough to hit without looking.
 */

export const colors = {
  bg: '#08090C',
  surface: 'rgba(20, 22, 28, 0.88)',
  surfaceSolid: '#14161C',
  surfaceRaised: 'rgba(32, 35, 44, 0.94)',
  border: 'rgba(255, 255, 255, 0.10)',
  borderStrong: 'rgba(255, 255, 255, 0.22)',

  text: '#F4F5F7',
  textDim: 'rgba(244, 245, 247, 0.62)',
  textFaint: 'rgba(244, 245, 247, 0.38)',

  // The signature accent — used only for live/sounding state.
  accent: '#FF5B4A',
  accentDim: 'rgba(255, 91, 74, 0.18)',

  live: '#34D399',
  liveDim: 'rgba(52, 211, 153, 0.16)',
  warn: '#FBBF24',
  danger: '#F87171',
  ai: '#A78BFA',
  aiDim: 'rgba(167, 139, 250, 0.16)',
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
  lg: 18,
  xl: 26,
  pill: 999,
} as const;

export const type = {
  display: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.6 },
  title: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.3 },
  body: { fontSize: 15, fontWeight: '500' as const },
  label: { fontSize: 13, fontWeight: '600' as const },
  mono: { fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.4 },
  caption: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.8 },
} as const;

/** Minimum touch target — these are hit while looking at a physical object. */
export const HIT_SIZE = 56;
