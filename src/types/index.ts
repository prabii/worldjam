/**
 * Domain model, following the WorldJamObject / WorldJamSession shapes in
 * HLD v2 §5.
 */

export type MusicalRole = 'kick' | 'snare' | 'hat' | 'perc' | 'bass' | 'lead' | 'texture';

export type ObjectCategory =
  | 'cup'
  | 'table'
  | 'bottle'
  | 'keys'
  | 'glass'
  | 'box'
  | 'book'
  | 'phone'
  | 'unknown';

/** Lightweight DSP descriptors computed locally from a captured sample. */
export interface AudioFeatures {
  /** Seconds of audio retained after trimming. */
  duration: number;
  /** RMS level, 0..1. */
  energy: number;
  /** Spectral centroid in Hz — the main cue for bright vs. dark sounds. */
  brightness: number;
  /** Time from onset to -20 dB, in seconds. Short = percussive. */
  decay: number;
  /** Dominant frequency in Hz, or null when the sound is unpitched. */
  pitch: number | null;
  /** 0..1 — how tonal versus noisy the sound is. */
  tonality: number;
}

export interface WorldJamObject {
  id: string;
  label: string;
  category: ObjectCategory;
  /** Index into the native engine's sample slots. */
  slot: number;
  /** Where the card sits on screen, normalized 0..1. Doubles as AR anchor. */
  position: { x: number; y: number };
  features: AudioFeatures | null;
  /** Assigned by the AI from the sound's own character. */
  role: MusicalRole;
  /** Beats within the bar this object plays on, 1-indexed. */
  beatPattern: number[];
  volume: number;
  /** 0 = left, 1 = right. Derived from screen position for spatial spread. */
  pan: number;
  color: string;
  createdAt: number;
}

/** One recorded hit in a loop, stored as a position on the beat grid. */
export interface LoopEvent {
  objectId: string;
  /** Position in beats from the start of the loop, fractional. */
  beat: number;
  velocity: number;
}

export interface Loop {
  id: string;
  name: string;
  events: LoopEvent[];
  bars: number;
  muted: boolean;
  createdAt: number;
}

export interface VocalTake {
  id: string;
  /** Slot holding the raw voice recording — the voice is always preserved. */
  slot: number;
  duration: number;
  /** Extracted melody, for the AI to key/harmonise against. */
  notes: NoteEvent[];
  detectedKey: string | null;
  muted: boolean;
}

export interface NoteEvent {
  /** MIDI note number. */
  midi: number;
  /** Start time in seconds from the take's beginning. */
  time: number;
  duration: number;
  confidence: number;
}

export type Style = 'natural' | 'jazz' | 'lofi' | 'cinematic' | 'electronic' | 'rock';

/** The strict JSON contract from HLD v2 §4. Validated before it reaches audio. */
export interface ArrangementPlan {
  bpm: number;
  bars: number;
  objectPattern: Array<{ object: string; beats: number[] }>;
  voiceRole: 'lead' | 'harmony' | 'texture' | 'none';
  accompaniment: AccompanimentLayer[];
  style: Style;
  /** Present when the plan came from the rule-based fallback, not the model. */
  source: 'gemma' | 'fallback';
  reasoning?: string;
}

export type AccompanimentLayer = 'bass' | 'chords' | 'pad' | 'arp' | 'guitar';

export interface WorldJamSession {
  bpm: number;
  timeSignature: [number, number];
  key: string;
  objects: WorldJamObject[];
  loops: Loop[];
  vocalTake: VocalTake | null;
  plan: ArrangementPlan | null;
  style: Style;
  createdAt: number;
}

/** Result of the go/no-go latency spike in HLD v2 §0. */
export interface LatencyReport {
  /** Round-trip latency reported by the audio stream. */
  streamLatencyMs: number;
  /** Measured JS-dispatch-to-native-trigger time. */
  dispatchMs: number;
  sampleRate: number;
  bufferFrames: number;
  nativeAvailable: boolean;
  /** The verdict the HLD hangs everything on. */
  passes: boolean;
}
