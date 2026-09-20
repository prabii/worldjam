import type { AccompanimentLayer, Style } from '@/types';

/**
 * Procedural accompaniment. HLD v2 §4: the AI plans, the engine performs —
 * so bass, chords and pads are synthesised here as PCM and loaded into the
 * native sample slots like any other sound. No raw-audio model on the phone.
 *
 * These are rendered once per arrangement change and then just re-triggered,
 * which keeps the per-tap cost identical to a captured object sound.
 */

const NOTE_OFFSETS: Record<string, number> = {
  C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5,
  'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11,
};

/** Parses "C minor" / "F# major" into a root pitch class and quality. */
export function parseKey(key: string | null): { root: number; minor: boolean } {
  if (!key) return { root: 0, minor: false };
  const m = key.match(/^([A-G]#?)\s*(minor|major)?/i);
  if (!m) return { root: 0, minor: false };
  return {
    root: NOTE_OFFSETS[m[1].toUpperCase()] ?? 0,
    minor: (m[2] ?? '').toLowerCase() === 'minor',
  };
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Chord degrees per style, as semitone offsets from the key root. */
const PROGRESSIONS: Record<Style, number[]> = {
  // i - VI - III - VII: the standard emotive minor loop.
  chill: [0, 5, 7, 5],
  jazz: [0, 5, 7, 10],
  lofi: [0, 9, 5, 7],
  cinematic: [0, 8, 5, 3],
  edm: [0, 7, 9, 5],
  rock: [0, 7, 5, 5],
};

function chordTones(root: number, minor: boolean): number[] {
  return minor ? [0, 3, 7, 10] : [0, 4, 7, 11];
}

interface RenderOptions {
  sampleRate: number;
  bpm: number;
  bars: number;
  key: string | null;
  style: Style;
}

/** ADSR envelope value at a normalised position within a note. */
function envelope(t: number, dur: number, attack: number, release: number): number {
  if (t < attack) return t / attack;
  if (t > dur - release) return Math.max(0, (dur - t) / release);
  return 1;
}

/**
 * Renders a bass line: root notes following the progression, one per bar,
 * with a slight pluck envelope so it sits under the real sounds instead of
 * masking them.
 */
export function renderBass(opts: RenderOptions): number[] {
  const { sampleRate, bpm, bars, style } = opts;
  const { root, minor } = parseKey(opts.key);
  const secondsPerBeat = 60 / bpm;
  const total = Math.floor(secondsPerBeat * 4 * bars * sampleRate);
  const out = new Array<number>(total).fill(0);

  const prog = PROGRESSIONS[style];
  const noteDur = secondsPerBeat * 4;

  for (let bar = 0; bar < bars; bar++) {
    const degree = prog[bar % prog.length];
    // Bass sits around MIDI 36-48; the +36 puts the root in that octave.
    const midi = 36 + ((root + degree) % 12);
    const hz = midiToHz(midi);
    const start = Math.floor(bar * noteDur * sampleRate);
    const len = Math.floor(noteDur * sampleRate);

    for (let i = 0; i < len && start + i < total; i++) {
      const t = i / sampleRate;
      const env = envelope(t, noteDur, 0.01, 0.15);
      // A touch of second harmonic gives it presence on a phone speaker,
      // which reproduces almost nothing below 200 Hz.
      const s =
        Math.sin(2 * Math.PI * hz * t) * 0.6 +
        Math.sin(2 * Math.PI * hz * 2 * t) * 0.25 +
        Math.sin(2 * Math.PI * hz * 3 * t) * 0.1;
      out[start + i] += s * env * 0.5;
    }
  }
  return out;
}

/** Renders sustained chords (or a pad, with a slower attack). */
export function renderChords(opts: RenderOptions, pad = false): number[] {
  const { sampleRate, bpm, bars, style } = opts;
  const { root, minor } = parseKey(opts.key);
  const secondsPerBeat = 60 / bpm;
  const total = Math.floor(secondsPerBeat * 4 * bars * sampleRate);
  const out = new Array<number>(total).fill(0);

  const prog = PROGRESSIONS[style];
  const noteDur = secondsPerBeat * 4;
  const tones = chordTones(root, minor);

  for (let bar = 0; bar < bars; bar++) {
    const degree = prog[bar % prog.length];
    const start = Math.floor(bar * noteDur * sampleRate);
    const len = Math.floor(noteDur * sampleRate);

    for (const tone of tones) {
      const midi = 60 + ((root + degree + tone) % 12);
      const hz = midiToHz(midi);
      // Detuning each voice slightly stops the chord sounding like an organ.
      const detune = 1 + (Math.random() - 0.5) * 0.002;

      for (let i = 0; i < len && start + i < total; i++) {
        const t = i / sampleRate;
        const env = envelope(t, noteDur, pad ? 0.4 : 0.02, pad ? 0.6 : 0.2);
        const s = Math.sin(2 * Math.PI * hz * detune * t);
        out[start + i] += s * env * (pad ? 0.08 : 0.12);
      }
    }
  }
  return out;
}

/** Renders an arpeggio: chord tones cycled on eighth notes. */
export function renderArp(opts: RenderOptions): number[] {
  const { sampleRate, bpm, bars, style } = opts;
  const { root, minor } = parseKey(opts.key);
  const secondsPerBeat = 60 / bpm;
  const total = Math.floor(secondsPerBeat * 4 * bars * sampleRate);
  const out = new Array<number>(total).fill(0);

  const prog = PROGRESSIONS[style];
  const tones = chordTones(root, minor);
  const stepDur = secondsPerBeat / 2;
  const steps = Math.floor((secondsPerBeat * 4 * bars) / stepDur);

  for (let step = 0; step < steps; step++) {
    const bar = Math.floor((step * stepDur) / (secondsPerBeat * 4));
    const degree = prog[bar % prog.length];
    const tone = tones[step % tones.length];
    const midi = 72 + ((root + degree + tone) % 12);
    const hz = midiToHz(midi);

    const start = Math.floor(step * stepDur * sampleRate);
    const len = Math.floor(stepDur * 0.8 * sampleRate);
    for (let i = 0; i < len && start + i < total; i++) {
      const t = i / sampleRate;
      const env = envelope(t, stepDur * 0.8, 0.005, 0.05);
      // Triangle-ish tone: softer than a saw, more present than a sine.
      const s = Math.sin(2 * Math.PI * hz * t) + 0.15 * Math.sin(2 * Math.PI * hz * 3 * t);
      out[start + i] += s * env * 0.09;
    }
  }
  return out;
}

/** Renders a muted guitar-style chord stab on the offbeats. */
export function renderGuitar(opts: RenderOptions): number[] {
  const { sampleRate, bpm, bars, style } = opts;
  const { root, minor } = parseKey(opts.key);
  const secondsPerBeat = 60 / bpm;
  const total = Math.floor(secondsPerBeat * 4 * bars * sampleRate);
  const out = new Array<number>(total).fill(0);

  const prog = PROGRESSIONS[style];
  const tones = chordTones(root, minor);
  const stabDur = secondsPerBeat * 0.3;

  for (let bar = 0; bar < bars; bar++) {
    const degree = prog[bar % prog.length];
    for (const beat of [1.5, 2.5, 3.5, 4.5]) {
      const startSec = (bar * 4 + beat - 1) * secondsPerBeat;
      const start = Math.floor(startSec * sampleRate);
      const len = Math.floor(stabDur * sampleRate);

      tones.forEach((tone, idx) => {
        const midi = 55 + ((root + degree + tone) % 12) + (idx > 2 ? 12 : 0);
        const hz = midiToHz(midi);
        // Strum offset: voices enter a few ms apart, not all at once.
        const offset = Math.floor(idx * 0.004 * sampleRate);
        for (let i = 0; i < len && start + offset + i < total; i++) {
          const t = i / sampleRate;
          const env = envelope(t, stabDur, 0.003, stabDur * 0.6);
          const s =
            Math.sin(2 * Math.PI * hz * t) * 0.5 +
            Math.sin(2 * Math.PI * hz * 2 * t) * 0.3 +
            Math.sin(2 * Math.PI * hz * 3 * t) * 0.2;
          out[start + offset + i] += s * env * 0.07;
        }
      });
    }
  }
  return out;
}

export function renderLayer(layer: AccompanimentLayer, opts: RenderOptions): number[] {
  switch (layer) {
    case 'bass':
      return renderBass(opts);
    case 'chords':
      return renderChords(opts, false);
    case 'pad':
      return renderChords(opts, true);
    case 'arp':
      return renderArp(opts);
    case 'guitar':
      return renderGuitar(opts);
  }
}

export type { RenderOptions };
