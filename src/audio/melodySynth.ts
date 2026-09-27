import type { NoteEvent } from '@/types';
import { renderNote } from './instruments';

/**
 * Plays a hummed or sung melody back on an instrument.
 *
 * The voice recording stays exactly as sung — it is the user's own performance
 * and is never overwritten. This is a second rendering of the same tune: the
 * pitches and timings the analyser found, snapped to the key, played on a
 * clean instrument. It is what lets a wobbly hum come back as a piano line,
 * and it is also the input the music model is given to build a song around,
 * because a clean pitched line is far easier to follow than a breathy voice.
 *
 * Pure: renders PCM from notes, so it is tested without a device.
 */

export type MelodyInstrument = 'piano' | 'strings' | 'pluck' | 'flute';

export const MELODY_INSTRUMENTS: Array<{ id: MelodyInstrument; name: string; emoji: string }> = [
  { id: 'piano', name: 'Piano', emoji: '🎹' },
  { id: 'strings', name: 'Strings', emoji: '🎻' },
  { id: 'pluck', name: 'Sitar pluck', emoji: '🪕' },
  { id: 'flute', name: 'Flute', emoji: '🪈' },
];

/** How each instrument is built from the synth's timbres. */
function voiceFor(instrument: MelodyInstrument) {
  switch (instrument) {
    case 'strings':
      return { timbre: 'pad' as const, attack: 0.12, decay: 0.3, sustain: 0.85, release: 0.35, gain: 0.7 };
    case 'pluck':
      return { timbre: 'pluck' as const, gain: 0.9 };
    case 'flute':
      // A pad's soft harmonics with a breathy-quick onset reads as a flute.
      return { timbre: 'pad' as const, attack: 0.05, decay: 0.1, sustain: 0.9, release: 0.15, gain: 0.75 };
    default:
      return { timbre: 'keys' as const, gain: 0.85 };
  }
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Moves a melody into a comfortable register for the instrument.
 *
 * People hum low; a piano line two octaves down the keyboard sounds muddy.
 * Shifting by whole octaves keeps every interval exactly as sung.
 */
export function octaveShift(notes: NoteEvent[], target = 67): number {
  if (notes.length === 0) return 0;
  const mean = notes.reduce((a, n) => a + n.midi, 0) / notes.length;
  return Math.round((target - mean) / 12) * 12;
}

/**
 * Renders the melody as mono PCM.
 *
 * Each note is held for its sung length (with a floor, so a clipped syllable
 * still sounds) and placed at its sung time. `lengthSeconds` pads the buffer,
 * so a phrase can be sized to whole bars.
 */
export function renderMelody(
  notes: NoteEvent[],
  sampleRate: number,
  instrument: MelodyInstrument = 'piano',
  lengthSeconds?: number,
): Float32Array {
  const shift = octaveShift(notes);
  const voice = voiceFor(instrument);
  const end = notes.reduce((a, n) => Math.max(a, n.time + n.duration), 0);
  const total = Math.max(1, Math.ceil(Math.max(end + 0.6, lengthSeconds ?? 0) * sampleRate));
  const out = new Float32Array(total);

  for (const n of notes) {
    const duration = Math.max(0.12, n.duration);
    const pcm = renderNote({
      freq: midiToFreq(n.midi + shift),
      duration,
      sampleRate,
      velocity: 0.55 + 0.45 * Math.max(0, Math.min(1, n.confidence)),
      timbre: voice.timbre,
      attack: 'attack' in voice ? voice.attack : undefined,
      decay: 'decay' in voice ? voice.decay : undefined,
      sustain: 'sustain' in voice ? voice.sustain : undefined,
      release: 'release' in voice ? voice.release : undefined,
    });
    const start = Math.round(n.time * sampleRate);
    for (let i = 0; i < pcm.length && start + i < total; i++) {
      out[start + i] += pcm[i] * voice.gain;
    }
  }

  // Normalise to a safe peak so a dense phrase does not clip.
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.9) {
    const g = 0.9 / peak;
    for (let i = 0; i < out.length; i++) out[i] *= g;
  }
  return out;
}

/**
 * Duplicates mono into interleaved stereo.
 *
 * The music model will only take a two-channel source to build around.
 */
export function monoToStereo(mono: Float32Array): Float32Array {
  const out = new Float32Array(mono.length * 2);
  for (let i = 0; i < mono.length; i++) {
    out[i * 2] = mono[i];
    out[i * 2 + 1] = mono[i];
  }
  return out;
}
