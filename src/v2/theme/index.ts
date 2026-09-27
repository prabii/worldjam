/**
 * WorldJam V2 design tokens (06_UI_UX_DESIGN_SYSTEM.md).
 *
 * Dark neutral base, one restrained accent gradient used only for active or
 * important states, large type, generous spacing. Scoped to V2 so the frozen
 * V1 screens keep their own theme untouched.
 */

export const color = {
  bg: '#0B0D12',
  surface: '#12151C',
  elevated: '#181C24',
  /** Hairlines and outlines on surfaces. */
  line: '#232835',
  text: '#F8FAFC',
  textSecondary: '#A7AFBD',
  textMuted: '#687386',
  cyan: '#67E8F9',
  violet: '#8B5CF6',
  pink: '#F472B6',
  success: '#34D399',
  warning: '#FBBF24',
  error: '#FB7185',
  /** Scrim behind sheets. */
  scrim: 'rgba(5,6,9,0.72)',
} as const;

/** The single accent gradient, cyan → violet → pink. */
export const accentGradient = [color.cyan, color.violet, color.pink] as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { card: 12, panel: 16, round: 999 } as const;

/** Minimum touch target (dp). */
export const touch = 48;

export const font = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' as const, color: color.text, letterSpacing: -0.4 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '600' as const, color: color.text, letterSpacing: -0.2 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const, color: color.text },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' as const, color: color.textSecondary },
  label: { fontSize: 13, lineHeight: 16, fontWeight: '500' as const, color: color.textSecondary },
  caption: { fontSize: 12, lineHeight: 15, fontWeight: '500' as const, color: color.textMuted },
  mono: { fontSize: 12, lineHeight: 15, fontWeight: '500' as const, color: color.textMuted, fontVariant: ['tabular-nums' as const] },
};

/** Musical role → accent hue, used sparingly (orbit rings, pad edges). */
export const roleColor: Record<string, string> = {
  kick: color.pink,
  snare: color.pink,
  hat: color.pink,
  percussion: color.pink,
  bass: color.violet,
  chords: color.violet,
  pad: color.violet,
  lead: color.cyan,
  vocal: color.cyan,
  texture: color.textSecondary,
  fx: color.textSecondary,
};

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const days = Math.floor((now - ts) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
