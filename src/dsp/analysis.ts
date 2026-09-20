import type { AudioFeatures, MusicalRole, NoteEvent } from '@/types';

/**
 * Local audio analysis. Everything here runs on plain Float arrays handed up
 * from the native recorder — no network, no model, per HLD v2 §4 ("DSP
 * analyzes"). These are deliberately cheap: they run between a tap and the
 * card appearing, so they must feel instant.
 */

/** Iterative radix-2 FFT, in place. Real and imaginary parts are separate. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) {
    throw new Error(`fft: length must be a power of two, got ${n}`);
  }

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** Magnitude spectrum of one windowed frame, zero-padded to a power of two. */
export function magnitudeSpectrum(frame: Float32Array): Float32Array {
  let n = 1;
  while (n < frame.length) n <<= 1;

  const re = new Float32Array(n);
  const im = new Float32Array(n);
  // Hann window suppresses the spectral leakage that would otherwise smear
  // the centroid of a short transient.
  for (let i = 0; i < frame.length; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frame.length - 1 || 1)));
    re[i] = frame[i] * w;
  }

  fft(re, im);

  const half = n >> 1;
  const mag = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    mag[i] = Math.hypot(re[i], im[i]);
  }
  return mag;
}

export function rms(data: ArrayLike<number>, from = 0, to = data.length): number {
  let sum = 0;
  const n = Math.max(1, to - from);
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / n);
}

/**
 * Trims silence around a captured hit, keeping a little pre-roll so the attack
 * transient survives — that transient is what makes a cup sound like a cup.
 */
export function trimSilence(
  pcm: number[] | Float32Array,
  sampleRate: number,
  thresholdDb = -45,
): { pcm: number[]; startOffset: number } {
  const threshold = Math.pow(10, thresholdDb / 20);
  const win = Math.max(1, Math.floor(sampleRate * 0.005)); // 5 ms windows

  let start = 0;
  for (let i = 0; i + win < pcm.length; i += win) {
    if (rms(pcm, i, i + win) > threshold) {
      start = i;
      break;
    }
  }

  let end = pcm.length;
  for (let i = pcm.length - win; i > start; i -= win) {
    if (rms(pcm, i, i + win) > threshold) {
      end = Math.min(pcm.length, i + win);
      break;
    }
  }

  // 5 ms of pre-roll: cutting exactly at the threshold clips the attack.
  const preRoll = Math.floor(sampleRate * 0.005);
  start = Math.max(0, start - preRoll);

  if (end <= start) return { pcm: Array.from(pcm), startOffset: 0 };

  const out: number[] = new Array(end - start);
  for (let i = start; i < end; i++) out[i - start] = pcm[i];
  return { pcm: out, startOffset: start };
}

/**
 * Extracts the descriptors the AI uses to decide what a sound should *be* in
 * the arrangement.
 */
export function extractFeatures(
  pcm: number[] | Float32Array,
  sampleRate: number,
): AudioFeatures {
  const duration = pcm.length / sampleRate;
  const energy = rms(pcm);

  // Peak marks the onset; decay is measured from there.
  let peak = 0;
  let peakIdx = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]);
    if (a > peak) {
      peak = a;
      peakIdx = i;
    }
  }

  const decayTarget = peak * 0.1; // -20 dB
  let decayIdx = pcm.length - 1;
  const win = Math.max(1, Math.floor(sampleRate * 0.002));
  for (let i = peakIdx; i + win < pcm.length; i += win) {
    if (rms(pcm, i, i + win) < decayTarget) {
      decayIdx = i;
      break;
    }
  }
  const decay = Math.max(0, (decayIdx - peakIdx) / sampleRate);

  // Analyse the frame right after the onset, where the timbre is clearest.
  const frameLen = Math.min(2048, pcm.length - peakIdx);
  const frame = new Float32Array(Math.max(64, frameLen));
  for (let i = 0; i < frameLen; i++) frame[i] = pcm[peakIdx + i];

  const mag = magnitudeSpectrum(frame);
  const binHz = sampleRate / (mag.length * 2);

  let weighted = 0;
  let total = 0;
  let maxMag = 0;
  let maxBin = 0;
  for (let i = 1; i < mag.length; i++) {
    weighted += i * binHz * mag[i];
    total += mag[i];
    if (mag[i] > maxMag) {
      maxMag = mag[i];
      maxBin = i;
    }
  }
  const brightness = total > 0 ? weighted / total : 0;

  // Tonality: how much of the spectrum sits in the dominant peak. A ringing
  // glass concentrates energy; a table thud spreads it.
  const peakNeighbourhood =
    (mag[maxBin - 1] ?? 0) + mag[maxBin] + (mag[maxBin + 1] ?? 0);
  const tonality = total > 0 ? Math.min(1, peakNeighbourhood / total) : 0;

  const dominant = maxBin * binHz;
  const pitch = tonality > 0.12 && dominant > 60 && dominant < 5000 ? dominant : null;

  return { duration, energy, brightness, decay, pitch, tonality };
}

/**
 * Assigns a musical role from the sound's own character, so a deep table thud
 * becomes the kick and bright keys become the hat — without any model call.
 * This is the deterministic floor the AI plan builds on.
 */
export function inferRole(f: AudioFeatures): MusicalRole {
  if (f.brightness > 3500 && f.decay < 0.25) return 'hat';
  if (f.brightness < 800 && f.decay < 0.5) return 'kick';
  if (f.decay > 1.2 && f.tonality > 0.2) return 'texture';
  if (f.brightness > 1800 && f.decay < 0.6) return 'snare';
  if (f.pitch != null && f.pitch < 250) return 'bass';
  return 'perc';
}

/** Detects onset positions (in samples) — used to read a tapped-in rhythm. */
export function detectOnsets(
  pcm: number[] | Float32Array,
  sampleRate: number,
  sensitivity = 1.5,
): number[] {
  const hop = Math.floor(sampleRate * 0.01); // 10 ms
  const envelope: number[] = [];
  for (let i = 0; i + hop < pcm.length; i += hop) {
    envelope.push(rms(pcm, i, i + hop));
  }
  if (envelope.length < 3) return [];

  // Spectral-flux-style positive difference of the amplitude envelope.
  const flux: number[] = [0];
  for (let i = 1; i < envelope.length; i++) {
    flux.push(Math.max(0, envelope[i] - envelope[i - 1]));
  }

  const mean = flux.reduce((a, b) => a + b, 0) / flux.length;
  const variance = flux.reduce((a, b) => a + (b - mean) ** 2, 0) / flux.length;
  const threshold = mean + sensitivity * Math.sqrt(variance);

  const onsets: number[] = [];
  const minGap = Math.floor(0.05 / 0.01); // 50 ms refractory period
  let last = -minGap;
  for (let i = 1; i < flux.length - 1; i++) {
    if (
      flux[i] > threshold &&
      flux[i] >= flux[i - 1] &&
      flux[i] >= flux[i + 1] &&
      i - last >= minGap
    ) {
      onsets.push(i * hop);
      last = i;
    }
  }
  return onsets;
}

/** Estimates tempo from inter-onset intervals, folded into a musical range. */
export function estimateTempo(onsets: number[], sampleRate: number): number | null {
  if (onsets.length < 3) return null;

  const intervals: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    intervals.push((onsets[i] - onsets[i - 1]) / sampleRate);
  }
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  if (median <= 0) return null;

  let bpm = 60 / median;
  // Fold octave errors into the range people actually tap in.
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm);
}

// ---------------------------------------------------------------------------
// Pitch — the hum-to-melody path (HLD C3)
// ---------------------------------------------------------------------------

/**
 * YIN-style autocorrelation pitch detection. Chosen over raw autocorrelation
 * because the cumulative-mean normalisation kills the octave errors that make
 * a hummed melody transcribe a fifth too low.
 */
export function detectPitchYin(
  frame: Float32Array,
  sampleRate: number,
  threshold = 0.15,
): number | null {
  const tauMax = Math.floor(frame.length / 2);
  const diff = new Float32Array(tauMax);

  for (let tau = 1; tau < tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < tauMax; i++) {
      const d = frame[i] - frame[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // Cumulative mean normalised difference.
  const cmnd = new Float32Array(tauMax);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau < tauMax; tau++) {
    running += diff[tau];
    cmnd[tau] = running > 0 ? (diff[tau] * tau) / running : 1;
  }

  let tauEstimate = -1;
  for (let tau = 2; tau < tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate === -1) return null;

  // Parabolic interpolation for sub-sample accuracy.
  const x0 = Math.max(1, tauEstimate - 1);
  const x2 = Math.min(tauMax - 1, tauEstimate + 1);
  const s0 = cmnd[x0];
  const s1 = cmnd[tauEstimate];
  const s2 = cmnd[x2];
  const denom = 2 * (2 * s1 - s2 - s0);
  const better = denom !== 0 ? tauEstimate + (s2 - s0) / denom : tauEstimate;

  const freq = sampleRate / better;
  return freq > 50 && freq < 2000 ? freq : null;
}

export function hzToMidi(hz: number): number {
  return Math.round(69 + 12 * Math.log2(hz / 440));
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/**
 * Transcribes a hummed take into note events: pitch per frame, then merge runs
 * of the same note. The raw voice is never modified — this only describes it.
 */
export function extractMelody(
  pcm: number[] | Float32Array,
  sampleRate: number,
): NoteEvent[] {
  const frameSize = 2048;
  const hop = Math.floor(sampleRate * 0.023); // ~23 ms
  const frame = new Float32Array(frameSize);

  type Raw = { midi: number | null; time: number; energy: number };
  const raw: Raw[] = [];

  for (let i = 0; i + frameSize < pcm.length; i += hop) {
    for (let j = 0; j < frameSize; j++) frame[j] = pcm[i + j];
    const energy = rms(frame);
    // Below this the "pitch" is just breath and room noise.
    const hz = energy > 0.01 ? detectPitchYin(frame, sampleRate) : null;
    raw.push({ midi: hz != null ? hzToMidi(hz) : null, time: i / sampleRate, energy });
  }

  // Median-smooth to remove single-frame octave jumps.
  for (let i = 1; i < raw.length - 1; i++) {
    const a = raw[i - 1].midi;
    const b = raw[i].midi;
    const c = raw[i + 1].midi;
    if (a != null && c != null && b != null && a === c && b !== a) raw[i].midi = a;
  }

  const notes: NoteEvent[] = [];
  let current: { midi: number; start: number; frames: number; energy: number } | null = null;

  const flush = (endTime: number) => {
    if (current && current.frames >= 2) {
      notes.push({
        midi: current.midi,
        time: current.start,
        duration: Math.max(0.05, endTime - current.start),
        confidence: Math.min(1, current.energy / current.frames / 0.1),
      });
    }
    current = null;
  };

  for (const r of raw) {
    if (r.midi == null) {
      flush(r.time);
      continue;
    }
    if (current && Math.abs(current.midi - r.midi) <= 0) {
      current.frames++;
      current.energy += r.energy;
    } else {
      flush(r.time);
      current = { midi: r.midi, start: r.time, frames: 1, energy: r.energy };
    }
  }
  flush(raw.length > 0 ? raw[raw.length - 1].time + hop / sampleRate : 0);

  return notes;
}

/**
 * Guesses the key by scoring the melody's pitch classes against major and
 * minor profiles, so the accompaniment lands in the same key as the singer.
 */
export function detectKey(notes: NoteEvent[]): string | null {
  if (notes.length === 0) return null;

  const weights = new Array(12).fill(0);
  for (const n of notes) weights[n.midi % 12] += n.duration;

  // Krumhansl-Schmuckler profiles.
  const major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minor = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  let best = { score: -Infinity, name: '' };
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [profile, quality] of [
      [major, 'major'],
      [minor, 'minor'],
    ] as const) {
      let score = 0;
      for (let i = 0; i < 12; i++) {
        score += weights[(tonic + i) % 12] * profile[i];
      }
      if (score > best.score) {
        best = { score, name: `${NOTE_NAMES[tonic]} ${quality}` };
      }
    }
  }
  return best.name || null;
}
