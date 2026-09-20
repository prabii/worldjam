import {
  cleanCapture,
  estimateNoiseFloor,
  findTransientWindow,
  spectralSubtract,
} from '@/dsp/denoise';
import { rms } from '@/dsp/analysis';

const SR = 48000;

/** Steady room noise — a fan, traffic, a laptop. */
function roomNoise(seconds: number, level = 0.02, sr = SR): Float32Array {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (Math.random() * 2 - 1) * level;
  return out;
}

/** A struck object: sharp attack, exponential decay, clear pitch. */
function objectHit(seconds: number, hz = 800, decay = 12, sr = SR): Float32Array {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = Math.sin(2 * Math.PI * hz * t) * Math.exp(-decay * t) * 0.7;
  }
  return out;
}

/** Room noise with a hit partway through — what a real capture looks like. */
function noisyCapture(): { pcm: Float32Array; hitAt: number } {
  const total = Math.floor(2 * SR);
  const buf = roomNoise(2);
  const hitAt = Math.floor(0.8 * SR);
  const hit = objectHit(0.5);
  for (let i = 0; i < hit.length && hitAt + i < total; i++) {
    buf[hitAt + i] += hit[i];
  }
  return { pcm: buf, hitAt };
}

describe('estimateNoiseFloor', () => {
  it('approximates the level of steady noise', () => {
    const floor = estimateNoiseFloor(roomNoise(1, 0.02), SR);
    // White noise at amplitude a has RMS ~ a/sqrt(3).
    expect(floor).toBeGreaterThan(0.005);
    expect(floor).toBeLessThan(0.02);
  });

  it('is not dragged up by a loud transient', () => {
    const { pcm } = noisyCapture();
    const floor = estimateNoiseFloor(pcm, SR);
    // Should reflect the room, not the hit.
    expect(floor).toBeLessThan(0.05);
  });

  it('returns 0 for silence', () => {
    expect(estimateNoiseFloor(new Float32Array(1000), SR)).toBe(0);
  });
});

describe('findTransientWindow', () => {
  it('locates the hit inside a noisy recording', () => {
    const { pcm, hitAt } = noisyCapture();
    const floor = estimateNoiseFloor(pcm, SR);
    const w = findTransientWindow(pcm, SR, floor);

    expect(w).not.toBeNull();
    // Window should start at or slightly before the hit, not long after.
    expect(w!.start).toBeLessThanOrEqual(hitAt + SR * 0.05);
    expect(w!.end).toBeGreaterThan(w!.start);
  });

  it('includes pre-roll so the attack is not clipped', () => {
    const { pcm, hitAt } = noisyCapture();
    const floor = estimateNoiseFloor(pcm, SR);
    const w = findTransientWindow(pcm, SR, floor)!;
    expect(w.start).toBeLessThan(hitAt);
  });

  it('returns null when there is only room noise', () => {
    const noise = roomNoise(1, 0.02);
    const floor = estimateNoiseFloor(noise, SR);
    expect(findTransientWindow(noise, SR, floor)).toBeNull();
  });

  it('returns null for silence', () => {
    expect(findTransientWindow(new Float32Array(SR), SR, 0)).toBeNull();
  });
});

describe('spectralSubtract', () => {
  it('lowers the noise floor', () => {
    const { pcm } = noisyCapture();
    const before = estimateNoiseFloor(pcm, SR);
    const after = estimateNoiseFloor(spectralSubtract(pcm, SR), SR);
    expect(after).toBeLessThan(before);
  });

  it('preserves the hit', () => {
    const { pcm, hitAt } = noisyCapture();
    const out = spectralSubtract(pcm, SR);
    // Energy around the hit should survive largely intact.
    const before = rms(pcm, hitAt, hitAt + 2000);
    const after = rms(out, hitAt, hitAt + 2000);
    expect(after).toBeGreaterThan(before * 0.4);
  });

  it('returns the input unchanged when there is no quiet region to learn from', () => {
    // Continuous loud tone: no frames below the noise ceiling.
    const loud = objectHit(0.5, 440, 0);
    const out = spectralSubtract(loud, SR);
    expect(out.length).toBe(loud.length);
  });

  it('produces finite samples', () => {
    const { pcm } = noisyCapture();
    const out = spectralSubtract(pcm, SR);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('cleanCapture', () => {
  it('gates to the hit and reports the reduction', () => {
    const { pcm } = noisyCapture();
    const result = cleanCapture(pcm, SR);

    expect(result.gated).toBe(true);
    // The 2s recording should shrink to roughly the hit plus its decay.
    expect(result.pcm.length).toBeLessThan(pcm.length);
    expect(result.pcm.length).toBeGreaterThan(SR * 0.05);
  });

  it('leaves a pure-noise recording alone rather than destroying it', () => {
    const noise = roomNoise(1, 0.02);
    const result = cleanCapture(noise, SR);
    expect(result.gated).toBe(false);
    expect(result.pcm.length).toBe(noise.length);
  });

  it('fades the edges so the sample does not click', () => {
    const { pcm } = noisyCapture();
    const out = cleanCapture(pcm, SR).pcm;
    expect(Math.abs(out[0])).toBeLessThan(0.01);
    expect(Math.abs(out[out.length - 1])).toBeLessThan(0.01);
  });

  it('never returns NaN', () => {
    const { pcm } = noisyCapture();
    const out = cleanCapture(pcm, SR).pcm;
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('handles a very short capture without throwing', () => {
    const tiny = objectHit(0.01);
    const result = cleanCapture(tiny, SR);
    expect(result.pcm.length).toBeGreaterThan(0);
  });
});
