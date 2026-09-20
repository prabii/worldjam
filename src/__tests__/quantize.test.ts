import {
  DEFAULT_QUANTIZE,
  beatToFrame,
  frameToBeat,
  quantizeBeat,
  quantizeLoop,
  timingAccuracy,
  wrapToLoop,
} from '@/dsp/quantize';
import type { LoopEvent } from '@/types';

const hard = { ...DEFAULT_QUANTIZE, strength: 1, tolerance: 0.5, swing: 0 };

describe('quantizeBeat', () => {
  it('snaps a slightly-late hit back onto the grid', () => {
    // 1/16 grid: step = 0.25. 1.03 should land on 1.0.
    expect(quantizeBeat(1.03, hard)).toBeCloseTo(1.0, 5);
  });

  it('leaves an already-perfect hit untouched', () => {
    expect(quantizeBeat(2.0, hard)).toBeCloseTo(2.0, 5);
  });

  it('partially corrects at reduced strength, preserving feel', () => {
    const result = quantizeBeat(1.1, { ...hard, strength: 0.5 });
    // Half way from 1.1 back to 1.0.
    expect(result).toBeCloseTo(1.05, 5);
    expect(result).not.toBeCloseTo(1.0, 5);
  });

  it('leaves a deliberately off-grid hit alone when outside the tolerance', () => {
    // Step 0.25, tolerance 0.2 -> anything more than 0.05 away is intentional.
    const tight = { ...hard, tolerance: 0.2 };
    expect(quantizeBeat(1.12, tight)).toBeCloseTo(1.12, 5);
  });

  it('delays offbeats when swing is applied', () => {
    const swung = quantizeBeat(1.25, { ...hard, swing: 0.6 });
    expect(swung).toBeGreaterThan(1.25);
  });

  it('does not move downbeats when swinging', () => {
    expect(quantizeBeat(1.0, { ...hard, swing: 0.6 })).toBeCloseTo(1.0, 5);
  });
});

describe('quantizeLoop', () => {
  it('returns events sorted by beat', () => {
    const events: LoopEvent[] = [
      { objectId: 'a', beat: 3.02, velocity: 1 },
      { objectId: 'b', beat: 1.01, velocity: 1 },
      { objectId: 'c', beat: 2.04, velocity: 1 },
    ];
    const out = quantizeLoop(events, hard);
    expect(out.map((e) => e.objectId)).toEqual(['b', 'c', 'a']);
  });

  it('preserves every event and its velocity', () => {
    const events: LoopEvent[] = [
      { objectId: 'a', beat: 1.1, velocity: 0.5 },
      { objectId: 'b', beat: 2.2, velocity: 0.8 },
    ];
    const out = quantizeLoop(events, hard);
    expect(out).toHaveLength(2);
    expect(out.find((e) => e.objectId === 'a')!.velocity).toBe(0.5);
  });

  it('handles an empty loop', () => {
    expect(quantizeLoop([], hard)).toEqual([]);
  });
});

describe('timingAccuracy', () => {
  it('scores a perfectly placed loop at 1', () => {
    const events: LoopEvent[] = [0, 1, 2, 3].map((b) => ({
      objectId: 'x',
      beat: b,
      velocity: 1,
    }));
    expect(timingAccuracy(events, 4)).toBeCloseTo(1, 5);
  });

  it('scores worse for sloppier timing', () => {
    const tight: LoopEvent[] = [0, 1.01, 2, 3.02].map((b) => ({
      objectId: 'x',
      beat: b,
      velocity: 1,
    }));
    const sloppy: LoopEvent[] = [0, 1.12, 2.1, 3.11].map((b) => ({
      objectId: 'x',
      beat: b,
      velocity: 1,
    }));
    expect(timingAccuracy(tight, 4)).toBeGreaterThan(timingAccuracy(sloppy, 4));
  });

  it('improves after quantizing — the claim the UI makes', () => {
    const sloppy: LoopEvent[] = [0.06, 1.09, 1.94, 3.07].map((b) => ({
      objectId: 'x',
      beat: b,
      velocity: 1,
    }));
    const before = timingAccuracy(sloppy, 4);
    const after = timingAccuracy(quantizeLoop(sloppy, hard), 4);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeCloseTo(1, 3);
  });

  it('treats an empty loop as perfect rather than dividing by zero', () => {
    expect(timingAccuracy([], 4)).toBe(1);
  });
});

describe('wrapToLoop', () => {
  it('folds an overshooting hit back to the top', () => {
    const events: LoopEvent[] = [{ objectId: 'a', beat: 17, velocity: 1 }];
    const [out] = wrapToLoop(events, 16);
    expect(out.beat).toBeCloseTo(1, 5);
  });

  it('pulls a hit just before the loop point onto the downbeat', () => {
    // 15.97 of 16 is a player rushing the downbeat, not a late hit.
    const [out] = wrapToLoop([{ objectId: 'a', beat: 15.97, velocity: 1 }], 16);
    expect(out.beat).toBe(0);
  });

  it('handles negative positions', () => {
    const [out] = wrapToLoop([{ objectId: 'a', beat: -1, velocity: 1 }], 16);
    expect(out.beat).toBeCloseTo(15, 5);
  });

  it('returns events untouched when the loop length is invalid', () => {
    const events: LoopEvent[] = [{ objectId: 'a', beat: 5, velocity: 1 }];
    expect(wrapToLoop(events, 0)).toEqual(events);
  });
});

describe('beat/frame conversion', () => {
  it('round-trips a beat position', () => {
    const bpm = 120;
    const sr = 48000;
    const origin = 1000;
    const frame = beatToFrame(4, bpm, sr, origin);
    expect(frameToBeat(frame, bpm, sr, origin)).toBeCloseTo(4, 5);
  });

  it('puts one beat at 0.5s for 120 BPM', () => {
    expect(beatToFrame(1, 120, 48000, 0)).toBe(24000);
  });
});
