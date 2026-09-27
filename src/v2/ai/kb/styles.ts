import type { Style } from '@/types';

import type { LayerRole, ScaleId, SectionKind, StyleId, SynthInstrument } from '../../contracts/musicPlan';

/**
 * Production knowledge per style (04_MUSIC_KNOWLEDGE_BASE.md), as data the
 * planner prompt, the deterministic fallback and the compiler all share.
 * Grooves are one bar of sixteenths: X accent, x hit, - hold, . rest.
 */
export interface StyleSpec {
  id: StyleId;
  label: string;
  tempo: { min: number; max: number; home: number };
  scale: ScaleId;
  /** Nearest V1 style: drives the harmony engine and the synth backing timbres. */
  feel: Style;
  /** 0.5 = straight; ~0.66 = triplet swing. */
  swing: number;
  swingUnit: 0.25 | 0.5;
  humanizeMs: number;
  grooves: Partial<Record<LayerRole, string>>;
  /** Synth support the style usually wants when no tonal capture covers it. */
  backing: SynthInstrument[];
  /** Section plan as proportions of the song, with energy. */
  form: Array<{ kind: SectionKind; share: number; energy: number }>;
  mix: { reverb: number; width: number; warmth: number };
  arrangement: string;
  lyrics: string;
  /** Tags for the ACE-Step production caption. */
  caption: string;
}

const g = {
  four: 'X...X...X...X...',
  half: 'X.......X.......',
  boom: 'X......X..X.....',
  trapKick: 'X......X..X...x.',
  backbeat: '....X.......X...',
  trapSnare: '........X.......',
  eighths: 'x.x.x.x.x.x.x.x.',
  offHat: '..x...x...x...x.',
  sixteenth: 'xxxxxxxxxxxxxxxx',
  trapHat: 'x.xxx.x.x.xxx.xx',
  shaker: '.x.x.x.x.x.x.x.x',
  sparse: 'x.......x.....x.',
  jazzRide: 'X..x.xX..x.xX..x',
  bassRoot: 'X.......x.x.....',
  bassPulse: 'x.x.x.x.x.x.x.x.',
  bassOff: '..X...X...X...X.',
  bassWalk: 'X...x...X...x...',
  dnbBreak: 'X.........X..x..',
  dnbSnare: '....X.......X.x.',
};

export const STYLES: Record<StyleId, StyleSpec> = {
  pop: {
    id: 'pop', label: 'Pop', tempo: { min: 96, max: 124, home: 110 }, scale: 'major', feel: 'chill',
    swing: 0.5, swingUnit: 0.25, humanizeMs: 5,
    grooves: { kick: g.four, snare: g.backbeat, hat: g.eighths, percussion: g.offHat, bass: g.bassRoot },
    backing: ['bass', 'chords'],
    form: [{ kind: 'intro', share: 0.12, energy: 0.35 }, { kind: 'verse', share: 0.28, energy: 0.55 }, { kind: 'chorus', share: 0.3, energy: 0.9 }, { kind: 'bridge', share: 0.15, energy: 0.6 }, { kind: 'outro', share: 0.15, energy: 0.4 }],
    mix: { reverb: 0.3, width: 0.7, warmth: 0.3 },
    arrangement: 'Clear hook, accessible I–V–vi–IV harmony, strong main section, vocal focus.',
    lyrics: 'Memorable hook, conversational verses.',
    caption: 'pop, catchy, bright, polished',
  },
  rock: {
    id: 'rock', label: 'Rock', tempo: { min: 100, max: 140, home: 118 }, scale: 'minor', feel: 'rock',
    swing: 0.5, swingUnit: 0.5, humanizeMs: 7,
    grooves: { kick: 'X.....X.X.......', snare: g.backbeat, hat: g.eighths, percussion: g.eighths, bass: g.bassPulse },
    backing: ['bass', 'guitar'],
    form: [{ kind: 'intro', share: 0.12, energy: 0.5 }, { kind: 'verse', share: 0.28, energy: 0.65 }, { kind: 'chorus', share: 0.3, energy: 1 }, { kind: 'bridge', share: 0.15, energy: 0.7 }, { kind: 'outro', share: 0.15, energy: 0.8 }],
    mix: { reverb: 0.2, width: 0.8, warmth: 0.6 },
    arrangement: 'Strong backbeat, driving bass, energetic dynamics, fills, section contrast.',
    lyrics: 'Direct imagery, energetic hook.',
    caption: 'rock, driving drums, distorted guitars, energetic',
  },
  edm: {
    id: 'edm', label: 'EDM', tempo: { min: 120, max: 130, home: 126 }, scale: 'minor', feel: 'edm',
    swing: 0.5, swingUnit: 0.25, humanizeMs: 1,
    grooves: { kick: g.four, snare: g.backbeat, hat: g.offHat, percussion: g.sixteenth, bass: g.bassOff },
    backing: ['bass', 'pad', 'arp'],
    form: [{ kind: 'intro', share: 0.13, energy: 0.35 }, { kind: 'build', share: 0.2, energy: 0.65 }, { kind: 'drop', share: 0.27, energy: 1 }, { kind: 'breakdown', share: 0.13, energy: 0.4 }, { kind: 'drop', share: 0.27, energy: 1 }],
    mix: { reverb: 0.35, width: 0.9, warmth: 0.2 },
    arrangement: 'Four-on-the-floor kick, offbeat bass, repeated motif, build then drop, filter automation.',
    lyrics: 'Short rhythmic phrases and a repeated hook.',
    caption: 'edm, festival, four on the floor, big drop, synth',
  },
  jazz: {
    id: 'jazz', label: 'Jazz', tempo: { min: 100, max: 140, home: 120 }, scale: 'dorian', feel: 'jazz',
    swing: 0.64, swingUnit: 0.5, humanizeMs: 12,
    grooves: { kick: g.sparse, snare: '......x.......x.', hat: g.jazzRide, percussion: g.jazzRide, bass: g.bassWalk },
    backing: ['bass', 'chords'],
    form: [{ kind: 'intro', share: 0.15, energy: 0.4 }, { kind: 'verse', share: 0.35, energy: 0.6 }, { kind: 'chorus', share: 0.35, energy: 0.75 }, { kind: 'outro', share: 0.15, energy: 0.45 }],
    mix: { reverb: 0.35, width: 0.6, warmth: 0.5 },
    arrangement: 'Swing and syncopation, ii–V–I extended harmony, walking bass, call and response, space.',
    lyrics: 'Conversational, sophisticated phrasing.',
    caption: 'jazz, swing, brushed drums, walking bass, piano',
  },
  lofi: {
    id: 'lofi', label: 'Lo-fi', tempo: { min: 70, max: 90, home: 82 }, scale: 'minor', feel: 'lofi',
    swing: 0.6, swingUnit: 0.25, humanizeMs: 14,
    grooves: { kick: g.boom, snare: g.backbeat, hat: g.eighths, percussion: g.shaker, bass: g.bassRoot },
    backing: ['bass', 'chords'],
    form: [{ kind: 'intro', share: 0.15, energy: 0.35 }, { kind: 'verse', share: 0.35, energy: 0.55 }, { kind: 'chorus', share: 0.35, energy: 0.7 }, { kind: 'outro', share: 0.15, energy: 0.35 }],
    mix: { reverb: 0.35, width: 0.6, warmth: 0.8 },
    arrangement: 'Relaxed tempo, sparse drums, warm low-pass filtering, subtle saturation, simple jazzy chords, ambience.',
    lyrics: 'Intimate, understated imagery.',
    caption: 'lofi hip hop, dusty drums, warm, mellow keys, vinyl',
  },
  chill: {
    id: 'chill', label: 'Chill', tempo: { min: 84, max: 100, home: 92 }, scale: 'major', feel: 'chill',
    swing: 0.56, swingUnit: 0.25, humanizeMs: 9,
    grooves: { kick: g.half, snare: g.backbeat, hat: g.offHat, percussion: g.shaker, bass: g.bassRoot },
    backing: ['bass', 'pad'],
    form: [{ kind: 'intro', share: 0.18, energy: 0.3 }, { kind: 'verse', share: 0.32, energy: 0.5 }, { kind: 'chorus', share: 0.32, energy: 0.65 }, { kind: 'outro', share: 0.18, energy: 0.3 }],
    mix: { reverb: 0.45, width: 0.8, warmth: 0.4 },
    arrangement: 'Slow to medium tempo, sustained tones, lots of space, sparse rhythm, gradual change.',
    lyrics: 'Minimal, atmospheric language.',
    caption: 'chill, downtempo, relaxed, airy pads',
  },
  ambient: {
    id: 'ambient', label: 'Ambient', tempo: { min: 60, max: 84, home: 70 }, scale: 'major', feel: 'cinematic',
    swing: 0.5, swingUnit: 0.5, humanizeMs: 10,
    grooves: { percussion: g.sparse, bass: 'X---------------' },
    backing: ['pad'],
    form: [{ kind: 'intro', share: 0.25, energy: 0.25 }, { kind: 'verse', share: 0.5, energy: 0.45 }, { kind: 'outro', share: 0.25, energy: 0.25 }],
    mix: { reverb: 0.7, width: 1, warmth: 0.3 },
    arrangement: 'Sustained, modal harmony, drones and textures, slow evolution, almost no rhythm.',
    lyrics: 'Minimal, atmospheric language.',
    caption: 'ambient, atmospheric, drone, evolving textures',
  },
  hiphop: {
    id: 'hiphop', label: 'Hip-hop', tempo: { min: 84, max: 98, home: 90 }, scale: 'minor', feel: 'lofi',
    swing: 0.58, swingUnit: 0.25, humanizeMs: 8,
    grooves: { kick: g.boom, snare: g.backbeat, hat: g.eighths, percussion: g.offHat, bass: g.bassRoot },
    backing: ['bass', 'chords'],
    form: [{ kind: 'intro', share: 0.12, energy: 0.45 }, { kind: 'verse', share: 0.38, energy: 0.7 }, { kind: 'chorus', share: 0.35, energy: 0.85 }, { kind: 'outro', share: 0.15, energy: 0.5 }],
    mix: { reverb: 0.2, width: 0.6, warmth: 0.5 },
    arrangement: 'Strong kick/snare groove, heavy bass, repetitive motif, space for the vocal, syncopation.',
    lyrics: 'Rhythmic flow, internal rhyme, wordplay.',
    caption: 'hip hop, boom bap, punchy drums, deep bass',
  },
  trap: {
    id: 'trap', label: 'Trap', tempo: { min: 130, max: 150, home: 140 }, scale: 'minor', feel: 'edm',
    swing: 0.5, swingUnit: 0.25, humanizeMs: 2,
    grooves: { kick: g.trapKick, snare: g.trapSnare, hat: g.trapHat, percussion: g.offHat, bass: g.trapKick },
    backing: ['bass', 'pad'],
    form: [{ kind: 'intro', share: 0.15, energy: 0.4 }, { kind: 'verse', share: 0.35, energy: 0.75 }, { kind: 'chorus', share: 0.35, energy: 0.95 }, { kind: 'outro', share: 0.15, energy: 0.4 }],
    mix: { reverb: 0.25, width: 0.8, warmth: 0.3 },
    arrangement: 'Half-time feel, 808-style long bass, rolling syncopated hats, sparse kick/snare, dark space.',
    lyrics: 'Rhythmic flow, repeated hook.',
    caption: 'trap, 808, rolling hi hats, dark',
  },
  house: {
    id: 'house', label: 'House', tempo: { min: 118, max: 128, home: 124 }, scale: 'minor', feel: 'edm',
    swing: 0.54, swingUnit: 0.25, humanizeMs: 2,
    grooves: { kick: g.four, snare: g.backbeat, hat: g.offHat, percussion: g.shaker, bass: g.bassOff },
    backing: ['bass', 'chords'],
    form: [{ kind: 'intro', share: 0.15, energy: 0.45 }, { kind: 'verse', share: 0.3, energy: 0.7 }, { kind: 'chorus', share: 0.4, energy: 0.95 }, { kind: 'outro', share: 0.15, energy: 0.5 }],
    mix: { reverb: 0.3, width: 0.8, warmth: 0.3 },
    arrangement: '4/4 kick, offbeat hats, rolling bass groove, repeated hook with small variations.',
    lyrics: 'Short repeated hook.',
    caption: 'house, deep house, groovy, four on the floor',
  },
  dnb: {
    id: 'dnb', label: 'Drum & Bass', tempo: { min: 168, max: 178, home: 174 }, scale: 'minor', feel: 'edm',
    swing: 0.5, swingUnit: 0.25, humanizeMs: 2,
    grooves: { kick: g.dnbBreak, snare: g.dnbSnare, hat: g.sixteenth, percussion: g.offHat, bass: 'X-----x-X-------' },
    backing: ['bass', 'pad'],
    form: [{ kind: 'intro', share: 0.15, energy: 0.45 }, { kind: 'build', share: 0.2, energy: 0.7 }, { kind: 'drop', share: 0.45, energy: 1 }, { kind: 'outro', share: 0.2, energy: 0.5 }],
    mix: { reverb: 0.25, width: 0.8, warmth: 0.3 },
    arrangement: 'Fast breakbeat, rolling sub bass, dense rhythmic motion, pads for contrast.',
    lyrics: 'Short, rhythmic phrases.',
    caption: 'drum and bass, fast breakbeat, rolling bass',
  },
  cinematic: {
    id: 'cinematic', label: 'Cinematic', tempo: { min: 62, max: 90, home: 72 }, scale: 'minor', feel: 'cinematic',
    swing: 0.5, swingUnit: 0.5, humanizeMs: 6,
    grooves: { kick: 'X.......X.....X.', percussion: 'X...x...X...x.x.', bass: 'X---------------' },
    backing: ['pad', 'bass'],
    form: [{ kind: 'intro', share: 0.2, energy: 0.3 }, { kind: 'build', share: 0.3, energy: 0.6 }, { kind: 'chorus', share: 0.3, energy: 1 }, { kind: 'outro', share: 0.2, energy: 0.35 }],
    mix: { reverb: 0.6, width: 1, warmth: 0.3 },
    arrangement: 'Motif development, tension and release, big dynamic arc, layered textures, taiko-like hits.',
    lyrics: 'Visual imagery and an emotional arc.',
    caption: 'cinematic, epic, orchestral, tension',
  },
  acoustic: {
    id: 'acoustic', label: 'Acoustic', tempo: { min: 80, max: 112, home: 96 }, scale: 'major', feel: 'chill',
    swing: 0.53, swingUnit: 0.25, humanizeMs: 11,
    grooves: { kick: g.half, snare: g.backbeat, percussion: g.shaker, bass: g.bassRoot },
    backing: ['guitar', 'bass'],
    form: [{ kind: 'intro', share: 0.15, energy: 0.35 }, { kind: 'verse', share: 0.35, energy: 0.5 }, { kind: 'chorus', share: 0.35, energy: 0.7 }, { kind: 'outro', share: 0.15, energy: 0.35 }],
    mix: { reverb: 0.3, width: 0.6, warmth: 0.5 },
    arrangement: 'Natural dynamics, human timing, simple harmony, minimal processing, strummed guitar.',
    lyrics: 'Honest, storytelling verses.',
    caption: 'acoustic, organic, warm, fingerpicked guitar',
  },
};

export function styleSpec(id: StyleId | null | undefined): StyleSpec {
  return STYLES[id ?? 'chill'] ?? STYLES.chill;
}

/** Bars for a target length at a tempo (4/4), at least 4. */
export function barsFor(durationSec: number, bpm: number): number {
  return Math.max(4, Math.round((durationSec * bpm) / 240));
}

/** Splits a song of `totalBars` into the style's sections (whole bars, at least 1 each). */
export function formFor(style: StyleSpec, totalBars: number): Array<{ kind: SectionKind; bars: number; energy: number }> {
  const raw = style.form.map((f) => ({ ...f, bars: Math.max(1, Math.round(f.share * totalBars)) }));
  let diff = totalBars - raw.reduce((n, s) => n + s.bars, 0);
  // Put rounding slack into (or take it from) the most energetic section.
  const main = raw.reduce((best, s, i) => (s.energy > raw[best].energy ? i : best), 0);
  while (diff !== 0) {
    const i = diff > 0 ? main : raw.findIndex((s) => s.bars > 1);
    if (i < 0) break;
    raw[i].bars += diff > 0 ? 1 : -1;
    diff += diff > 0 ? -1 : 1;
  }
  return raw.map(({ kind, bars, energy }) => ({ kind, bars, energy }));
}
