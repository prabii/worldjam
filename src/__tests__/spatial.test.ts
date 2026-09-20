import {
  MAX_AUDIBLE_DISTANCE,
  describeDirection,
  parsePose,
  parseProjections,
  spatialize,
  type Pose,
} from '@/audio/spatial';

/** Identity pose: at the origin, facing -Z (ARCore's forward). */
const ORIGIN: Pose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

/** Rotation of `deg` about the Y axis (turning on the spot). */
function yaw(deg: number): Pose {
  const r = (deg * Math.PI) / 180 / 2;
  return { x: 0, y: 0, z: 0, qx: 0, qy: Math.sin(r), qz: 0, qw: Math.cos(r) };
}

describe('spatialize', () => {
  it('centres a source directly ahead', () => {
    const r = spatialize({ x: 0, y: 0, z: -2 }, ORIGIN);
    expect(r.pan).toBeCloseTo(0.5, 1);
    expect(r.behind).toBe(false);
  });

  it('pans right for a source on the right', () => {
    const r = spatialize({ x: 2, y: 0, z: 0 }, ORIGIN);
    expect(r.pan).toBeGreaterThan(0.8);
  });

  it('pans left for a source on the left', () => {
    const r = spatialize({ x: -2, y: 0, z: 0 }, ORIGIN);
    expect(r.pan).toBeLessThan(0.2);
  });

  it('flags a source behind the listener', () => {
    const r = spatialize({ x: 0, y: 0, z: 2 }, ORIGIN);
    expect(r.behind).toBe(true);
  });

  it('pulls rear sources toward centre to reduce front/back confusion', () => {
    const front = spatialize({ x: 2, y: 0, z: -0.01 }, ORIGIN);
    const back = spatialize({ x: 2, y: 0, z: 0.01 }, ORIGIN);
    // Both are hard right, but the rear one is less extreme.
    expect(Math.abs(back.pan - 0.5)).toBeLessThan(Math.abs(front.pan - 0.5));
  });

  it('swaps sides when the listener turns around', () => {
    const source = { x: 2, y: 0, z: 0 };
    const facing = spatialize(source, ORIGIN);
    const turned = spatialize(source, yaw(180));
    // What was on the right is now on the left.
    expect(facing.pan).toBeGreaterThan(0.5);
    expect(turned.pan).toBeLessThan(0.5);
  });

  it('brings a side source to centre when the listener turns toward it', () => {
    const source = { x: 2, y: 0, z: 0 };
    // Turning -90 degrees about Y faces +X.
    const turned = spatialize(source, yaw(-90));
    expect(turned.pan).toBeCloseTo(0.5, 1);
    expect(turned.behind).toBe(false);
  });

  it('attenuates with distance', () => {
    const near = spatialize({ x: 0, y: 0, z: -1 }, ORIGIN);
    const far = spatialize({ x: 0, y: 0, z: -5 }, ORIGIN);
    expect(near.gain).toBeGreaterThan(far.gain);
  });

  it('does not blow up at zero distance', () => {
    const r = spatialize({ x: 0, y: 0, z: 0 }, ORIGIN);
    expect(r.gain).toBeLessThanOrEqual(1);
    expect(Number.isFinite(r.gain)).toBe(true);
  });

  it('fades to silence beyond the audible range', () => {
    const r = spatialize({ x: 0, y: 0, z: -(MAX_AUDIBLE_DISTANCE + 2) }, ORIGIN);
    expect(r.gain).toBe(0);
  });

  it('reports true euclidean distance', () => {
    const r = spatialize({ x: 3, y: 0, z: -4 }, ORIGIN);
    expect(r.distance).toBeCloseTo(5, 5);
  });

  it('keeps pan within range for every direction', () => {
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      const r = spatialize({ x: Math.sin(rad) * 2, y: 0, z: -Math.cos(rad) * 2 }, ORIGIN);
      expect(r.pan).toBeGreaterThanOrEqual(0);
      expect(r.pan).toBeLessThanOrEqual(1);
    }
  });
});

describe('describeDirection', () => {
  it('says straight ahead for a centred source', () => {
    const r = spatialize({ x: 0, y: 0, z: -1 }, ORIGIN);
    expect(describeDirection(r)).toContain('straight ahead');
  });

  it('names the correct side', () => {
    expect(describeDirection(spatialize({ x: -2, y: 0, z: 0 }, ORIGIN))).toContain('left');
    expect(describeDirection(spatialize({ x: 2, y: 0, z: 0 }, ORIGIN))).toContain('right');
  });

  it('says behind for a rear source', () => {
    expect(describeDirection(spatialize({ x: 0.5, y: 0, z: 3 }, ORIGIN))).toContain('behind');
  });

  it('describes range', () => {
    expect(describeDirection(spatialize({ x: 0, y: 0, z: -0.4 }, ORIGIN))).toContain('very close');
    expect(describeDirection(spatialize({ x: 0, y: 0, z: -6 }, ORIGIN))).toContain('far');
  });
});

describe('parsePose', () => {
  it('parses a full pose array', () => {
    const p = parsePose([1, 2, 3, 0, 0, 0, 1]);
    expect(p).toEqual({ x: 1, y: 2, z: 3, qx: 0, qy: 0, qz: 0, qw: 1 });
  });

  it('returns null for an empty array (not tracking)', () => {
    expect(parsePose([])).toBeNull();
  });
});

describe('parseProjections', () => {
  it('parses the flat native array', () => {
    const out = parseProjections(['a', 100, 200, 1.5, 1, 'b', 50, 60, 3, 0]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ id: 'a', screenX: 100, screenY: 200, distance: 1.5, visible: true });
    expect(out[1].visible).toBe(false);
  });

  it('handles an empty array', () => {
    expect(parseProjections([])).toEqual([]);
  });

  it('ignores a trailing partial record rather than producing garbage', () => {
    expect(parseProjections(['a', 1, 2, 3, 1, 'b', 9])).toHaveLength(1);
  });
});
