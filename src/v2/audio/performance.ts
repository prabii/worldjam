import { quantizeBeat, timingAccuracy, type Grid } from '@/dsp/quantize';

import type { PadSettings, PerformanceEvent, StudioSource } from '../contracts/library';
import type { LayerRole, MusicPlan, PlanLayer, StyleId } from '../contracts/musicPlan';
import { RENDER_GRAPH_VERSION, type RenderEvent, type RenderGraph, type RenderLayer, type RenderSource } from '../contracts/renderGraph';
import { ROLE_BUS } from '../ai/kb/rules';
import { formFor, styleSpec } from '../ai/kb/styles';
import type { InventoryItem } from './planCompiler';

export interface QuantizeSettings {
  /** Subdivisions per beat: 1 = quarters, 2 = eighths, 4 = sixteenths. 0 = off. */
  grid: 0 | 1 | 2 | 4;
  /** 0..1 — how hard hits are pulled onto the grid (keeps some feel below 1). */
  strength: number;
  /** 0..1 — delays every second subdivision. */
  swing: number;
}

export const DEFAULT_QUANTIZE: QuantizeSettings = { grid: 4, strength: 0.85, swing: 0 };

/**
 * Latency compensation + quantize (V1 dsp/quantize), then the timing score.
 * Latency: what the user heard was `latencyMs` late, so they played late by
 * the same amount — pull every hit earlier before snapping.
 */
export function quantizePerformance(
  events: PerformanceEvent[],
  bpm: number,
  q: QuantizeSettings,
  latencyMs = 0,
): { events: PerformanceEvent[]; accuracy: number } {
  const msPerBeat = 60000 / bpm;
  const shifted = events.map((e) => ({ ...e, timeMs: Math.max(0, e.timeMs - latencyMs) }));
  const grid = (q.grid || 4) as Grid;
  const accuracy = timingAccuracy(
    shifted.filter((e) => !e.stop).map((e) => ({ objectId: String(e.padIndex), beat: e.timeMs / msPerBeat, velocity: e.velocity })),
    grid,
  );
  if (!q.grid) return { events: shifted, accuracy };
  const out = shifted.map((e) => {
    if (e.stop) return e;
    const beat = quantizeBeat(e.timeMs / msPerBeat, { grid, strength: q.strength, tolerance: 0.5, swing: q.swing });
    return { ...e, timeMs: Math.max(0, beat * msPerBeat) };
  });
  return { events: out.sort((a, b) => a.timeMs - b.timeMs), accuracy };
}

const velocityDb = (v: number) => 20 * Math.log10(Math.max(0.05, Math.min(1.5, v)));

/**
 * Renders a manual performance exactly as played: one layer per pad, honouring
 * each pad's gain, pan, pitch, trim, loop and mute.
 */
export function performanceToGraph(
  performance: PerformanceEvent[],
  sources: StudioSource[],
  inventory: Record<string, InventoryItem>,
  opts: { lengthMs: number; sampleRate?: number; tailSec?: number },
): RenderGraph {
  const renderSources: RenderSource[] = [];
  const layers: RenderLayer[] = [];
  const endSec = opts.lengthMs / 1000;
  for (const src of sources) {
    const s: PadSettings = src.settings;
    const item = inventory[src.captureId];
    if (!item || s.muted) continue;
    const hits = performance.filter((e) => e.padIndex === src.padIndex);
    if (hits.length === 0) continue;
    const sourceId = `pad${src.padIndex}`;
    renderSources.push({
      id: sourceId,
      path: item.path,
      trimStartSec: s.trimStartMs / 1000,
      trimEndSec: s.trimEndMs != null ? s.trimEndMs / 1000 : undefined,
    });
    const rate = 2 ** (s.pitchSemitones / 12);
    const events: RenderEvent[] = [];
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      if (h.stop) continue;
      if (s.loop) {
        // A looping pad plays until its stop (or the next retrigger, or the end).
        const until = hits[i + 1];
        const stopAt = until ? until.timeMs / 1000 : endSec;
        events.push({ timeSec: h.timeMs / 1000, durationSec: Math.max(0.05, stopAt - h.timeMs / 1000), rate, gainDb: velocityDb(h.velocity), loop: true, fadeOutSec: 0.03 });
      } else {
        events.push({ timeSec: h.timeMs / 1000, rate, gainDb: velocityDb(h.velocity) });
      }
    }
    layers.push({ id: sourceId, sourceId, bus: 'DRUMS', gainDb: s.gainDb, pan: s.pan, effects: [], events });
  }
  return {
    version: RENDER_GRAPH_VERSION,
    sampleRate: opts.sampleRate ?? 48000,
    durationSec: Math.max(1, endSec + (opts.tailSec ?? 1.5)),
    sources: renderSources,
    layers,
    buses: [{ name: 'DRUMS', gainDb: -1, effects: [{ type: 'compressor', thresholdDb: -16, ratio: 2.5, attackMs: 6, releaseMs: 120, makeupDb: 2 }] }],
    master: { gainDb: 0, limiterCeilingDb: -1, fadeOutSec: 0.5 },
  };
}

/**
 * A manual performance as a MusicPlan, so "Enhance with AI" can patch it: the
 * hits are folded onto a one-bar 16-step pattern per pad (a step played in at
 * least a third of the bars counts), then repeated across the style's form.
 */
export function performanceToPlan(
  performance: PerformanceEvent[],
  sources: StudioSource[],
  roles: Record<string, LayerRole>,
  opts: { bpm: number; lengthMs: number; style: StyleId; durationSec?: number },
): MusicPlan {
  const spec = styleSpec(opts.style);
  const msPerStep = 15000 / opts.bpm;
  const bars = Math.max(1, Math.ceil(opts.lengthMs / (msPerStep * 16)));
  const layers: PlanLayer[] = [];
  for (const src of sources) {
    if (src.settings.muted) continue;
    const hits = performance.filter((e) => e.padIndex === src.padIndex && !e.stop);
    if (hits.length === 0) continue;
    const counts = new Array<number>(16).fill(0);
    for (const h of hits) counts[Math.round(h.timeMs / msPerStep) % 16]++;
    const threshold = Math.max(1, Math.ceil(bars / 3));
    const pattern = counts.map((n, i) => (n >= threshold ? (i % 4 === 0 ? 'X' : 'x') : '.')).join('');
    const role = roles[src.captureId] ?? 'percussion';
    layers.push({
      id: `pad${src.padIndex}`,
      source: { kind: 'capture', captureId: src.captureId },
      role,
      bus: ROLE_BUS[role],
      gainDb: src.settings.gainDb,
      pan: src.settings.pan,
      pattern: /[Xx]/.test(pattern) ? pattern : 'X...............',
      pitch: src.settings.pitchSemitones ? { mode: 'fixed', semitones: src.settings.pitchSemitones } : undefined,
    });
  }
  const durationSec = Math.max(10, opts.durationSec ?? 30);
  const totalBars = Math.max(4, Math.round((durationSec * opts.bpm) / 240));
  const sections = formFor(spec, totalBars).map((f, i) => ({ id: `${f.kind}${i + 1}`, kind: f.kind, bars: f.bars, energy: f.energy, layers: layers.map((l) => l.id) }));
  return {
    schemaVersion: '1.0',
    title: 'My jam',
    style: opts.style,
    tempoBpm: opts.bpm,
    timeSignature: '4/4',
    key: 'A',
    scale: spec.scale,
    durationSec,
    sections,
    layers,
    mix: { ...spec.mix },
    lyrics: null,
    caption: `${spec.caption}, ${opts.bpm} bpm, instrumental`,
  };
}
