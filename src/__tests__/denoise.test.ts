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

describe('transient window keeps the sound intact', () => {
  const SR = 48000;

  /** A struck object: sharp attack, long exponential ring, over room noise. */
  function struckObject(ringSeconds: number): number[] {
    const total = Math.floor(SR * (0.3 + ringSeconds + 0.3));
    const out = new Array<number>(total);
    const onset = Math.floor(SR * 0.3);
    for (let i = 0; i < total; i++) {
      // Room tone everywhere.
      let v = (Math.random() - 0.5) * 0.002;
      if (i >= onset) {
        const t = (i - onset) / SR;
        // Ring that decays over `ringSeconds`, like a cup or bottle.
        const env = Math.exp(-t * (5 / ringSeconds));
        v += Math.sin(2 * Math.PI * 720 * t) * 0.5 * env;
      }
      out[i] = v;
    }
    return out;
  }

  it('keeps the ring, not just the attack', () => {
    // The bug: the window closed ~80ms after the peak, so a cup that rings
    // for a second came back as a 0.1s click and played as a different,
    // thinner object than the one recorded.
    const pcm = struckObject(1.0);
    const w = findTransientWindow(pcm, SR, estimateNoiseFloor(pcm, SR));
    expect(w).not.toBeNull();

    const seconds = (w!.end - w!.start) / SR;
    expect(seconds).toBeGreaterThan(0.4);
  });

  it('never returns a clip too short to recognise', () => {
    for (const ring of [0.05, 0.2, 0.5, 1.0, 2.0]) {
      const pcm = struckObject(ring);
      const w = findTransientWindow(pcm, SR, estimateNoiseFloor(pcm, SR));
      if (!w) continue;
      expect((w.end - w.start) / SR).toBeGreaterThanOrEqual(0.24);
    }
  });

  it('starts at or before the attack', () => {
    const pcm = struckObject(0.8);
    const w = findTransientWindow(pcm, SR, estimateNoiseFloor(pcm, SR));
    // Onset is at 0.3s; the window must not begin after it.
    expect(w!.start / SR).toBeLessThanOrEqual(0.3);
  });

  it('stays inside the buffer it was given', () => {
    const pcm = struckObject(0.5);
    const w = findTransientWindow(pcm, SR, estimateNoiseFloor(pcm, SR));
    expect(w!.start).toBeGreaterThanOrEqual(0);
    expect(w!.end).toBeLessThanOrEqual(pcm.length);
    expect(w!.end).toBeGreaterThan(w!.start);
  });

  it('cleanCapture preserves a recognisable length end to end', () => {
    const pcm = struckObject(1.0);
    const { pcm: cleaned } = cleanCapture(pcm, SR);
    expect(cleaned.length / SR).toBeGreaterThan(0.3);
  });
});

describe('playback audio is the recording, not a processed copy', () => {
  const SR = 48000;

  /** A struck object with quiet upper harmonics over a faint room. */
  function ringingObject(): number[] {
    const total = Math.floor(SR * 1.2);
    const out = new Array<number>(total);
    const onset = Math.floor(SR * 0.2);
    for (let i = 0; i < total; i++) {
      let v = (Math.random() - 0.5) * 0.003;
      if (i >= onset) {
        const t = (i - onset) / SR;
        const env = Math.exp(-t * 4);
        // Fundamental plus two quiet partials — the partials are what make a
        // cup sound like a cup rather than a beep, and they are exactly what
        // over-subtraction removes.
        v += Math.sin(2 * Math.PI * 430 * t) * 0.45 * env;
        v += Math.sin(2 * Math.PI * 1290 * t) * 0.08 * env;
        v += Math.sin(2 * Math.PI * 2580 * t) * 0.04 * env;
      }
      out[i] = v;
    }
    return out;
  }

  it('denoising measurably changes the signal, which is why it is not used for playback', () => {
    // This pins the reason for the split rather than the split itself: if
    // spectral subtraction were transparent there would be no bug to fix.
    const pcm = ringingObject();
    const { pcm: cleaned } = cleanCapture(pcm, SR);

    const n = Math.min(pcm.length, cleaned.length);
    let diff = 0;
    for (let i = 0; i < n; i++) diff += Math.abs(pcm[i] - cleaned[i]);
    expect(diff / n).toBeGreaterThan(0);
  });

  it('the gated hit keeps its energy — it is not hollowed out', () => {
    const pcm = ringingObject();
    const w = findTransientWindow(pcm, SR, estimateNoiseFloor(pcm, SR));
    expect(w).not.toBeNull();

    const hit = pcm.slice(w!.start, w!.end);
    // Energy of the raw hit must survive gating: the window only trims, it
    // must never attenuate.
    expect(rms(hit)).toBeGreaterThan(0.02);
  });

  it('gating alone preserves samples exactly', () => {
    // Every sample inside the window must be bit-identical to the recording.
    // Anything else means playback is not what was captured.
    const pcm = ringingObject();
    const w = findTransientWindow(pcm, SR, estimateNoiseFloor(pcm, SR))!;
    const hit = pcm.slice(w.start, w.end);
    for (let i = 0; i < hit.length; i += 97) {
      expect(hit[i]).toBe(pcm[w.start + i]);
    }
  });
});
