import type { Style } from '@/types';

/**
 * Music theory for the accompaniment.
 *
 * The old arranger held one chord per bar and played its root on every beat,
 * which is why the backing felt static — real accompaniment moves through a
 * progression, the bass walks between chord tones, and something changes
 * between bars.
 *
 * Everything here is deterministic given a seed, so a rehearsed demo repeats
 * exactly. That matters more than novelty when you are performing.
 */

export interface Chord {
  /** Semitone offsets from the key root. */
  tones: number[];
  /** Root of the chord, in semitones from the key root. */
  root: number;
  /** Display name, e.g. "i", "VI". */
  degree: string;
}

/** Scale degrees as semitone offsets. */
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

/** Chord qualities as semitone stacks from the chord root. */
const TRIAD_MINOR = [0, 3, 7];
const TRIAD_MAJOR = [0, 4, 7];
const SEVENTH_MINOR = [0, 3, 7, 10];
const SEVENTH_MAJOR = [0, 4, 7, 11];
const SEVENTH_DOM = [0, 4, 7, 10];

/**
 * Progressions per style, as scale degrees (1-indexed).
 *
 * These are the progressions the styles are actually built on, not arbitrary
 * intervals: i-VI-III-VII for the emotive minor loop, ii-V-I for jazz, and so
 * on. Using real progressions is most of what makes the result sound musical.
 */
const PROGRESSIONS: Record<Style, { degrees: number[]; minor: boolean; sevenths: boolean }> = {
  chill: { degrees: [1, 6, 4, 5], minor: true, sevenths: false },
  jazz: { degrees: [2, 5, 1, 6], minor: true, sevenths: true },
  lofi: { degrees: [1, 4, 6, 5], minor: true, sevenths: true },
  cinematic: { degrees: [1, 6, 3, 7], minor: true, sevenths: false },
  edm: { degrees: [6, 4, 1, 5], minor: true, sevenths: false },
  rock: { degrees: [1, 7, 4, 5], minor: false, sevenths: false },
};

/**
 * Builds the chord for a scale degree.
 *
 * Quality follows from the degree's position in the scale rather than being
 * chosen arbitrarily — in a minor key, i is minor, III and VI are major, and
 * so on. Getting this right is the difference between "chords" and "music".
 */
export function chordForDegree(
  degree: number,
  minorKey: boolean,
  sevenths: boolean,
): Chord {
  const scale = minorKey ? MINOR_SCALE : MAJOR_SCALE;
  const idx = ((degree - 1) % 7 + 7) % 7;
  const root = scale[idx];

  // Third and fifth come from stacking scale steps, which is what determines
  // whether the chord lands major or minor.
  const third = scale[(idx + 2) % 7] + (idx + 2 >= 7 ? 12 : 0);
  const fifth = scale[(idx + 4) % 7] + (idx + 4 >= 7 ? 12 : 0);
  const seventh = scale[(idx + 6) % 7] + (idx + 6 >= 7 ? 12 : 0);

  const tones = sevenths
    ? [0, third - root, fifth - root, seventh - root]
    : [0, third - root, fifth - root];

  const isMinor = tones[1] === 3;
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][idx];

  return {
    tones,
    root,
    degree: isMinor ? roman.toLowerCase() : roman,
  };
}

/** The chord sequence for a style, one chord per bar. */
export function progressionFor(style: Style, bars: number): Chord[] {
  const p = PROGRESSIONS[style] ?? PROGRESSIONS.chill;
  const out: Chord[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const degree = p.degrees[bar % p.degrees.length];
    out.push(chordForDegree(degree, p.minor, p.sevenths));
  }
  return out;
}

export function isMinorStyle(style: Style): boolean {
  return (PROGRESSIONS[style] ?? PROGRESSIONS.chill).minor;
}

/**
 * A bassline that walks rather than sitting on the root.
 *
 * Returns note events as {beat, semitone} relative to the key root. The
 * pattern differs per style: a rock bass drives eighths on the root, a jazz
 * bass walks stepwise into the next chord, EDM sits on offbeat octaves.
 */
export interface NoteEvent {
  /** Beat within the loop. */
  beat: number;
  /** Semitones from the key root. */
  semitone: number;
  duration: number;
  velocity: number;
}

export function buildBassline(
  chords: Chord[],
  style: Style,
  beatsPerBar = 4,
): NoteEvent[] {
  const out: NoteEvent[] = [];

  chords.forEach((chord, bar) => {
    const base = bar * beatsPerBar;
    const next = chords[(bar + 1) % chords.length];

    switch (style) {
      case 'jazz': {
        // Walking bass: root, third, fifth, then a step into the next root.
        const approach = next.root - 1;
        const walk = [chord.root, chord.root + chord.tones[1], chord.root + chord.tones[2], approach];
        walk.forEach((semi, i) => {
          out.push({ beat: base + i, semitone: semi, duration: 0.9, velocity: 0.8 });
        });
        break;
      }

      case 'edm': {
        // Offbeat eighths — the classic pumping bass.
        for (let i = 0; i < beatsPerBar; i++) {
          out.push({ beat: base + i + 0.5, semitone: chord.root, duration: 0.4, velocity: 0.9 });
        }
        out.push({ beat: base, semitone: chord.root - 12, duration: 0.45, velocity: 1 });
        break;
      }

      case 'rock': {
        // Driving eighths on the root, with the fifth for movement.
        for (let i = 0; i < beatsPerBar * 2; i++) {
          const semi = i === 5 ? chord.root + chord.tones[2] : chord.root;
          out.push({ beat: base + i * 0.5, semitone: semi, duration: 0.45, velocity: 0.85 });
        }
        break;
      }

      case 'lofi': {
        // Lazy: root on 1, fifth on 3.5, nothing else.
        out.push({ beat: base, semitone: chord.root, duration: 1.6, velocity: 0.75 });
        out.push({
          beat: base + 2.5,
          semitone: chord.root + chord.tones[2],
          duration: 1.2,
          velocity: 0.6,
        });
        break;
      }

      case 'cinematic': {
        // One long, deep root per bar.
        out.push({ beat: base, semitone: chord.root - 12, duration: 3.8, velocity: 0.8 });
        break;
      }

      default: {
        // chill: root on 1, fifth on 3 — simple but moving.
        out.push({ beat: base, semitone: chord.root, duration: 1.8, velocity: 0.8 });
        out.push({
          beat: base + 2,
          semitone: chord.root + chord.tones[2],
          duration: 1.8,
          velocity: 0.7,
        });
      }
    }
  });

  return out;
}

/**
 * Chord voicing for the keys/pad layer.
 *
 * Voices are spread across octaves and inverted between bars so the harmony
 * does not jump around — smooth voice leading is most of what makes chords
 * sound played rather than triggered.
 */
export function buildChordVoicing(
  chords: Chord[],
  style: Style,
  beatsPerBar = 4,
): NoteEvent[] {
  const out: NoteEvent[] = [];
  let lastTop = 12;

  chords.forEach((chord, bar) => {
    const base = bar * beatsPerBar;

    // Choose the inversion whose TOP NOTE moves least from the previous bar.
    // Build each candidate fully and measure it, rather than predicting the
    // top from the shift - the octave adjustment changes which note ends up
    // highest, so predicting it was wrong and let voicings leap an octave.
    let best: number[] = [];
    let bestDist = Infinity;

    for (let shift = 0; shift < chord.tones.length; shift++) {
      const candidate = chord.tones.map((_, i) => {
        const idx = (i + shift) % chord.tones.length;
        const octave = i + shift >= chord.tones.length ? 12 : 0;
        return chord.root + chord.tones[idx] + octave;
      });
      const top = Math.max(...candidate);
      const dist = Math.abs(top - lastTop);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }

    const voiced = best;
    lastTop = Math.max(...voiced);

    if (style === 'rock' || style === 'edm') {
      // Stabs on the offbeats rather than a sustained pad.
      for (const beat of [1.5, 2.5, 3.5]) {
        voiced.forEach((semi) => {
          out.push({ beat: base + beat, semitone: semi, duration: 0.3, velocity: 0.5 });
        });
      }
    } else if (style === 'jazz') {
      // Comping: a chord on 2 and on 4-and.
      for (const beat of [1, 3.5]) {
        voiced.forEach((semi) => {
          out.push({ beat: base + beat, semitone: semi, duration: 0.8, velocity: 0.45 });
        });
      }
    } else {
      // Sustained through the bar.
      voiced.forEach((semi) => {
        out.push({ beat: base, semitone: semi, duration: beatsPerBar * 0.95, velocity: 0.4 });
      });
    }
  });

  return out;
}

/**
 * An arpeggio over the progression — the movement that stops a loop feeling
 * static.
 */
export function buildArp(
  chords: Chord[],
  style: Style,
  beatsPerBar = 4,
): NoteEvent[] {
  const out: NoteEvent[] = [];
  const step = style === 'edm' ? 0.25 : 0.5;

  chords.forEach((chord, bar) => {
    const base = bar * beatsPerBar;
    const pattern = [...chord.tones, ...chord.tones.slice(1, -1).reverse()];

    for (let i = 0; i * step < beatsPerBar; i++) {
      const semi = chord.root + pattern[i % pattern.length] + 12;
      out.push({
        beat: base + i * step,
        semitone: semi,
        duration: step * 0.85,
        // Accent the first of each group of four, so it has a pulse.
        velocity: i % 4 === 0 ? 0.55 : 0.35,
      });
    }
  });

  return out;
}

/**
 * Percussion fills to stop every bar sounding identical.
 *
 * Returns beats for a shaker/hat layer. The last bar gets a denser fill, which
 * is the simplest thing that makes a loop feel like it has a shape.
 */
export function buildPercPattern(
  style: Style,
  bars: number,
  beatsPerBar = 4,
): NoteEvent[] {
  const out: NoteEvent[] = [];

  for (let bar = 0; bar < bars; bar++) {
    const base = bar * beatsPerBar;
    const isLast = bar === bars - 1;

    const step =
      style === 'jazz' ? 1 / 3 : style === 'edm' || style === 'rock' ? 0.5 : 0.5;

    for (let b = 0; b < beatsPerBar; b += step) {
      // Swing the jazz offbeats.
      const swung = style === 'jazz' && Math.abs((b % 1) - 1 / 3) < 0.01 ? b + 0.05 : b;
      const onBeat = Math.abs(b % 1) < 0.01;
      out.push({
        beat: base + swung,
        semitone: 0,
        duration: 0.08,
        velocity: onBeat ? 0.5 : 0.28,
      });
    }

    // Fill: extra sixteenths through the final beat of the loop.
    //
    // Capped below the downbeat accent (0.5). A fill that grows louder than
    // the pulse it decorates stops sounding like a fill and starts sounding
    // like the beat has moved.
    if (isLast) {
      for (let i = 0; i < 4; i++) {
        out.push({
          beat: base + beatsPerBar - 1 + i * 0.25,
          semitone: 0,
          duration: 0.07,
          velocity: 0.22 + i * 0.06,
        });
      }
    }
  }

  return out;
}

/** Converts a semitone offset from the key root into a frequency. */
export function semitoneToFreq(semitone: number, keyRoot: number, octave: number): number {
  // MIDI 60 is middle C; octave shifts by 12 from there.
  const midi = 60 + keyRoot + semitone + octave * 12;
  return 440 * Math.pow(2, (midi - 69) / 12);
}
