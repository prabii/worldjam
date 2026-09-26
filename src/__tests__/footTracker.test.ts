import {
  SAMPLE_SIZE,
  StampDetector,
  calibrate,
  chromaOf,
  findFoot,
  laneOf,
  toleranceFor,
  type FootSignature,
} from '@/vision/footTracker';

/** Builds a blank frame of one colour. */
function frameOf(r: number, g: number, b: number, size = SAMPLE_SIZE): Uint8Array {
  const px = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    px[i * 3] = r;
    px[i * 3 + 1] = g;
    px[i * 3 + 2] = b;
  }
  return px;
}

/** Paints a filled rectangle, in fractional coordinates. */
function paint(
  px: Uint8Array,
  rect: { x0: number; x1: number; y0: number; y1: number },
  rgb: [number, number, number],
  size = SAMPLE_SIZE,
): void {
  for (let y = Math.floor(rect.y0 * size); y < Math.ceil(rect.y1 * size); y++) {
    for (let x = Math.floor(rect.x0 * size); x < Math.ceil(rect.x1 * size); x++) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const i = (y * size + x) * 3;
      px[i] = rgb[0];
      px[i + 1] = rgb[1];
      px[i + 2] = rgb[2];
    }
  }
}

describe('chromaOf', () => {
  it('normalises out intensity so shade does not change hue', () => {
    const bright = chromaOf(200, 100, 50);
    const dim = chromaOf(100, 50, 25);
    expect(dim.r).toBeCloseTo(bright.r, 5);
    expect(dim.g).toBeCloseTo(bright.g, 5);
  });

  it('separates bright from dark by lightness', () => {
    expect(chromaOf(200, 100, 50).lightness).toBeGreaterThan(
      chromaOf(100, 50, 25).lightness,
    );
  });

  it('reports neutral hue for near-black rather than dividing by zero', () => {
    const c = chromaOf(2, 1, 1);
    expect(Number.isFinite(c.r)).toBe(true);
    expect(c.r).toBeCloseTo(1 / 3, 5);
  });
});

describe('calibrate', () => {
  it('reads the colour placed in the centre reticle', () => {
    const px = frameOf(20, 20, 20);
    paint(px, { x0: 0.3, x1: 0.7, y0: 0.3, y1: 0.7 }, [200, 40, 40]);
    const sig = calibrate(px);
    expect(sig).not.toBeNull();
    // A strongly red patch must land well above a neutral third.
    expect(sig!.r).toBeGreaterThan(0.6);
  });

  it('ignores the surrounding floor', () => {
    const floor = frameOf(30, 200, 30);
    paint(floor, { x0: 0.3, x1: 0.7, y0: 0.3, y1: 0.7 }, [200, 40, 40]);
    const sig = calibrate(floor)!;
    // Green floor must not drag the signature toward green.
    expect(sig.g).toBeLessThan(0.3);
  });

  it('gives a flat colour a tighter tolerance than a mottled one', () => {
    const flat = frameOf(0, 0, 0);
    paint(flat, { x0: 0.3, x1: 0.7, y0: 0.3, y1: 0.7 }, [180, 60, 60]);

    const mottled = frameOf(0, 0, 0);
    // Alternating stripes inside the reticle widen the spread.
    for (let y = 14; y < 34; y++) {
      for (let x = 14; x < 34; x++) {
        const i = (y * SAMPLE_SIZE + x) * 3;
        const red = x % 2 === 0;
        mottled[i] = red ? 200 : 40;
        mottled[i + 1] = red ? 40 : 200;
        mottled[i + 2] = 40;
      }
    }

    expect(toleranceFor(calibrate(mottled)!)).toBeGreaterThan(
      toleranceFor(calibrate(flat)!),
    );
  });
});

describe('findFoot', () => {
  const sigFor = (rgb: [number, number, number]): FootSignature => {
    const px = frameOf(10, 10, 10);
    paint(px, { x0: 0.3, x1: 0.7, y0: 0.3, y1: 0.7 }, rgb);
    return calibrate(px)!;
  };

  it('finds nothing in a frame without the foot', () => {
    const sig = sigFor([200, 40, 40]);
    const reading = findFoot(frameOf(40, 40, 200), sig);
    expect(reading.coverage).toBe(0);
    expect(reading.x).toBeNull();
  });

  it('locates the foot on the left', () => {
    const sig = sigFor([200, 40, 40]);
    const px = frameOf(40, 40, 200);
    paint(px, { x0: 0.02, x1: 0.28, y0: 0.4, y1: 0.9 }, [200, 40, 40]);
    const reading = findFoot(px, sig);
    expect(reading.coverage).toBeGreaterThan(0.05);
    expect(laneOf(reading.x!)).toBe(0);
  });

  it('locates the foot in the centre', () => {
    const sig = sigFor([200, 40, 40]);
    const px = frameOf(40, 40, 200);
    paint(px, { x0: 0.38, x1: 0.62, y0: 0.4, y1: 0.9 }, [200, 40, 40]);
    expect(laneOf(findFoot(px, sig).x!)).toBe(1);
  });

  it('locates the foot on the right', () => {
    const sig = sigFor([200, 40, 40]);
    const px = frameOf(40, 40, 200);
    paint(px, { x0: 0.72, x1: 0.98, y0: 0.4, y1: 0.9 }, [200, 40, 40]);
    expect(laneOf(findFoot(px, sig).x!)).toBe(2);
  });

  it('still recognises the foot in shadow', () => {
    const sig = sigFor([200, 100, 50]);
    const px = frameOf(20, 20, 90);
    // Same hue at half the brightness.
    paint(px, { x0: 0.38, x1: 0.62, y0: 0.4, y1: 0.9 }, [120, 60, 30]);
    expect(findFoot(px, sig).coverage).toBeGreaterThan(0.05);
  });

  it('reports larger coverage for a nearer foot', () => {
    const sig = sigFor([200, 40, 40]);

    const far = frameOf(40, 40, 200);
    paint(far, { x0: 0.45, x1: 0.55, y0: 0.45, y1: 0.55 }, [200, 40, 40]);

    const near = frameOf(40, 40, 200);
    paint(near, { x0: 0.3, x1: 0.7, y0: 0.3, y1: 0.9 }, [200, 40, 40]);

    expect(findFoot(near, sig).coverage).toBeGreaterThan(findFoot(far, sig).coverage);
  });
});

describe('laneOf', () => {
  it('splits the frame into even thirds', () => {
    expect(laneOf(0)).toBe(0);
    expect(laneOf(0.2)).toBe(0);
    expect(laneOf(0.5)).toBe(1);
    expect(laneOf(0.8)).toBe(2);
    expect(laneOf(1)).toBe(2);
  });
});

describe('StampDetector', () => {
  const planted = (x: number, coverage = 0.12) => ({ coverage, x, y: 0.7 });
  const lifted = { coverage: 0, x: null, y: null };

  it('fires once when the foot lands', () => {
    const d = new StampDetector();
    expect(d.push(planted(0.5), 1000)).toBe(1);
  });

  it('does not fire again while the foot stays planted', () => {
    const d = new StampDetector();
    d.push(planted(0.5), 1000);
    expect(d.push(planted(0.5), 1016)).toBeNull();
    expect(d.push(planted(0.5), 1032)).toBeNull();
    expect(d.push(planted(0.5), 1400)).toBeNull();
  });

  it('fires again after the foot is lifted and replaced', () => {
    const d = new StampDetector();
    expect(d.push(planted(0.5), 1000)).toBe(1);
    d.push(lifted, 1200);
    expect(d.push(planted(0.5), 1400)).toBe(1);
  });

  it('fires the new lane when the foot slides across without lifting', () => {
    const d = new StampDetector();
    expect(d.push(planted(0.15), 1000)).toBe(0);
    expect(d.push(planted(0.85), 1300)).toBe(2);
  });

  it('ignores a hover that never reaches the plant threshold', () => {
    const d = new StampDetector();
    expect(d.push({ coverage: 0.05, x: 0.5, y: 0.7 }, 1000)).toBeNull();
  });

  it('does not machine-gun when coverage jitters around the threshold', () => {
    const d = new StampDetector();
    expect(d.push(planted(0.5, 0.062), 1000)).toBe(1);
    // Dipping between exit and enter must not re-arm.
    expect(d.push(planted(0.5, 0.05), 1016)).toBeNull();
    expect(d.push(planted(0.5, 0.065), 1032)).toBeNull();
    expect(d.push(planted(0.5, 0.05), 1048)).toBeNull();
    expect(d.push(planted(0.5, 0.065), 1064)).toBeNull();
  });

  it('honours the refractory gap between stamps', () => {
    const d = new StampDetector(0.06, 0.035, 200);
    expect(d.push(planted(0.15), 1000)).toBe(0);
    d.push(lifted, 1050);
    // Too soon after the first stamp.
    expect(d.push(planted(0.85), 1100)).toBeNull();
    expect(d.push(planted(0.85), 1250)).toBe(2);
  });

  it('re-arms after reset', () => {
    const d = new StampDetector();
    d.push(planted(0.5), 1000);
    d.reset();
    expect(d.push(planted(0.5), 1016)).toBe(1);
  });
});
