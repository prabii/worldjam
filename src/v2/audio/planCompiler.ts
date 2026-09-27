import { buildArp, buildBassline, buildChordVoicing, progressionFor } from '@/audio/harmony';
import { jitter, swingBeat } from '@/audio/groove';
import { hzToMidi } from '@/dsp/analysis';

import type { FeatureVector } from '../contracts/library';
import type { BusName, LayerRole, MusicPlan, PlanEffect, PlanLayer, PlanSection, ScaleId, StyleId, SynthInstrument } from '../contracts/musicPlan';
import { RENDER_GRAPH_VERSION, type RenderBus, type RenderEffect, type RenderEvent, type RenderGraph, type RenderLayer, type RenderSource } from '../contracts/renderGraph';
import { BUS_EFFECTS, ROLE_BUS } from '../ai/kb/rules';
import { styleSpec } from '../ai/kb/styles';

export const RENDERER_VERSION = 'wj-render-2026.09.27';

export interface InventoryItem {
  /** Absolute WAV path (no file://). */
  path: string;
  durationSec: number;
  features: FeatureVector | null;
}

export interface CompileDeps {
  /** Renders `bars` of a synth part as a loopable WAV at `bpm`. */
  renderSynthStem(instrument: SynthInstrument, opts: { bpm: number; bars: number; key: string; scale: ScaleId; style: StyleId }): Promise<{ path: string; durationSec: number }>;
  /** Optional AI texture (Stable Audio Open Small); null when unavailable. */
  renderTexture?(prompt: string, seconds: number): Promise<{ path: string; durationSec: number } | null>;
}

export interface CompileOptions {
  sampleRate?: number;
  /** Leave these roles out (e.g. the vocal, when rendering the bed ACE-Step reimagines). */
  excludeRoles?: LayerRole[];
  /** ACE-Step production to blend in, and how much of it (0..1) sits over the capture bed. */
  production?: { path: string; durationSec: number; amount: number } | null;
  /**
   * The user's timing (same controls as Manual): grid 0 = keep the style's own
   * feel, else hits are pulled onto 1/4, 1/8 or 1/16 by `strength`; `swing`
   * 0..1 delays every second subdivision; tighter strength = less humanising.
   */
  timing?: { grid: 0 | 1 | 2 | 4; strength: number; swing: number } | null;
}

type Timing = CompileOptions['timing'];

/** Style feel, overridden by the user's timing when set. */
function feelFor(spec: { swing: number; swingUnit: 0.25 | 0.5; humanizeMs: number }, t: Timing) {
  if (!t) return { place: (beat: number) => swingBeat(beat, spec.swing, spec.swingUnit), humanizeMs: spec.humanizeMs };
  const unit: 0.25 | 0.5 = t.grid === 1 || t.grid === 2 ? 0.5 : 0.25;
  const ratio = t.swing > 0 ? 0.5 + Math.min(1, t.swing) * 0.25 : spec.swing;
  const strength = Math.max(0, Math.min(1, t.strength));
  return {
    place: (beat: number) => {
      let b = beat;
      if (t.grid > 0) {
        const q = Math.round(beat * t.grid) / t.grid;
        b = beat + (q - beat) * strength;
      }
      return swingBeat(b, ratio, t.swing > 0 ? unit : spec.swingUnit);
    },
    humanizeMs: t.grid > 0 ? spec.humanizeMs * (1 - strength) : spec.humanizeMs,
  };
}

const NOTE_INDEX: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const DRUMS: LayerRole[] = ['kick', 'snare', 'hat', 'percussion'];
const SUSTAINED: LayerRole[] = ['pad', 'texture', 'fx'];

const BUS_GAIN: Record<BusName, number> = { DRUMS: -2, BASS: -3, HARMONY: -4, MELODY: -3, VOCAL: 0, TEXTURE: -6, FX: -5 };

/** PlanEffect (musical, tempo-relative) → RenderEffect (explicit DSP parameters). */
export function toRenderEffect(e: PlanEffect, bpm: number, reverbScale = 1): RenderEffect {
  switch (e.type) {
    case 'lowpass':
    case 'highpass':
      return { type: e.type, cutoffHz: e.cutoffHz, q: e.q ?? 0.707 };
    case 'eq':
      return { type: 'peak', freqHz: e.freqHz, gainDb: e.gainDb, q: e.q ?? 1 };
    case 'delay':
      return { type: 'delay', timeSec: (e.beats * 60) / bpm, feedback: e.feedback, mix: e.mix };
    case 'reverb':
      return { type: 'reverb', roomSize: e.size, damping: 0.45, mix: Math.min(0.8, e.mix * reverbScale) };
    case 'saturation':
      return { type: 'saturation', drive: e.drive, mix: e.mix ?? 0.5 };
    case 'compressor':
      return { type: 'compressor', thresholdDb: -10 - 20 * e.amount, ratio: 1.5 + 4 * e.amount, attackMs: 8, releaseMs: 120, makeupDb: 4 * e.amount };
  }
}

const clampRate = (r: number) => Math.min(4, Math.max(0.25, r));

/** Playback rate that moves a sound's own pitch to `targetMidi`, folded by octaves into a usable range. */
export function rateFor(sourceMidi: number, targetMidi: number): number {
  let semis = targetMidi - sourceMidi;
  while (semis > 24) semis -= 12;
  while (semis < -24) semis += 12;
  return clampRate(2 ** (semis / 12));
}

interface Timeline {
  bpm: number;
  secPerBar: number;
  secPerBeat: number;
  stepSec: number;
}

/** Events for a patterned layer across one section: energy thinning, accents, swing, humanisation, end-of-section fills. */
function patternEvents(layer: PlanLayer, section: PlanSection, next: PlanSection | undefined, tl: Timeline, style: StyleId, srcDur: number, timing?: Timing): RenderEvent[] {
  const pattern = layer.pattern ?? '';
  if (!pattern) return [];
  const spec = styleSpec(style);
  const feel = feelFor(spec, timing);
  const rate = layer.pitch?.mode === 'fixed' ? 2 ** (layer.pitch.semitones / 12) : 1;
  const out: RenderEvent[] = [];
  const isDrum = DRUMS.includes(layer.role);
  for (let bar = 0; bar < section.bars; bar++) {
    const lastBar = bar === section.bars - 1;
    const fill = isDrum && lastBar && next && next.energy > section.energy && section.energy >= 0.5 && layer.role !== 'kick';
    for (let step = 0; step < 16; step++) {
      let ch = pattern[step] ?? '.';
      if (fill && step >= 12 && ch === '.') ch = step % 2 === 0 ? 'x' : '.';
      if (ch !== 'X' && ch !== 'x') continue;
      // Quieter sections keep the anchors and drop the ornaments.
      if (section.energy < 0.35 && ch === 'x' && step % 4 !== 0) continue;
      if (section.energy < 0.6 && ch === 'x' && step % 2 === 1) continue;
      let holds = 0;
      while (pattern[step + 1 + holds] === '-') holds++;
      const beat = bar * 4 + step / 4;
      const swung = feel.place(beat);
      const seed = `${layer.id}:${section.id}:${bar}:${step}`;
      const human = (feel.humanizeMs / 1000) * jitter(seed);
      const time = (section.startSec ?? 0) + swung * tl.secPerBeat + (step === 0 ? Math.max(0, human) : human);
      const gainDb = (ch === 'X' ? 0 : -5) + (section.energy - 1) * 6 + jitter(`v${seed}`) * 1.2;
      // Drums are cut before they smear into the next hit; held steps sustain.
      const maxLen = holds > 0 ? (holds + 1) * tl.stepSec : isDrum ? Math.min(srcDur / rate, tl.secPerBeat * 2) : undefined;
      out.push({ timeSec: Math.max(0, time), rate, gainDb, durationSec: maxLen, fadeOutSec: 0.02 });
    }
  }
  return out;
}

/** A tonal capture played as bass/chords/melody following the harmony engine. */
function pitchedEvents(layer: PlanLayer, section: PlanSection, plan: MusicPlan, tl: Timeline, sourceMidi: number, timing?: Timing): RenderEvent[] {
  const spec = styleSpec(plan.style);
  const feel = feelFor(spec, timing);
  const chords = progressionFor(spec.feel, section.bars);
  const mode = layer.pitch && layer.pitch.mode !== 'fixed' && layer.pitch.mode !== 'hum' ? layer.pitch.mode : 'melody';
  const notes = mode === 'bass' ? buildBassline(chords, spec.feel) : mode === 'chords' ? buildChordVoicing(chords, spec.feel) : buildArp(chords, spec.feel);
  const root = NOTE_INDEX[plan.key] ?? 9;
  const octaveBase = mode === 'bass' ? 36 : mode === 'chords' ? 60 : 72;
  return notes
    .filter((n) => n.beat < section.bars * 4)
    .map((n) => ({
      timeSec: (section.startSec ?? 0) + feel.place(n.beat) * tl.secPerBeat,
      rate: rateFor(sourceMidi, octaveBase + root + n.semitone),
      gainDb: 20 * Math.log10(Math.max(0.05, n.velocity)) + (section.energy - 1) * 5 + (mode === 'chords' ? -4 : 0),
      durationSec: Math.max(0.05, n.duration * tl.secPerBeat),
      fadeOutSec: 0.04,
    }));
}

/** One looped event covering the whole section, for stems, textures and sustained sounds. */
function loopEvent(section: PlanSection, gainDb: number, fadeSec = 0.08): RenderEvent {
  return {
    timeSec: section.startSec ?? 0,
    durationSec: (section.endSec ?? 0) - (section.startSec ?? 0),
    rate: 1,
    gainDb,
    loop: true,
    fadeInSec: fadeSec,
    fadeOutSec: fadeSec,
  };
}

/**
 * MusicPlan → RenderGraph. Pure apart from the injected stem renderers, and
 * deterministic: the same plan and sounds always render the same track.
 */
export async function compilePlan(plan: MusicPlan, inventory: Record<string, InventoryItem>, deps: CompileDeps, opts: CompileOptions = {}): Promise<RenderGraph> {
  const sampleRate = opts.sampleRate ?? 48000;
  const bpm = plan.tempoBpm;
  const tl: Timeline = { bpm, secPerBar: 240 / bpm, secPerBeat: 60 / bpm, stepSec: 15 / bpm };
  const sources: RenderSource[] = [];
  const layers: RenderLayer[] = [];
  const reverbScale = 0.5 + (plan.mix.reverb ?? 0.3);
  const warmth = plan.mix.warmth ?? 0.3;
  const width = 0.5 + (plan.mix.width ?? 0.7) / 2;
  const bedOffsetDb = opts.production ? -9 * Math.min(1, Math.max(0, opts.production.amount)) : 0;
  const stems = new Map<string, { path: string; durationSec: number }>();

  for (const layer of plan.layers) {
    if (opts.excludeRoles?.includes(layer.role)) continue;
    const active = plan.sections.filter((s) => s.layers.includes(layer.id));
    if (active.length === 0) continue;
    const bus = layer.bus ?? ROLE_BUS[layer.role];
    const isVoice = layer.role === 'vocal' || layer.pitch?.mode === 'hum';
    const offset = isVoice ? 0 : bedOffsetDb;
    let sourceId: string;
    let events: RenderEvent[] = [];

    if (layer.source.kind === 'capture') {
      const item = inventory[layer.source.captureId];
      if (!item) continue;
      sourceId = `cap_${layer.source.captureId}`;
      if (!sources.some((s) => s.id === sourceId)) sources.push({ id: sourceId, path: item.path });
      const srcDur = item.durationSec;
      if (layer.events?.length) {
        events = layer.events.map((e) => ({ timeSec: e.timeSec, durationSec: e.durationSec, rate: 2 ** ((e.pitchSemitones ?? 0) / 12), gainDb: e.gainDb ?? 0, pan: e.pan }));
      } else if (isVoice) {
        // The user's own voice: as recorded, once per vocal section, never pitch-shifted.
        events = active
          .filter((s) => s.energy >= 0.4 || active.length === 1)
          .map((s) => ({ timeSec: s.startSec ?? 0, durationSec: Math.min(srcDur, (s.endSec ?? 0) - (s.startSec ?? 0)), rate: 1, gainDb: 0, fadeInSec: 0.02, fadeOutSec: 0.25 }));
      } else if (layer.pitch && layer.pitch.mode !== 'fixed' && layer.pitch.mode !== 'hum') {
        const midi = item.features?.pitchHz ? hzToMidi(item.features.pitchHz) : 60;
        events = active.flatMap((s) => pitchedEvents(layer, s, plan, tl, midi, opts.timing));
      } else if (SUSTAINED.includes(layer.role) || !layer.pattern) {
        events = active.map((s) => loopEvent(s, (s.energy - 1) * 6, 0.3));
      } else {
        events = active.flatMap((s) => patternEvents(layer, s, plan.sections[plan.sections.indexOf(s) + 1], tl, plan.style, srcDur, opts.timing));
      }
    } else if (layer.source.kind === 'synth') {
      const inst = layer.source.instrument;
      let stem = stems.get(inst);
      if (!stem) {
        stem = await deps.renderSynthStem(inst, { bpm, bars: 4, key: plan.key, scale: plan.scale, style: plan.style });
        stems.set(inst, stem);
      }
      sourceId = `synth_${inst}`;
      if (!sources.some((s) => s.id === sourceId)) sources.push({ id: sourceId, path: stem.path });
      events = active.map((s) => loopEvent(s, (s.energy - 1) * 5, 0.01));
    } else {
      const tex = deps.renderTexture ? await deps.renderTexture(layer.source.prompt, 10) : null;
      if (!tex) continue;
      sourceId = `tex_${layer.id}`;
      sources.push({ id: sourceId, path: tex.path });
      events = active.map((s) => loopEvent(s, (s.energy - 1) * 6, 0.5));
    }

    layers.push({
      id: layer.id,
      sourceId,
      bus,
      gainDb: layer.gainDb + offset,
      pan: Math.max(-1, Math.min(1, layer.pan * width)),
      effects: (layer.effects ?? []).map((e) => toRenderEffect(e, bpm, reverbScale)),
      events: events.sort((a, b) => a.timeSec - b.timeSec),
    });
  }

  if (opts.production) {
    sources.push({ id: 'ace_production', path: opts.production.path });
    layers.push({
      id: 'ace_production',
      sourceId: 'ace_production',
      bus: 'FX',
      gainDb: -6 + 6 * Math.min(1, Math.max(0, opts.production.amount)),
      pan: 0,
      effects: [],
      events: [{ timeSec: 0, durationSec: Math.min(opts.production.durationSec, plan.durationSec + 1), rate: 1, gainDb: 0, fadeInSec: 0.05, fadeOutSec: 1.5 }],
    });
  }

  const usedBuses = [...new Set(layers.map((l) => l.bus))];
  const buses: RenderBus[] = usedBuses.map((name) => {
    const effects = BUS_EFFECTS[name].map((e) => toRenderEffect(e, bpm, reverbScale));
    // Warmth: gentle saturation where it reads as analogue glue, not distortion.
    if ((name === 'DRUMS' || name === 'BASS') && warmth > 0.2) effects.unshift({ type: 'saturation', drive: 1 + 3 * warmth, mix: 0.3 * warmth });
    // The production pass arrives mixed; it only needs level, not the FX-bus reverb.
    if (name === 'FX' && opts.production && layers.every((l) => l.bus !== 'FX' || l.id === 'ace_production')) effects.length = 0;
    return { name, gainDb: BUS_GAIN[name], effects };
  });

  return {
    version: RENDER_GRAPH_VERSION,
    sampleRate,
    durationSec: +(plan.durationSec + 1.5).toFixed(3),
    sources,
    layers,
    buses,
    master: {
      gainDb: plan.mix.masterGainDb ?? 0,
      glue: { type: 'compressor', thresholdDb: -14, ratio: 2, attackMs: 10, releaseMs: 150, makeupDb: 1.5 },
      limiterCeilingDb: -1,
      fadeOutSec: 2,
    },
  };
}
