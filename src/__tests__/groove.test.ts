import {
  STYLE_FEEL,
  applyGroove,
  describeFeel,
  directTempo,
  jitter,
  spaceRingingObjects,
  swingBeat,
} from '@/audio/groove';
import type { LoopEvent, Style, WorldJamObject } from '@/types';

function obj(id: string, decay: number | null): WorldJamObject {
  return {
    id,
    label: id,
    category: 'unknown',
    slot: 0,
    position: { x: 0.5, y: 0.5 },
    features:
      decay == null
        ? null
        : { duration: 1, energy: 0.3, brightness: 1500, decay, pitch: null, tonality: 0.2 },
    role: 'perc',
    beatPattern: [],
    volume: 1,
    pan: 0.5,
    color: '#fff',
    createdAt: 0,
  };
}

const STYLES = Object.keys(STYLE_FEEL) as Style[];

describe('directTempo', () => {
  it('lands every style inside its own range', () => {
    for (const style of STYLES) {
      const bpm = directTempo(style, []);
      expect(bpm).toBeGreaterThanOrEqual(STYLE_FEEL[style].minBpm);
      expect(bpm).toBeLessThanOrEqual(STYLE_FEEL[style].maxBpm);
    }
  });

  it('folds a half-time request up by an octave instead of clamping it', () => {
    // A model asking for EDM at 64 meant the half-time feel of 128.
    expect(directTempo('edm', [], 64)).toBe(128);
  });

  it('folds a double-time request down', () => {
    expect(directTempo('lofi', [], 160)).toBe(80);
  });

  it('respects a request that is already in range', () => {
    expect(directTempo('rock', [], 116)).toBe(116);
  });

  it('slows down for ringing objects and speeds up for tight ones', () => {
    const ringing = directTempo('chill', [obj('a', 1.4), obj('b', 1.2)]);
    const tight = directTempo('chill', [obj('a', 0.08), obj('b', 0.1)]);
    expect(ringing).toBeLessThan(tight);
  });

  it('ignores garbage requests', () => {
    expect(directTempo('jazz', [], Number.NaN)).toBe(STYLE_FEEL.jazz.homeBpm);
    expect(directTempo('jazz', [], -10)).toBe(STYLE_FEEL.jazz.homeBpm);
  });
});

describe('swingBeat', () => {
  it('never moves an on-beat note', () => {
    for (const b of [0, 1, 2, 3, 4]) expect(swingBeat(b, 0.66, 0.5)).toBe(b);
  });

  it('pushes a swung eighth late', () => {
    expect(swingBeat(0.5, 0.66, 0.5)).toBeCloseTo(0.66, 5);
  });

  it('swings sixteenths within each half beat', () => {
    expect(swingBeat(0.25, 0.6, 0.25)).toBeCloseTo(0.3, 5);
    expect(swingBeat(0.75, 0.6, 0.25)).toBeCloseTo(0.8, 5);
    // The eighth is the on-note of its sixteenth pair and stays put.
    expect(swingBeat(0.5, 0.6, 0.25)).toBe(0.5);
  });

  it('is a no-op when straight', () => {
    expect(swingBeat(0.5, 0.5, 0.5)).toBe(0.5);
  });
});

describe('jitter', () => {
  it('is deterministic, so a demo rehearses identically', () => {
    expect(jitter('cup:1.5')).toBe(jitter('cup:1.5'));
  });

  it('stays in [-1, 1]', () => {
    for (let i = 0; i < 500; i++) {
      const v = jitter(`seed${i}`);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('varies across seeds', () => {
    const vals = new Set(Array.from({ length: 50 }, (_, i) => jitter(`s${i}`).toFixed(6)));
    expect(vals.size).toBeGreaterThan(40);
  });
});

describe('spaceRingingObjects', () => {
  const sixteenths = (id: string): LoopEvent[] =>
    Array.from({ length: 16 }, (_, i) => ({ objectId: id, beat: i * 0.25, velocity: 0.8 }));

  it('stops a ringing object from retriggering on its own tail', () => {
    const bowl = obj('bowl', 1.5);
    const kept = spaceRingingObjects(sixteenths('bowl'), new Map([['bowl', bowl]]), 100);
    expect(kept.length).toBeLessThanOrEqual(4);
    expect(kept.length).toBeGreaterThan(0);
  });

  it('leaves short dry sounds alone, since sixteenths of a click are a shaker', () => {
    const click = obj('click', 0.08);
    const kept = spaceRingingObjects(sixteenths('click'), new Map([['click', click]]), 100);
    expect(kept).toHaveLength(16);
  });

  it('passes through events for things that are not objects', () => {
    const layer: LoopEvent[] = [{ objectId: 'layer:bass', beat: 0, velocity: 1 }];
    expect(spaceRingingObjects(layer, new Map(), 100)).toHaveLength(1);
  });
});

describe('applyGroove', () => {
  const cup = obj('cup', 0.2);
  const base: LoopEvent[] = [
    { objectId: 'cup', beat: 0, velocity: 1 },
    { objectId: 'cup', beat: 0.5, velocity: 0.6 },
    { objectId: 'cup', beat: 1, velocity: 0.8 },
    { objectId: 'cup', beat: 1.5, velocity: 0.6 },
  ];

  it('swings jazz offbeats late', () => {
    const out = applyGroove(base, { style: 'jazz', bpm: 120, objects: [cup], totalBeats: 32 });
    const off = out.find((e) => e.beat > 0.4 && e.beat < 0.9)!;
    expect(off.beat).toBeGreaterThan(0.55);
  });

  it('keeps EDM essentially on the grid', () => {
    const out = applyGroove(base, { style: 'edm', bpm: 126, objects: [cup], totalBeats: 32 });
    for (let i = 0; i < out.length; i++) {
      expect(Math.abs(out[i].beat - base[i].beat)).toBeLessThan(0.01);
    }
  });

  it('keeps the downbeat tight', () => {
    const out = applyGroove(base, { style: 'lofi', bpm: 80, objects: [cup], totalBeats: 32 });
    expect(Math.abs(out[0].beat)).toBeLessThan(0.01);
  });

  it('never pushes an event outside the loop', () => {
    const edge: LoopEvent[] = [
      { objectId: 'cup', beat: 0, velocity: 1 },
      { objectId: 'cup', beat: 31.75, velocity: 1 },
    ];
    const out = applyGroove(edge, { style: 'lofi', bpm: 80, objects: [cup], totalBeats: 32 });
    for (const e of out) {
      expect(e.beat).toBeGreaterThanOrEqual(0);
      expect(e.beat).toBeLessThan(32);
    }
  });

  it('keeps velocities in range', () => {
    const out = applyGroove(base, { style: 'jazz', bpm: 120, objects: [cup], totalBeats: 32 });
    for (const e of out) {
      expect(e.velocity).toBeGreaterThan(0);
      expect(e.velocity).toBeLessThanOrEqual(1);
    }
  });

  it('leaves accompaniment and vocal events untouched', () => {
    const layer: LoopEvent[] = [{ objectId: 'layer:bass', beat: 0.5, velocity: 1 }];
    const out = applyGroove(layer, { style: 'jazz', bpm: 120, objects: [], totalBeats: 32 });
    expect(out[0]).toEqual(layer[0]);
  });

  it('returns events sorted, which the scheduler requires', () => {
    const out = applyGroove(base, { style: 'lofi', bpm: 80, objects: [cup], totalBeats: 32 });
    for (let i = 1; i < out.length; i++) expect(out[i].beat).toBeGreaterThanOrEqual(out[i - 1].beat);
  });

  it('is deterministic', () => {
    const a = applyGroove(base, { style: 'lofi', bpm: 80, objects: [cup], totalBeats: 32 });
    const b = applyGroove(base, { style: 'lofi', bpm: 80, objects: [cup], totalBeats: 32 });
    expect(a).toEqual(b);
  });
});

describe('describeFeel', () => {
  it('names the feel a musician would', () => {
    expect(describeFeel('jazz', 120, 8)).toBe('120 BPM · swung eighths · 8 bars');
    expect(describeFeel('lofi', 80, 8)).toContain('swung sixteenths');
    expect(describeFeel('edm', 126, 8)).toContain('locked grid');
    expect(describeFeel('rock', 112, 8)).toContain('straight');
  });
});
