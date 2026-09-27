import type { AccompanimentLayer, Style } from '@/types';
import {
  buildArp,
  buildBassline,
  buildChordVoicing,
  buildPercPattern,
  isMinorStyle,
  progressionFor,
  semitoneToFreq,
  type NoteEvent,
} from './harmony';
import { mixInto, renderKick, renderNoisePerc, renderNote } from './instruments';

/**
 * Procedural accompaniment. HLD v2 §4: the AI plans, the engine performs —
 * so bass, chords and pads are synthesised here as PCM and loaded into the
 * native sample slots like any other sound. No raw-audio model on the phone.
 *
 * This is a full rewrite of the original, which used bare sine waves on a
 * static root note per bar. That sounded synthetic and did not move. Now:
 * real harmonic timbres from instruments.ts, real chord progressions from
 * harmony.ts, basslines that walk, voicings that lead smoothly between bars,
 * and a fill on the last bar so a loop has shape.
 *
 * Rendered once per arrangement change and then re-triggered, so the per-tap
 * cost stays identical to a captured object sound.
 */

const NOTE_OFFSETS: Record<string, number> = {
  C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5,
  'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11,
};

/** Parses "C minor" / "F# major" into a root pitch class and quality. */
export function parseKey(key: string | null): { root: number; minor: boolean } {
  if (!key) return { root: 0, minor: true };
  const m = key.match(/^([A-G]#?)\s*(minor|major)?/i);
  if (!m) return { root: 0, minor: true };
  return {
    root: NOTE_OFFSETS[m[1].toUpperCase()] ?? 0,
    minor: (m[2] ?? '').toLowerCase() !== 'major',
  };
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export interface RenderOptions {
  sampleRate: number;
  bpm: number;
  bars: number;
  key: string | null;
  style: Style;
  /**
   * Where in the chord cycle this passage starts.
   *
   * Left at zero the progression begins where it always does. A section that
   * wants to feel like an answer rather than a restatement passes a rotation,
   * and gets the same chords arriving in a different order.
   */
  rotation?: number;
}

/** Octave placement per layer, so parts occupy their own register. */
const OCTAVES: Record<string, number> = {
  bass: -2,
  chords: 0,
  pad: 0,
  arp: 1,
  guitar: 0,
};

function renderEvents(
  events: NoteEvent[],
  opts: RenderOptions,
  timbre: 'bass' | 'keys' | 'pad' | 'pluck',
  octave: number,
  gain: number,
): number[] {
  const { sampleRate, bpm, bars } = opts;
  const { root } = parseKey(opts.key);
  const secondsPerBeat = 60 / bpm;
  const total = Math.floor(secondsPerBeat * 4 * bars * sampleRate);
  const out = new Array<number>(total).fill(0);

  for (const ev of events) {
    const freq = semitoneToFreq(ev.semitone, root, octave);
    // Guard against anything inaudible or aliasing.
    if (freq < 25 || freq > sampleRate / 2.2) continue;

    const note = renderNote({
      freq,
      duration: ev.duration * secondsPerBeat,
      sampleRate,
      velocity: ev.velocity,
      timbre,
    });

    mixInto(out, note, Math.floor(ev.beat * secondsPerBeat * sampleRate), gain);
  }

  return out;
}

/** Bass: walks the progression rather than holding a root. */
export function renderBass(opts: RenderOptions): number[] {
  const chords = progressionFor(opts.style, opts.bars, opts.rotation ?? 0);
  const events = buildBassline(chords, opts.style);
  return renderEvents(events, opts, 'bass', OCTAVES.bass, 0.85);
}

/** Chords: voiced with smooth leading between bars. */
export function renderChords(opts: RenderOptions, pad = false): number[] {
  const chords = progressionFor(opts.style, opts.bars, opts.rotation ?? 0);
  const events = buildChordVoicing(chords, opts.style);
  return renderEvents(events, opts, pad ? 'pad' : 'keys', OCTAVES.chords, pad ? 0.5 : 0.62);
}

/** Arpeggio: constant movement over the progression. */
export function renderArp(opts: RenderOptions): number[] {
  const chords = progressionFor(opts.style, opts.bars, opts.rotation ?? 0);
  const events = buildArp(chords, opts.style);
  return renderEvents(events, opts, 'pluck', OCTAVES.arp, 0.5);
}

/** Guitar-style: plucked chord stabs. */
export function renderGuitar(opts: RenderOptions): number[] {
  const chords = progressionFor(opts.style, opts.bars, opts.rotation ?? 0);
  const events = buildChordVoicing(chords, opts.style);

  const { sampleRate, bpm, bars } = opts;
  const { root } = parseKey(opts.key);
  const secondsPerBeat = 60 / bpm;
  const total = Math.floor(secondsPerBeat * 4 * bars * sampleRate);
  const out = new Array<number>(total).fill(0);

  // Group simultaneous notes so a chord can be strummed rather than struck.
  const byBeat = new Map<number, NoteEvent[]>();
  for (const ev of events) {
    const list = byBeat.get(ev.beat) ?? [];
    list.push(ev);
    byBeat.set(ev.beat, list);
  }

  for (const [beat, group] of byBeat) {
    group.forEach((ev, idx) => {
      const freq = semitoneToFreq(ev.semitone, root, OCTAVES.guitar);
      if (freq < 60 || freq > sampleRate / 2.2) return;

      const note = renderNote({
        freq,
        duration: ev.duration * secondsPerBeat,
        sampleRate,
        velocity: ev.velocity,
        timbre: 'pluck',
      });

      // Strum: each string enters ~7 ms after the last.
      const strum = idx * 0.007 * sampleRate;
      mixInto(out, note, Math.floor(beat * secondsPerBeat * sampleRate + strum), 0.55);
    });
  }

  return out;
}

/**
 * A percussion layer that fills the gaps between captured object hits.
 *
 * This is what stops a sparse capture sounding empty: two recorded objects
 * cannot carry a groove on their own, and a shaker pattern underneath gives
 * the loop a pulse without competing with the real sounds.
 */
export function renderPercussion(opts: RenderOptions): number[] {
  const { sampleRate, bpm, bars, style } = opts;
  const secondsPerBeat = 60 / bpm;
  const total = Math.floor(secondsPerBeat * 4 * bars * sampleRate);
  const out = new Array<number>(total).fill(0);

  const events = buildPercPattern(style, bars);
  const brightness = style === 'edm' ? 0.85 : style === 'lofi' ? 0.45 : 0.7;

  for (const ev of events) {
    const hit = renderNoisePerc(sampleRate, ev.duration, brightness, ev.velocity);
    mixInto(out, hit, Math.floor(ev.beat * secondsPerBeat * sampleRate), 0.35);
  }

  // Styles built on a four-on-the-floor need low end the room rarely provides.
  if (style === 'edm' || style === 'rock') {
    for (let bar = 0; bar < bars; bar++) {
      const beats = style === 'edm' ? [0, 1, 2, 3] : [0, 2];
      for (const b of beats) {
        const kick = renderKick(sampleRate, 0.26, 0.8);
        mixInto(out, kick, Math.floor((bar * 4 + b) * secondsPerBeat * sampleRate), 0.5);
      }
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
    case 'perc':
      return renderPercussion(opts);
  }
}

export { isMinorStyle, progressionFor };
