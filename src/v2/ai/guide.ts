import type { PerformanceEvent } from '../contracts/library';
import type { LayerRole, StyleId } from '../contracts/musicPlan';
import type { PlannerCapture } from './fallback';
import { isTonal, roleForCapture } from './kb/rules';
import { STYLES, styleSpec } from './kb/styles';

/**
 * The AI Guide: starter patterns for the sounds the user picked. Built from the
 * knowledge base's grooves so it answers instantly (no model call), and
 * specific to *these* sounds: each suggestion says which sound plays what.
 */
export interface GuidePart {
  captureId: string;
  name: string;
  role: LayerRole;
  /** One bar of 16 sixteenths (X accent, x hit, - hold, . rest). */
  pattern: string;
}

export interface GuideSuggestion {
  id: string;
  style: StyleId;
  title: string;
  /** One line in plain words: how the sounds are used. */
  description: string;
  tempoBpm: number;
  parts: GuidePart[];
  /** A ready-made prompt for AI mode. */
  prompt: string;
}

const DRUM_ORDER: LayerRole[] = ['kick', 'snare', 'hat', 'percussion'];

/** Which styles suit a set of roles, most fitting first. */
function stylesFor(roles: LayerRole[]): StyleId[] {
  const has = (r: LayerRole) => roles.includes(r);
  const out: StyleId[] = [];
  if (has('vocal')) out.push('lofi', 'pop', 'acoustic');
  if (has('texture') || has('pad')) out.push('ambient', 'chill');
  if (has('kick') && has('hat')) out.push('house', 'hiphop', 'trap');
  if (has('kick')) out.push('edm', 'rock');
  if (has('lead') || has('chords') || has('bass')) out.push('jazz', 'cinematic');
  out.push('lofi', 'hiphop', 'chill', 'pop');
  return [...new Set(out)];
}

const PRETTY: Record<LayerRole, string> = {
  kick: 'the low hit', snare: 'the backbeat', hat: 'the ticking top', percussion: 'the shuffle', bass: 'the bass line',
  chords: 'the chords', pad: 'the pad', lead: 'the melody', vocal: 'the vocal', texture: 'the atmosphere', fx: 'the effects',
};

/** Assigns each sound a distinct job for a style and picks its groove. */
function partsFor(captures: PlannerCapture[], style: StyleId): GuidePart[] {
  const spec = styleSpec(style);
  const used = new Set<LayerRole>();
  return captures.slice(0, 8).map((c) => {
    let role = c.role ?? roleForCapture(c);
    if (DRUM_ORDER.includes(role)) {
      if (used.has(role)) role = DRUM_ORDER.find((r) => !used.has(r)) ?? 'percussion';
      used.add(role);
    }
    if (role === 'lead' && !isTonal(c.features)) role = 'percussion';
    const sustained = role === 'texture' || role === 'pad' || role === 'vocal';
    const pattern = sustained ? 'X---------------' : spec.grooves[role] ?? spec.grooves.percussion ?? 'X...x...X...x...';
    return { captureId: c.id, name: c.name, role, pattern };
  });
}

export function suggestPatterns(captures: PlannerCapture[], max = 5): GuideSuggestion[] {
  if (captures.length === 0) return [];
  const roles = captures.map((c) => c.role ?? roleForCapture(c));
  return stylesFor(roles)
    .slice(0, max)
    .map((style) => {
      const spec = STYLES[style];
      const parts = partsFor(captures, style);
      const lead = parts.slice(0, 3).map((p) => `${p.name} as ${PRETTY[p.role]}`).join(', ');
      return {
        id: `guide-${style}`,
        style,
        title: `${spec.label} starter`,
        description: `${lead}. ${spec.arrangement.split('.')[0]}.`,
        tempoBpm: spec.tempo.home,
        parts,
        prompt: `Make a ${spec.label.toLowerCase()} track: ${parts.map((p) => `${p.name} as ${PRETTY[p.role]}`).join(', ')}.`,
      };
    });
}

/**
 * A suggestion as a playable/recordable performance: `bars` bars of hits on the
 * pads holding each sound (padOf maps capture → pad index).
 */
export function suggestionToPerformance(s: GuideSuggestion, padOf: (captureId: string) => number | null, bars = 2): { events: PerformanceEvent[]; lengthMs: number } {
  const msPerStep = 15000 / s.tempoBpm;
  const events: PerformanceEvent[] = [];
  for (const part of s.parts) {
    const pad = padOf(part.captureId);
    if (pad == null) continue;
    for (let bar = 0; bar < bars; bar++) {
      for (let step = 0; step < 16; step++) {
        const ch = part.pattern[step];
        if (ch !== 'X' && ch !== 'x') continue;
        events.push({ padIndex: pad, timeMs: Math.round((bar * 16 + step) * msPerStep), velocity: ch === 'X' ? 1 : 0.7 });
      }
    }
  }
  return { events: events.sort((a, b) => a.timeMs - b.timeMs), lengthMs: Math.round(bars * 16 * msPerStep) };
}
