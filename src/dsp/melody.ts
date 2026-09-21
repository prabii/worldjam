import type { NoteEvent } from '@/types';

/**
 * Turning a hummed melody into something a song can be built on.
 *
 * extractMelody() in analysis.ts gives raw pitch-tracked notes. Those are
 * honest but unusable as a musical part: a person humming lands between
 * semitones, holds notes for irregular lengths, and starts phrases slightly
 * off the beat. Handing that straight to an arranger produces something that
 * sounds like a broken tape rather than a song.
 *
 * This module does the three things a producer would do with a rough vocal
 * idea: tune it, time it, and trim it. Every step is deliberately gentle —
 * over-correcting removes the human quality that made the hum worth keeping.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Semitone offsets from the tonic for each scale. */
const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  /** Used when the melody is too short to trust a key guess. */
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export interface RefinedMelody {
  notes: NoteEvent[];
  /** e.g. "C major", or null when there was too little pitched material. */
  key: string | null;
  /** Beats per minute inferred from the phrasing. */
  bpm: number;
  /** Lowest and highest MIDI note, for choosing an instrument range. */
  range: { low: number; high: number } | null;
  /** How much the notes had to move to reach the scale, in semitones. */
  tuningApplied: number;
}

/**
 * Snaps a melody to the nearest scale tone.
 *
 * Only notes within `maxShift` semitones are moved. A note further out than
 * that is more likely a genuine chromatic choice or a tracking error than a
 * flat note, and dragging it onto the scale would invent a melody the user
 * never sang.
 */
export function snapToScale(
  notes: NoteEvent[],
  key: string | null,
  maxShift = 1,
): { notes: NoteEvent[]; tuningApplied: number } {
  if (notes.length === 0) return { notes: [], tuningApplied: 0 };

  const parsed = parseKey(key);
  const scale = parsed ? SCALES[parsed.quality] : SCALES.chromatic;
  const tonic = parsed?.tonic ?? 0;

  let totalShift = 0;

  const out = notes.map((n) => {
    const degree = ((n.midi - tonic) % 12 + 12) % 12;
    // Nearest allowed scale degree, measured circularly so B snaps up to C
    // rather than down across the whole octave.
    let best = degree;
    let bestDist = Infinity;
    for (const s of scale) {
      const raw = s - degree;
      const dist = ((raw + 18) % 12) - 6; // signed distance in [-6, 6)
      if (Math.abs(dist) < Math.abs(bestDist)) {
        bestDist = dist;
        best = s;
      }
    }

    if (!Number.isFinite(bestDist) || Math.abs(bestDist) > maxShift) return n;
    totalShift += Math.abs(bestDist);
    return { ...n, midi: n.midi + bestDist };
  });

  return { notes: out, tuningApplied: totalShift };
}

/**
 * Estimates tempo from the gaps between note onsets.
 *
 * Humming has no click track, so the tempo has to come from the phrasing
 * itself. The median inter-onset gap is treated as one beat and then folded
 * into a musical range — a median gap of 0.25s is almost certainly eighth
 * notes at 120 rather than a genuine 240 BPM.
 */
export function inferTempo(notes: NoteEvent[], fallback = 92): number {
  if (notes.length < 3) return fallback;

  const gaps: number[] = [];
  for (let i = 1; i < notes.length; i++) {
    const gap = notes[i].time - notes[i - 1].time;
    if (gap > 0.08 && gap < 2) gaps.push(gap);
  }
  if (gaps.length < 2) return fallback;

  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  let bpm = 60 / median;

  // Fold into 70..150, the range most songs actually sit in.
  while (bpm > 150) bpm /= 2;
  while (bpm < 70) bpm *= 2;

  return Math.round(bpm);
}

/**
 * Quantises note times to a grid.
 *
 * `division` is the note value of the grid, named the way musicians name it:
 * 4 is quarter notes, 8 eighths, 16 sixteenths. An earlier version divided by
 * `division / 4`, which made 4 mean quarters but 16 mean only sixteenth-of-a-
 * bar-per-beat — off by a factor of four and silently wrong for every value
 * except the default.
 *
 * `strength` blends between the performance and the grid: 1 is rigid, 0 leaves
 * it untouched. The default deliberately falls short of full correction, since
 * a perfectly gridded vocal line loses the swing that makes it sound sung.
 */
export function quantizeMelody(
  notes: NoteEvent[],
  bpm: number,
  division = 16,
  strength = 0.8,
): NoteEvent[] {
  const step = (60 / bpm) * (4 / division);
  if (!Number.isFinite(step) || step <= 0) return notes;

  return notes.map((n) => {
    const target = Math.round(n.time / step) * step;
    const time = n.time + (target - n.time) * strength;
    // Durations snap too, or a quantised start with a ragged end leaves
    // overlapping notes the synth has to cut off mid-phrase.
    const targetDur = Math.max(step, Math.round(n.duration / step) * step);
    const duration = n.duration + (targetDur - n.duration) * strength;
    return { ...n, time: Math.max(0, time), duration };
  });
}

/**
 * Removes notes too short or too quiet to be intentional.
 *
 * Breaths between phrases and the pitch slide at the start of a note both
 * register as very short events; keeping them makes the melody sound like it
 * stutters.
 */
export function cleanMelody(notes: NoteEvent[], minDuration = 0.09): NoteEvent[] {
  const kept = notes.filter((n) => n.duration >= minDuration && n.confidence > 0.12);

  // Merge consecutive identical pitches separated by a negligible gap — one
  // held note that the tracker split into two.
  const merged: NoteEvent[] = [];
  for (const n of kept) {
    const prev = merged[merged.length - 1];
    if (prev && prev.midi === n.midi && n.time - (prev.time + prev.duration) < 0.06) {
      prev.duration = n.time + n.duration - prev.time;
      prev.confidence = Math.max(prev.confidence, n.confidence);
      continue;
    }
    merged.push({ ...n });
  }
  return merged;
}

/**
 * Moves a melody into a comfortable octave.
 *
 * A hummed low male voice can track an octave below where the melody reads
 * best, and a falsetto an octave above. Centring on middle C keeps the lead
 * instrument in the part of its range that sounds like a lead rather than a
 * bass or a whistle.
 */
export function centreOctave(notes: NoteEvent[], target = 65): NoteEvent[] {
  if (notes.length === 0) return notes;

  const mean = notes.reduce((a, n) => a + n.midi, 0) / notes.length;
  const shift = Math.round((target - mean) / 12) * 12;
  if (shift === 0) return notes;
  return notes.map((n) => ({ ...n, midi: n.midi + shift }));
}

/**
 * The full pipeline: clean, tune, time, and centre a hummed melody.
 *
 * Order matters. Cleaning first stops junk notes from skewing the key and
 * tempo estimates; tuning before quantising means the scale snap is judged on
 * the pitches actually sung rather than on notes that have already moved.
 */
export function refineMelody(
  raw: NoteEvent[],
  detectedKey: string | null,
  opts: { quantizeStrength?: number; division?: number; centre?: boolean } = {},
): RefinedMelody {
  const cleaned = cleanMelody(raw);

  if (cleaned.length === 0) {
    return { notes: [], key: detectedKey, bpm: 92, range: null, tuningApplied: 0 };
  }

  const { notes: tuned, tuningApplied } = snapToScale(cleaned, detectedKey);
  const bpm = inferTempo(tuned);
  const timed = quantizeMelody(
    tuned,
    bpm,
    opts.division ?? 16,
    opts.quantizeStrength ?? 0.8,
  );
  const final = opts.centre === false ? timed : centreOctave(timed);

  const midis = final.map((n) => n.midi);

  return {
    notes: final,
    key: detectedKey,
    bpm,
    range: { low: Math.min(...midis), high: Math.max(...midis) },
    tuningApplied,
  };
}

/**
 * A compact description of the melody for the language model.
 *
 * The model cannot hear the hum, so this is the only thing standing between
 * it and a generic arrangement. Contour and phrasing matter more than exact
 * pitches for deciding how a song should be built, so both are stated plainly
 * rather than left for the model to infer from a list of numbers.
 */
export function describeMelody(m: RefinedMelody): string {
  if (m.notes.length === 0) return 'No clear melody was detected.';

  const first = m.notes[0];
  const last = m.notes[m.notes.length - 1];
  const span = m.range ? m.range.high - m.range.low : 0;
  const length = last.time + last.duration;

  const direction =
    last.midi > first.midi + 2
      ? 'rises'
      : last.midi < first.midi - 2
        ? 'falls'
        : 'returns to where it started';

  const pace =
    m.notes.length / Math.max(1, length) > 3 ? 'quick, busy phrasing' : 'long, held notes';

  return [
    `Key: ${m.key ?? 'unclear'}.`,
    `Tempo around ${m.bpm} BPM.`,
    `${m.notes.length} notes over ${length.toFixed(1)}s with ${pace}.`,
    `The line ${direction}, spanning ${span} semitones.`,
    `Starts on ${midiName(first.midi)} and ends on ${midiName(last.midi)}.`,
  ].join(' ');
}

export function midiName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function parseKey(key: string | null): { tonic: number; quality: string } | null {
  if (!key) return null;
  const [name, quality] = key.split(' ');
  const tonic = NOTE_NAMES.indexOf(name);
  if (tonic < 0 || !(quality in SCALES)) return null;
  return { tonic, quality };
}
