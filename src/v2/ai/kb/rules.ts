import type { Capture, FeatureVector } from '../../contracts/library';
import type { BusName, LayerRole, PatchOp, PlanEffect } from '../../contracts/musicPlan';

export const KB_VERSION = 'wj-kb-2026.09.27';

/** Default mix bus per role (knowledge base: DRUMS, BASS, HARMONY, MELODY, TEXTURE, VOCAL, FX). */
export const ROLE_BUS: Record<LayerRole, BusName> = {
  kick: 'DRUMS', snare: 'DRUMS', hat: 'DRUMS', percussion: 'DRUMS',
  bass: 'BASS', chords: 'HARMONY', pad: 'HARMONY', lead: 'MELODY', vocal: 'VOCAL', texture: 'TEXTURE', fx: 'FX',
};

const KEYWORDS: Array<{ words: RegExp; role: LayerRole }> = [
  // Plain "hum" is ambiguous (a fan hums); recordings made in Hum mode are typed HUM anyway.
  { words: /\b(humming|hummed|sing|singing|sang|voice|vocal|vocals|la la)\b/, role: 'vocal' },
  { words: /\b(kick|thump|thud|boom|door|table|desk|floor|stomp|drum|bass drum|chest)\b/, role: 'kick' },
  { words: /\b(clap|snap|slap|smack|snare|crack)\b/, role: 'snare' },
  { words: /\b(glass|spoon|bottle|metal|key|keys|coin|bell|cup|mug|tin|can|ting|tap|click|tick)\b/, role: 'hat' },
  { words: /\b(rain|fan|wind|traffic|water|river|ocean|waves|hiss|noise|crowd|room|birds|engine|ambience|ambient|drone|rub|scrape|shake|rustle)\b/, role: 'texture' },
  { words: /\b(guitar|piano|keyboard|ukulele|violin|string|strings|organ|synth)\b/, role: 'chords' },
  { words: /\b(whistle|flute|harmonica|note|tone|sine|ring|ringing)\b/, role: 'lead' },
];

/**
 * Suggested musical role for a capture: what the user said about it first
 * (name/description/detected object), then what the sound itself looks like.
 */
export function roleForCapture(c: Pick<Capture, 'name' | 'description' | 'type' | 'features' | 'detectedLabel'>): LayerRole {
  if (c.type === 'HUM' || c.type === 'VOCAL') return 'vocal';
  const text = `${c.name} ${c.description} ${c.detectedLabel ?? ''}`.toLowerCase();
  for (const k of KEYWORDS) if (k.words.test(text)) return k.role;
  return roleFromFeatures(c.features);
}

export function roleFromFeatures(f: FeatureVector | null): LayerRole {
  if (!f) return 'percussion';
  if (f.sustained > 0.6 && f.tonality > 0.5 && f.pitchHz) return f.pitchHz < 180 ? 'bass' : 'lead';
  if (f.sustained > 0.6) return 'texture';
  if (f.transient > 0.55) {
    if (f.brightness < 900) return 'kick';
    if (f.brightness > 3500) return 'hat';
    return 'snare';
  }
  if (f.tonality > 0.6 && f.pitchHz) return 'lead';
  return 'percussion';
}

/** Whether a capture can be played as a pitched instrument without sounding broken. */
export function isTonal(f: FeatureVector | null): boolean {
  return !!f && f.tonality >= 0.45 && f.pitchHz != null && f.pitchHz > 40 && f.pitchHz < 2000;
}

/** Compact, model-friendly one-liner of a capture's sound. */
export function describeFeatures(f: FeatureVector | null): string {
  if (!f) return 'unanalysed';
  const parts = [
    `${f.durationSec.toFixed(1)}s`,
    f.transient > 0.55 ? 'percussive' : f.sustained > 0.6 ? 'sustained' : 'mixed',
    f.brightness > 3500 ? 'bright' : f.brightness < 900 ? 'dark/low' : 'mid',
    f.tonality > 0.5 && f.pitchHz ? `tonal ~${Math.round(f.pitchHz)}Hz` : 'noisy',
  ];
  if (f.tempoBpm) parts.push(`~${Math.round(f.tempoBpm)}bpm`);
  if (f.melody?.key) parts.push(`sung in ${f.melody.key}`);
  return parts.join(', ');
}

/** Default effect chain per bus: the renderer executes these, the model may add more. */
export const BUS_EFFECTS: Record<BusName, PlanEffect[]> = {
  DRUMS: [{ type: 'compressor', amount: 0.4 }],
  BASS: [{ type: 'lowpass', cutoffHz: 6000 }, { type: 'compressor', amount: 0.5 }],
  HARMONY: [{ type: 'reverb', size: 0.5, mix: 0.2 }],
  MELODY: [{ type: 'delay', beats: 0.75, feedback: 0.3, mix: 0.18 }, { type: 'reverb', size: 0.5, mix: 0.2 }],
  // A real vocal chain: rumble out, level it, presence up, space around it.
  VOCAL: [
    { type: 'highpass', cutoffHz: 90 },
    { type: 'compressor', amount: 0.6 },
    { type: 'eq', freqHz: 3500, gainDb: 3, q: 0.9 },
    { type: 'delay', beats: 0.5, feedback: 0.22, mix: 0.12 },
    { type: 'reverb', size: 0.55, mix: 0.22 },
  ],
  TEXTURE: [{ type: 'lowpass', cutoffHz: 7000 }, { type: 'reverb', size: 0.8, mix: 0.35 }],
  FX: [{ type: 'reverb', size: 0.7, mix: 0.3 }],
};

/** Editing language → deterministic patch (used when the model is unavailable, and to sanity-check it). */
export interface EditRule {
  test: RegExp;
  describe: string;
  build: (ctx: { layerIds: string[]; melodicIds: string[]; drumIds: string[]; sectionIds: string[]; mainSectionIds: string[]; tempo: number }) => PatchOp[];
}

export const EDIT_RULES: EditRule[] = [
  {
    test: /\b(darker|dark|moodier|gloomy|sad)\b/,
    describe: 'Darker: lower brightness on the melodic parts and warmer mix',
    build: ({ melodicIds, drumIds }) => [
      ...melodicIds.map((id): PatchOp => ({ type: 'add_effect', layerId: id, effect: { type: 'lowpass', cutoffHz: 2200 } })),
      ...drumIds.map((id): PatchOp => ({ type: 'add_effect', layerId: id, effect: { type: 'lowpass', cutoffHz: 5000 } })),
    ],
  },
  {
    test: /\b(brighter|bright|crisper|sparkl\w*|shin\w*)\b/,
    describe: 'Brighter: presence lift on the melodic parts',
    build: ({ melodicIds }) => melodicIds.map((id): PatchOp => ({ type: 'add_effect', layerId: id, effect: { type: 'eq', freqHz: 5000, gainDb: 4, q: 0.8 } })),
  },
  {
    test: /\b(more energ\w*|energetic|bigger|hype|intense|harder|punch\w*|louder chorus)\b/,
    describe: 'More energy: denser, louder main sections',
    build: ({ mainSectionIds, drumIds }) => [
      ...mainSectionIds.map((id): PatchOp => ({ type: 'change_section_energy', sectionId: id, energy: 1 })),
      ...drumIds.map((id): PatchOp => ({ type: 'set_gain', layerId: id, gainDb: 0 })),
    ],
  },
  {
    test: /\b(calm\w*|softer|gentle|relax\w*|mellow|quieter|less energ\w*)\b/,
    describe: 'Calmer: lower section energy',
    build: ({ sectionIds }) => sectionIds.map((id): PatchOp => ({ type: 'change_section_energy', sectionId: id, energy: 0.4 })),
  },
  {
    test: /\b(faster|speed up|quicker|up ?tempo)\b/,
    describe: 'Faster tempo',
    build: ({ tempo }) => [{ type: 'change_tempo', tempoBpm: Math.round(tempo * 1.1) }],
  },
  {
    test: /\b(slower|slow down|half ?time|down ?tempo)\b/,
    describe: 'Slower tempo',
    build: ({ tempo }) => [{ type: 'change_tempo', tempoBpm: Math.round(tempo * 0.9) }],
  },
  {
    test: /\b(reverb|spac\w*|dream\w*|airy|wet|ethereal)\b/,
    describe: 'More space: reverb on the melodic parts',
    build: ({ melodicIds }) => melodicIds.map((id): PatchOp => ({ type: 'add_effect', layerId: id, effect: { type: 'reverb', size: 0.8, mix: 0.4 } })),
  },
  {
    test: /\b(lo-?fi|dusty|vintage|tape|warm\w*|vinyl)\b/,
    describe: 'More lo-fi: saturation and a softer top end',
    build: ({ layerIds }) => layerIds.flatMap((id): PatchOp[] => [
      { type: 'add_effect', layerId: id, effect: { type: 'saturation', drive: 3, mix: 0.4 } },
      { type: 'add_effect', layerId: id, effect: { type: 'lowpass', cutoffHz: 4500 } },
    ]),
  },
];
