/**
 * MusicPlan v1.0 — the contract between the local LLM (planner) and the
 * deterministic compiler/renderer. Mirrors 05_LLM_KNOWLEDGE_AND_PROMPTS.md
 * (schemaVersion, title, style, tempoBpm, timeSignature, key, scale,
 * durationSec, sections, layers, mix, lyrics) with one extension: a layer may
 * carry a compact `pattern` instead of hundreds of explicit events, which
 * keeps model output short enough to generate quickly on a phone.
 *
 * Nothing in a plan is ever executed; the validator checks every field and
 * the compiler turns it into a RenderGraph.
 */

export const MUSIC_PLAN_SCHEMA_VERSION = '1.0';

/** Styles the knowledge base knows how to produce (04_MUSIC_KNOWLEDGE_BASE.md). */
export type StyleId =
  | 'pop'
  | 'rock'
  | 'edm'
  | 'jazz'
  | 'lofi'
  | 'chill'
  | 'ambient'
  | 'hiphop'
  | 'trap'
  | 'house'
  | 'dnb'
  | 'cinematic'
  | 'acoustic';

export const STYLE_IDS: StyleId[] = [
  'pop', 'rock', 'edm', 'jazz', 'lofi', 'chill', 'ambient',
  'hiphop', 'trap', 'house', 'dnb', 'cinematic', 'acoustic',
];

export type NoteName = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';
export type ScaleId = 'major' | 'minor' | 'dorian' | 'mixolydian' | 'pentatonic_minor' | 'pentatonic_major';

export type SectionKind =
  | 'intro' | 'verse' | 'build' | 'chorus' | 'drop' | 'bridge' | 'breakdown' | 'outro';

/** Musical job of a layer. */
export type LayerRole =
  | 'kick' | 'snare' | 'hat' | 'percussion'
  | 'bass' | 'chords' | 'pad' | 'lead' | 'vocal' | 'texture' | 'fx';

/** Mix buses from the knowledge base. */
export type BusName = 'DRUMS' | 'BASS' | 'HARMONY' | 'MELODY' | 'TEXTURE' | 'VOCAL' | 'FX';

export type SynthInstrument = 'bass' | 'chords' | 'pad' | 'arp' | 'guitar';

/** Where a layer's sound comes from. Captures are the identity of every track. */
export type LayerSource =
  | { kind: 'capture'; captureId: string }
  | { kind: 'synth'; instrument: SynthInstrument }
  /** Optional Stable Audio Open Small texture, described in words. */
  | { kind: 'texture'; prompt: string };

/**
 * How a layer is pitched.
 * - fixed: every hit at `semitones` (default 0 = as recorded)
 * - bass/chords/melody: the compiler plays the capture as an instrument,
 *   following the harmony engine's progression for that part
 * - hum: follow the melody extracted from a hummed/sung capture
 */
export type LayerPitch =
  | { mode: 'fixed'; semitones: number }
  | { mode: 'bass' | 'chords' | 'melody' }
  | { mode: 'hum'; captureId: string };

export type PlanEffect =
  | { type: 'lowpass' | 'highpass'; cutoffHz: number; q?: number }
  | { type: 'eq'; freqHz: number; gainDb: number; q?: number }
  | { type: 'delay'; beats: number; feedback: number; mix: number }
  | { type: 'reverb'; size: number; mix: number }
  | { type: 'saturation'; drive: number; mix?: number }
  | { type: 'compressor'; amount: number };

/** Explicit event, as in the doc contract. Times are seconds from track start. */
export interface PlanEvent {
  type: 'trigger';
  timeSec: number;
  durationSec?: number;
  pitchSemitones?: number;
  gainDb?: number;
  pan?: number;
}

export interface PlanSection {
  id: string;
  kind: SectionKind;
  /** Length in bars (4/4). The validator derives startSec/endSec from bars + tempo. */
  bars: number;
  /** 0..1 — drives density thinning and automation. */
  energy: number;
  /** Ids of layers that play in this section. */
  layers: string[];
  startSec?: number;
  endSec?: number;
}

export interface PlanLayer {
  id: string;
  source: LayerSource;
  role: LayerRole;
  bus?: BusName;
  /** Layer level, dB, clamped to [-30, +6]. */
  gainDb: number;
  /** -1 (left) .. +1 (right). */
  pan: number;
  /**
   * One bar of 16 sixteenth-note steps: 'X' accent, 'x' hit, '-' hold,
   * '.' rest. Or `groove:<id>` naming a knowledge-base groove.
   * Omitted for sustained layers (pad/texture/vocal), which play through.
   */
  pattern?: string;
  pitch?: LayerPitch;
  effects?: PlanEffect[];
  /** Doc-style explicit events; used instead of `pattern` when present. */
  events?: PlanEvent[];
}

export interface PlanMix {
  /** Overall space, 0..1. */
  reverb?: number;
  /** Stereo width, 0..1. */
  width?: number;
  /** Warmth/saturation on the master, 0..1. */
  warmth?: number;
  masterGainDb?: number;
}

export interface PlanLyricsSection {
  type: 'verse' | 'chorus' | 'pre-chorus' | 'bridge' | 'intro' | 'outro' | 'hook';
  lines: string[];
}

export interface PlanLyrics {
  title: string;
  language: string;
  theme: string;
  sections: PlanLyricsSection[];
}

export interface MusicPlan {
  schemaVersion: typeof MUSIC_PLAN_SCHEMA_VERSION;
  title: string;
  style: StyleId;
  mood?: string;
  tempoBpm: number;
  timeSignature: '4/4';
  key: NoteName;
  scale: ScaleId;
  durationSec: number;
  sections: PlanSection[];
  layers: PlanLayer[];
  mix: PlanMix;
  lyrics: PlanLyrics | null;
}

/** Patch operations for small edits (doc: "Prefer patches for small changes"). */
export type PatchOp =
  | { type: 'add_layer'; layer: PlanLayer; sections?: string[] }
  | { type: 'remove_layer'; layerId: string }
  | { type: 'set_gain'; layerId: string; gainDb: number }
  | { type: 'set_pan'; layerId: string; pan: number }
  | { type: 'set_role'; layerId: string; role: LayerRole }
  | { type: 'set_pattern'; layerId: string; pattern: string }
  | { type: 'add_effect'; layerId: string; effect: PlanEffect }
  | { type: 'change_tempo'; tempoBpm: number }
  | { type: 'change_section_energy'; sectionId: string; energy: number }
  | { type: 'change_style'; style: StyleId }
  | { type: 'rewrite_lyrics'; lyrics: PlanLyrics };

export interface PlanPatch {
  operations: PatchOp[];
  /** One short sentence for the UI: what changed. */
  summary?: string;
}

/** Bounds shared by validator, patcher and UI. */
export const PLAN_LIMITS = {
  tempoMin: 60,
  tempoMax: 180,
  durationMin: 30,
  durationMax: 90,
  gainMin: -30,
  gainMax: 6,
  maxLayers: 16,
  maxSections: 10,
  stepsPerBar: 16,
} as const;
