import { normalisePeak } from '@/dsp/analysis';

function peakOf(a: number[]): number {
  return a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
}

describe('normalisePeak', () => {
  it('lifts a quiet capture to a usable level', () => {
    // A soft tap. Left alone this is inaudible under the accompaniment, which
    // is why arrangements had no discernible beat.
    const quiet = Array.from({ length: 1000 }, (_, i) =>
      Math.sin(i / 10) * 0.05,
    );
    const out = normalisePeak(quiet);
    expect(peakOf(out)).toBeGreaterThan(0.3);
  });

  it('pulls a hot capture back under the ceiling', () => {
    const hot = Array.from({ length: 1000 }, (_, i) => Math.sin(i / 10) * 0.99);
    const out = normalisePeak(hot);
    expect(peakOf(out)).toBeLessThanOrEqual(0.9);
  });

  it('leaves headroom so simultaneous hits do not clip', () => {
    const loud = Array.from({ length: 500 }, (_, i) => Math.sin(i / 8) * 0.7);
    expect(peakOf(normalisePeak(loud))).toBeLessThan(1);
  });

  it('does not amplify near-silence into hiss', () => {
    // If the recording really was almost nothing, it should stay quiet rather
    // than being boosted until the noise floor is the loudest thing in it.
    const almostNothing = Array.from({ length: 1000 }, () => 0.0001);
    const out = normalisePeak(almostNothing);
    expect(peakOf(out)).toBeLessThan(0.01);
  });

  it('preserves shape — it is a gain, not a shaper', () => {
    const src = Array.from({ length: 200 }, (_, i) => Math.sin(i / 5) * 0.2);
    const out = normalisePeak(src);
    const ratio = out[10] / src[10];
    for (let i = 1; i < src.length; i++) {
      if (Math.abs(src[i]) < 1e-9) continue;
      expect(out[i] / src[i]).toBeCloseTo(ratio, 5);
    }
  });

  it('handles an empty or silent buffer without dividing by zero', () => {
    expect(normalisePeak([])).toEqual([]);
    const silent = new Array(100).fill(0);
    expect(normalisePeak(silent)).toEqual(silent);
  });

  it('makes two differently-struck objects comparable', () => {
    const soft = Array.from({ length: 800 }, (_, i) => Math.sin(i / 9) * 0.06);
    const hard = Array.from({ length: 800 }, (_, i) => Math.sin(i / 9) * 0.75);
    const a = peakOf(normalisePeak(soft));
    const b = peakOf(normalisePeak(hard));
    // Within 6 dB of each other, rather than the ~22 dB they started apart.
    expect(Math.abs(20 * Math.log10(a / b))).toBeLessThan(6);
  });
});
