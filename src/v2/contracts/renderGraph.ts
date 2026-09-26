/**
 * RenderGraph v1 — what the TypeScript plan compiler hands the native offline
 * renderer (modules/worldjam-media `renderMix`). Everything is resolved to
 * absolute seconds, files and linear parameters: the renderer makes no musical
 * decisions, it only executes this graph sample-accurately.
 *
 * Serialised as JSON; keep it flat and explicit.
 */

import type { BusName } from './musicPlan';

export const RENDER_GRAPH_VERSION = 1;

/** An audio file the renderer may read. WAV (PCM16 or float32), mono or stereo, any sample rate. */
export interface RenderSource {
  id: string;
  /** Absolute filesystem path (no file:// prefix). */
  path: string;
  /** Region of the file to use, seconds. Defaults: whole file. */
  trimStartSec?: number;
  trimEndSec?: number;
  /** Static gain applied when the source is read (e.g. loudness normalisation). */
  gainDb?: number;
}

export type RenderEffect =
  | { type: 'lowpass' | 'highpass'; cutoffHz: number; q: number }
  | { type: 'peak'; freqHz: number; gainDb: number; q: number }
  | { type: 'delay'; timeSec: number; feedback: number; mix: number }
  /** Freeverb-style: roomSize/damping/mix all 0..1. */
  | { type: 'reverb'; roomSize: number; damping: number; mix: number }
  /** tanh soft clip; drive 1..10, mix 0..1. */
  | { type: 'saturation'; drive: number; mix: number }
  | {
      type: 'compressor';
      thresholdDb: number;
      ratio: number;
      attackMs: number;
      releaseMs: number;
      makeupDb: number;
    };

/** One hit of a source. */
export interface RenderEvent {
  timeSec: number;
  /**
   * How long the hit may sound. Omitted: the whole (trimmed) source.
   * When `loop` is true the source repeats until durationSec.
   */
  durationSec?: number;
  /** Playback-rate pitch shift: rate = 2^(semitones/12). 1 = as recorded. */
  rate: number;
  gainDb: number;
  /** Optional per-event pan override, -1..1. */
  pan?: number;
  loop?: boolean;
  /** Short fades avoid clicks; defaults 0.002 in / 0.01 out. */
  fadeInSec?: number;
  fadeOutSec?: number;
}

/** Piecewise-linear gain automation for a layer (dB at time). */
export interface GainPoint {
  timeSec: number;
  gainDb: number;
}

export interface RenderLayer {
  id: string;
  sourceId: string;
  bus: BusName;
  gainDb: number;
  /** -1..1, constant-power. */
  pan: number;
  effects: RenderEffect[];
  automation?: GainPoint[];
  events: RenderEvent[];
}

export interface RenderBus {
  name: BusName;
  gainDb: number;
  effects: RenderEffect[];
}

export interface RenderMaster {
  gainDb: number;
  /** Glue compressor on the master; omitted = none. */
  glue?: Extract<RenderEffect, { type: 'compressor' }>;
  /** Brick-wall limiter ceiling, dBFS. Must be <= -1. */
  limiterCeilingDb: number;
  /** Fade the last N seconds to silence. */
  fadeOutSec?: number;
}

export interface RenderGraph {
  version: typeof RENDER_GRAPH_VERSION;
  sampleRate: number;
  /** Output length in seconds (includes any tail). */
  durationSec: number;
  sources: RenderSource[];
  layers: RenderLayer[];
  buses: RenderBus[];
  master: RenderMaster;
}

/** What `renderMix` returns. */
export interface RenderResult {
  path: string;
  durationSec: number;
  peakDb: number;
  rmsDb: number;
  renderMs: number;
  /** Normalised 0..1 peak envelope for the waveform UI (length = requested buckets). */
  peaks: number[];
}
