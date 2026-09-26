/**
 * Isolates a struck object's sound from the room around it.
 *
 * The problem this solves: a capture picks up whatever the room is doing —
 * a fan, traffic, a laptop. Without treatment that hum is baked into the
 * sample and replayed on every single hit, so a four-object loop stacks four
 * copies of the room noise and the track sounds muddy.
 *
 * The approach is spectral subtraction plus a transient-aware gate. It is
 * deliberately conservative: over-processing destroys the attack transient,
 * and that transient is exactly what makes a cup sound like a cup rather than
 * a generic click. Preserving the object's real character is the product's
 * whole premise, so when in doubt this does less, not more.
 */

import { magnitudeSpectrum, rms } from './analysis';

export interface DenoiseOptions {
  /**
   * How aggressively to subtract the noise estimate. Above ~2 you start
   * hearing "musical noise" — warbling artifacts worse than the hum itself.
   */
  strength: number;
  /** Gate threshold above the noise floor, in dB. */
  gateThresholdDb: number;
  /** Fade applied at gate boundaries, in ms. Abrupt gating clicks. */
  fadeMs: number;
}

export const DEFAULT_DENOISE: DenoiseOptions = {
  strength: 1.5,
  gateThresholdDb: 9,
  fadeMs: 8,
};

/**
 * Estimates the room's noise floor from the quietest part of a recording.
 *
 * Uses a low percentile of frame energies rather than the minimum: a single
 * anomalously quiet frame would otherwise set the floor far too low and make
 * the gate useless.
 */
export function estimateNoiseFloor(
  pcm: number[] | Float32Array,
  sampleRate: number,
): number {
  const frame = Math.max(64, Math.floor(sampleRate * 0.02)); // 20 ms
  const energies: number[] = [];

  for (let i = 0; i + frame <= pcm.length; i += frame) {
    energies.push(rms(pcm, i, i + frame));
  }
  if (energies.length === 0) return 0;

  energies.sort((a, b) => a - b);
  // 20th percentile: low enough to be "silence", high enough to be typical.
  return energies[Math.floor(energies.length * 0.2)];
}

/**
 * Finds where the hit actually is, so everything else can be silenced.
 *
 * Returns sample indices. The window starts slightly *before* the detected
 * onset because cutting exactly at the threshold clips the attack.
 */
export function findTransientWindow(
  pcm: number[] | Float32Array,
  sampleRate: number,
  noiseFloor: number,
  thresholdDb = 4,
): { start: number; end: number } | null {
  const hop = Math.max(32, Math.floor(sampleRate * 0.005)); // 5 ms

  // Frame energies, computed once and reused. Walking the buffer repeatedly
  // with rms() was both slower and easy to get subtly wrong at the edges.
  const frames: number[] = [];
  for (let i = 0; i + hop <= pcm.length; i += hop) {
    frames.push(rms(pcm, i, i + hop));
  }
  if (frames.length === 0) return null;

  let peak = 0;
  let peakFrame = -1;
  for (let f = 0; f < frames.length; f++) {
    if (frames[f] > peak) {
      peak = frames[f];
      peakFrame = f;
    }
  }
  if (peakFrame < 0 || peak <= 0) return null;

  /*
   * The onset gate is relative to the PEAK, not only to the room.
   *
   * Keying it purely off the noise floor meant a gentle tap in a loud room
   * never cleared the bar: findTransientWindow returned null, the caller fell
   * back to the entire raw buffer, and the "captured object" was really just
   * a few seconds of hall noise. Taking the higher of a modest multiple of
   * the floor and a fraction of the peak means a quiet hit in a loud room is
   * still found, and a loud hit in a quiet room is still trimmed tightly.
   */
  const floorGate = noiseFloor * Math.pow(10, thresholdDb / 20);
  const onsetGate = Math.max(floorGate, peak * 0.18);

  // Nothing stands out from the room at all — genuinely no hit here.
  if (peak < noiseFloor * 1.6) return null;

  /*
   * Walk back to the last frame BEFORE the attack.
   *
   * The previous version assigned `start = i` on both branches, so it kept
   * the quiet frame it had just rejected, and when the audio never dropped
   * below the gate it walked all the way to zero and returned the whole
   * recording. Here the loop only ever moves `startFrame` while frames are
   * still part of the hit, and stops at the first quiet one.
   */
  let startFrame = peakFrame;
  for (let f = peakFrame; f >= 0; f--) {
    if (frames[f] < onsetGate) break;
    startFrame = f;
  }

  /*
   * Walk forward until the tail decays back into the room.
   *
   * The tail gate sits far below the onset gate: a struck cup or bottle rings
   * well under the level that identified the attack, and that ring is most of
   * what makes the object recognisable. Cutting at the onset gate leaves a
   * click where a sound should be.
   */
  const tailGate = Math.max(noiseFloor * 1.2, peak * 0.02);
  // 150 ms of continuous quiet before calling the sound over, so a gap
  // between two rings inside one hit does not truncate it.
  const quietNeeded = Math.max(1, Math.round(0.15 / 0.005));

  let endFrame = frames.length;
  let quietRun = 0;
  for (let f = peakFrame; f < frames.length; f++) {
    if (frames[f] < tailGate) {
      quietRun++;
      if (quietRun >= quietNeeded) {
        // Back off to where the quiet run began, plus a short release so the
        // decay is not chopped the moment it crosses the gate.
        endFrame = Math.min(frames.length, f - quietRun + 1 + Math.round(0.06 / 0.005));
        break;
      }
    } else {
      quietRun = 0;
    }
  }

  // 10 ms of pre-roll preserves the very front of the attack, which is where
  // most of an object's character lives.
  let start = Math.max(0, startFrame * hop - Math.floor(sampleRate * 0.01));
  let end = Math.min(pcm.length, endFrame * hop);

  // Never hand back less than a quarter second when that much was recorded:
  // below that an object stops sounding like itself.
  const minLength = Math.floor(sampleRate * 0.25);
  if (end - start < minLength) {
    end = Math.min(pcm.length, start + minLength);
    if (end - start < minLength) start = Math.max(0, end - minLength);
  }

  if (end <= start) return null;
  return { start, end };
}

/**
 * Spectral subtraction: estimates the noise spectrum from the quiet region
 * and removes it from the whole signal.
 *
 * Operates on overlapping Hann-windowed frames with overlap-add
 * reconstruction, which avoids the blocky artifacts of frame-wise processing.
 */
export function spectralSubtract(
  pcm: number[] | Float32Array,
  sampleRate: number,
  opts: DenoiseOptions = DEFAULT_DENOISE,
): number[] {
  const frameSize = 1024;
  const hop = frameSize / 4; // 75% overlap
  const out = new Array<number>(pcm.length).fill(0);
  const windowSum = new Array<number>(pcm.length).fill(0);

  // --- estimate the noise magnitude spectrum from the quietest frames ---
  const noiseMag = new Float32Array(frameSize / 2);
  let noiseFrames = 0;
  const floor = estimateNoiseFloor(pcm, sampleRate);
  const noiseCeiling = floor * 1.6;

  const buf = new Float32Array(frameSize);
  for (let i = 0; i + frameSize <= pcm.length; i += hop) {
    for (let j = 0; j < frameSize; j++) buf[j] = pcm[i + j];
    if (rms(buf) > noiseCeiling) continue;

    const mag = magnitudeSpectrum(buf);
    for (let k = 0; k < noiseMag.length && k < mag.length; k++) {
      noiseMag[k] += mag[k];
    }
    noiseFrames++;
  }

  // Not enough quiet material to characterise the room — leave it alone
  // rather than subtracting a guess.
  if (noiseFrames < 2) return Array.from(pcm);

  for (let k = 0; k < noiseMag.length; k++) noiseMag[k] /= noiseFrames;

  // --- subtract, frame by frame ---
  const re = new Float32Array(frameSize);
  const im = new Float32Array(frameSize);

  for (let i = 0; i + frameSize <= pcm.length; i += hop) {
    for (let j = 0; j < frameSize; j++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * j) / (frameSize - 1)));
      re[j] = pcm[i + j] * w;
      im[j] = 0;
    }

    forwardFft(re, im);

    // Scale each bin by how much of it is signal rather than noise.
    for (let k = 1; k < frameSize / 2; k++) {
      const mag = Math.hypot(re[k], im[k]);
      if (mag < 1e-9) continue;

      const cleaned = Math.max(0, mag - opts.strength * (noiseMag[k] ?? 0));
      // Spectral floor: never fully zero a bin, or the residual turns into
      // warbling "musical noise".
      const scale = Math.max(0.05, cleaned / mag);

      re[k] *= scale;
      im[k] *= scale;
      // Mirror for the negative frequencies so the inverse stays real.
      const mirror = frameSize - k;
      re[mirror] *= scale;
      im[mirror] *= scale;
    }

    inverseFft(re, im);

    for (let j = 0; j < frameSize; j++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * j) / (frameSize - 1)));
      out[i + j] += re[j] * w;
      windowSum[i + j] += w * w;
    }
  }

  // Normalise by the accumulated window energy.
  for (let i = 0; i < out.length; i++) {
    if (windowSum[i] > 1e-6) out[i] /= windowSum[i];
    else out[i] = pcm[i];
  }

  return out;
}

/** In-place radix-2 FFT (same algorithm as analysis.ts, kept local for clarity). */
function forwardFft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
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
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Inverse FFT via conjugation, reusing the forward transform. */
function inverseFft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  forwardFft(re, im);
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

/**
 * The full capture cleanup: isolate the hit, remove the room, fade the edges.
 *
 * Returns the original audio untouched if no clear transient is found, so a
 * quiet or unusual capture is never destroyed by over-eager processing.
 */
export function cleanCapture(
  pcm: number[] | Float32Array,
  sampleRate: number,
  opts: DenoiseOptions = DEFAULT_DENOISE,
): { pcm: number[]; noiseReducedDb: number; gated: boolean } {
  const floorBefore = estimateNoiseFloor(pcm, sampleRate);

  const window = findTransientWindow(pcm, sampleRate, floorBefore, opts.gateThresholdDb);
  if (!window) {
    return { pcm: Array.from(pcm), noiseReducedDb: 0, gated: false };
  }

  // Keep only the hit and its decay.
  const sliced = Array.from(pcm).slice(window.start, window.end);
  if (sliced.length < sampleRate * 0.02) {
    return { pcm: Array.from(pcm), noiseReducedDb: 0, gated: false };
  }

  const denoised = spectralSubtract(sliced, sampleRate, opts);

  // Edge fades: a hard cut clicks, and a click is far more noticeable than
  // the hum we just removed.
  const fade = Math.min(
    Math.floor((opts.fadeMs / 1000) * sampleRate),
    Math.floor(denoised.length / 4),
  );
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    denoised[i] *= g;
    denoised[denoised.length - 1 - i] *= g;
  }

  const floorAfter = estimateNoiseFloor(denoised, sampleRate);
  const reduction =
    floorBefore > 1e-9 && floorAfter > 1e-9
      ? 20 * Math.log10(floorBefore / floorAfter)
      : 0;

  return {
    pcm: denoised,
    noiseReducedDb: Math.max(0, reduction),
    gated: true,
  };
}
