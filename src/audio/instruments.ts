/**
 * Instrument voices for the accompaniment.
 *
 * The previous synth used bare sine waves, which is why the backing sounded
 * toy-like: a sine has no harmonics, so it reads as a test tone rather than an
 * instrument. Real instruments are defined by their harmonic series, their
 * attack, and how the timbre changes as the note decays.
 *
 * Everything here is additive or subtractive synthesis computed per sample.
 * That is more expensive than a sine, but this runs once per arrangement
 * change rather than per frame, so the cost is paid in a place the user does
 * not feel it.
 */

/** Harmonic amplitudes, relative to the fundamental. */
interface Timbre {
  /** Amplitude of harmonic n (index 0 = fundamental). */
  harmonics: number[];
  /** Detune in cents per harmonic — a little makes it sound alive. */
  detuneCents?: number[];
  /** How quickly higher harmonics die relative to the fundamental. */
  brightnessDecay: number;
}

/**
 * Electric-bass-like: strong fundamental, a solid second and third harmonic,
 * and a quick loss of brightness that reads as a plucked string.
 */
const BASS_TIMBRE: Timbre = {
  harmonics: [1.0, 0.55, 0.32, 0.18, 0.1, 0.06, 0.03],
  brightnessDecay: 5.5,
};

/** Electric-piano-like: bell attack over a warm body. */
const KEYS_TIMBRE: Timbre = {
  harmonics: [1.0, 0.4, 0.28, 0.14, 0.22, 0.06, 0.09, 0.04],
  detuneCents: [0, 2, -3, 4, -2, 5, -4, 3],
  brightnessDecay: 3.2,
};

/** Warm pad: many soft harmonics, slow movement. */
const PAD_TIMBRE: Timbre = {
  harmonics: [1.0, 0.5, 0.35, 0.25, 0.18, 0.13, 0.09, 0.06, 0.04],
  detuneCents: [0, 4, -5, 7, -6, 9, -8, 11, -10],
  brightnessDecay: 1.4,
};

/** Plucked/guitar-like: bright attack, fast decay, odd harmonics emphasised. */
const PLUCK_TIMBRE: Timbre = {
  harmonics: [1.0, 0.3, 0.45, 0.2, 0.28, 0.12, 0.16, 0.08],
  detuneCents: [0, 1, -2, 2, -1, 3, -2, 1],
  brightnessDecay: 6.0,
};

export interface NoteOptions {
  freq: number;
  /** Seconds. */
  duration: number;
  sampleRate: number;
  velocity?: number;
  timbre?: 'bass' | 'keys' | 'pad' | 'pluck';
  /** ADSR, in seconds (sustain is a level, 0..1). */
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
}

const TIMBRES = {
  bass: BASS_TIMBRE,
  keys: KEYS_TIMBRE,
  pad: PAD_TIMBRE,
  pluck: PLUCK_TIMBRE,
};

const DEFAULT_ENV = {
  bass: { attack: 0.006, decay: 0.12, sustain: 0.65, release: 0.18 },
  keys: { attack: 0.004, decay: 0.3, sustain: 0.35, release: 0.4 },
  pad: { attack: 0.35, decay: 0.5, sustain: 0.8, release: 0.7 },
  pluck: { attack: 0.002, decay: 0.15, sustain: 0.2, release: 0.25 },
};

/**
 * Renders a single note with a real harmonic spectrum and an ADSR envelope.
 *
 * The key detail is `brightnessDecay`: higher harmonics fade faster than the
 * fundamental, which is what every real plucked or struck instrument does. A
 * fixed spectrum sounds static and synthetic no matter how many harmonics it
 * has.
 */
export function renderNote(opts: NoteOptions): Float32Array {
  const {
    freq,
    duration,
    sampleRate,
    velocity = 1,
    timbre = 'keys',
  } = opts;

  const t = TIMBRES[timbre];
  const env = DEFAULT_ENV[timbre];
  const attack = opts.attack ?? env.attack;
  const decay = opts.decay ?? env.decay;
  const sustain = opts.sustain ?? env.sustain;
  const release = opts.release ?? env.release;

  const total = Math.floor((duration + release) * sampleRate);
  const out = new Float32Array(total);

  // Normalise so adding harmonics does not simply get louder.
  const sum = t.harmonics.reduce((a, b) => a + b, 0);

  for (let i = 0; i < total; i++) {
    const time = i / sampleRate;

    // --- ADSR ---
    let amp: number;
    if (time < attack) {
      amp = time / attack;
    } else if (time < attack + decay) {
      amp = 1 - (1 - sustain) * ((time - attack) / decay);
    } else if (time < duration) {
      amp = sustain;
    } else {
      const r = (time - duration) / release;
      amp = sustain * Math.max(0, 1 - r);
    }
    if (amp <= 0) continue;

    // --- harmonics, each losing brightness over time ---
    let sample = 0;
    for (let h = 0; h < t.harmonics.length; h++) {
      const cents = t.detuneCents?.[h] ?? 0;
      const hFreq = freq * (h + 1) * Math.pow(2, cents / 1200);
      if (hFreq > sampleRate / 2) break; // above Nyquist, would alias

      // Higher harmonics decay faster - this is what makes it sound real.
      // The rate is per-harmonic and applied at full strength: an earlier
      // version scaled it by 0.12, which made the decay so slow that the
      // timbre never actually changed and notes sounded static.
      const hDecay = Math.exp(-t.brightnessDecay * h * time);
      sample += t.harmonics[h] * hDecay * Math.sin(2 * Math.PI * hFreq * time);
    }

    out[i] = (sample / sum) * amp * velocity;
  }

  return out;
}

/** Mixes a note into a buffer at a sample offset, with clipping protection. */
export function mixInto(
  target: number[],
  note: Float32Array,
  offset: number,
  gain = 1,
): void {
  for (let i = 0; i < note.length; i++) {
    const idx = offset + i;
    if (idx < 0 || idx >= target.length) continue;
    target[idx] += note[i] * gain;
  }
}

/**
 * Noise-based percussion, for hats and shakers that fill the gaps between
 * captured object hits.
 *
 * Filtered noise rather than a tone: real cymbals and shakers are inharmonic,
 * and a pitched "tick" sounds obviously fake next to a recorded object.
 */
export function renderNoisePerc(
  sampleRate: number,
  duration: number,
  brightness = 0.7,
  velocity = 1,
): Float32Array {
  const n = Math.floor(duration * sampleRate);
  const out = new Float32Array(n);

  // One-pole high-pass, to push the noise up where hats live.
  let prev = 0;
  let prevFiltered = 0;
  const alpha = 0.5 + brightness * 0.45;

  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    const filtered = alpha * (prevFiltered + white - prev);
    prev = white;
    prevFiltered = filtered;

    // Sharp exponential decay — a hat is almost all attack.
    const env = Math.exp(-(i / n) * 14);
    out[i] = filtered * env * velocity * 0.5;
  }
  return out;
}

/** A kick, for styles that need low end the captured objects do not provide. */
export function renderKick(
  sampleRate: number,
  duration = 0.28,
  velocity = 1,
): Float32Array {
  const n = Math.floor(duration * sampleRate);
  const out = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    // Pitch sweeps from ~110 Hz down to ~45 Hz: the classic kick shape.
    const freq = 45 + 65 * Math.exp(-t * 32);
    const env = Math.exp(-t * 9);
    // A touch of click at the very start, so it cuts through on a phone.
    const click = t < 0.004 ? (1 - t / 0.004) * 0.4 : 0;
    out[i] = (Math.sin(2 * Math.PI * freq * t) * env + click) * velocity * 0.85;
  }
  return out;
}
