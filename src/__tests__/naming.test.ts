import { nameFromSound } from '@/dsp/analysis';
import type { AudioFeatures } from '@/types';

function feat(brightness: number, decay: number): AudioFeatures {
  return { duration: 0.5, energy: 0.3, brightness, decay, pitch: null, tonality: 0.3 };
}

describe('nameFromSound', () => {
  it('names a bright short hit as a tick', () => {
    expect(nameFromSound(feat(4000, 0.1))).toBe('Tick');
  });

  it('names a bright ringing hit as a shimmer', () => {
    expect(nameFromSound(feat(4000, 1.2))).toBe('Shimmer');
  });

  it('names a dark short hit as a kick', () => {
    expect(nameFromSound(feat(300, 0.1))).toBe('Kick');
  });

  it('names a dark ringing hit as a boom', () => {
    expect(nameFromSound(feat(300, 1.5))).toBe('Boom');
  });

  it('never returns the generic placeholder', () => {
    // The whole point: "Object" told the user nothing.
    for (const b of [100, 500, 900, 1500, 2500, 3000, 5000]) {
      for (const d of [0.05, 0.3, 0.9, 2.0]) {
        expect(nameFromSound(feat(b, d))).not.toBe('Object');
      }
    }
  });

  it('always returns a non-empty name', () => {
    for (const b of [0, 50, 700, 1300, 2300, 3600, 9000]) {
      for (const d of [0, 0.19, 0.5, 0.81, 5]) {
        expect(nameFromSound(feat(b, d)).length).toBeGreaterThan(0);
      }
    }
  });

  it('distinguishes bright from dark at the same decay', () => {
    expect(nameFromSound(feat(4000, 0.5))).not.toBe(nameFromSound(feat(300, 0.5)));
  });

  it('distinguishes short from ringing at the same brightness', () => {
    expect(nameFromSound(feat(2500, 0.1))).not.toBe(nameFromSound(feat(2500, 1.5)));
  });
});
