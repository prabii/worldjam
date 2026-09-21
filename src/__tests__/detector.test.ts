import {
  DetectionTracker,
  MAX_DETECTIONS,
  MIN_SCORE,
  parseDetections,
} from '@/vision/detector';
import { categoryForCocoClass, roleInfoFor } from '@/vision/objectRoles';
import { COCO_LABELS, labelForIndex } from '@/vision/cocoLabels';

/**
 * EfficientDet returns boxes as [y1, x1, y2, x2] — y first. Building the
 * fixtures in that order is the point: if the parser ever assumes x-first,
 * these tests catch it, and the alternative is labels drawn in the wrong
 * place on a real device with no error anywhere.
 */
function boxesFor(...rects: Array<[number, number, number, number]>): number[] {
  // Each rect given as [x1, y1, x2, y2] for readability, emitted y-first.
  return rects.flatMap(([x1, y1, x2, y2]) => [y1, x1, y2, x2]);
}

/** COCO index for a class name, so fixtures read clearly. */
function idx(name: string): number {
  for (let i = 0; i < COCO_LABELS.length; i++) {
    if (labelForIndex(i) === name) return i;
  }
  throw new Error(`no COCO index for ${name}`);
}

describe('cocoLabels', () => {
  it('maps the indices the product depends on', () => {
    expect(labelForIndex(idx('cup'))).toBe('cup');
    expect(labelForIndex(idx('bottle'))).toBe('bottle');
    expect(labelForIndex(idx('laptop'))).toBe('laptop');
    expect(labelForIndex(idx('potted plant'))).toBe('potted plant');
  });

  /**
   * The exact numbers EfficientDet-Lite emits, pinned literally.
   *
   * These were wrong once: the list was built from COCO's 91-entry "paper"
   * ordering while the model emits the 80-entry contiguous one, so every
   * label past the first gap was shifted and a phone was reported as a
   * laptop. Nothing threw — writing the indices out by hand is the only way
   * that stays caught.
   */
  it('uses the 80-class contiguous ordering the model emits', () => {
    expect(labelForIndex(0)).toBe('person');
    expect(labelForIndex(39)).toBe('bottle');
    expect(labelForIndex(41)).toBe('cup');
    expect(labelForIndex(56)).toBe('chair');
    expect(labelForIndex(58)).toBe('potted plant');
    expect(labelForIndex(60)).toBe('dining table');
    expect(labelForIndex(63)).toBe('laptop');
    expect(labelForIndex(66)).toBe('keyboard');
    expect(labelForIndex(67)).toBe('cell phone');
    expect(labelForIndex(79)).toBe('toothbrush');
  });

  it('has exactly 80 classes, not 91', () => {
    expect(COCO_LABELS).toHaveLength(80);
  });

  it('has no placeholder at index 0 — the model is 0-based over this list', () => {
    expect(COCO_LABELS[0]).not.toMatch(/unlabeled|background/i);
  });

  it('returns unknown for an out-of-range index', () => {
    expect(labelForIndex(999)).toBe('unknown');
  });
});

describe('objectRoles', () => {
  it('maps the mockup objects to their stated roles', () => {
    expect(roleInfoFor('cup').display).toBe('Percussion');
    expect(roleInfoFor('bottle').display).toBe('Hit');
    expect(roleInfoFor('table').display).toBe('Bass');
    expect(roleInfoFor('laptop').display).toBe('Synth');
    expect(roleInfoFor('keys').display).toBe('Clicks');
    expect(roleInfoFor('plant').display).toBe('Ambient');
  });

  it('maps COCO names to categories', () => {
    expect(categoryForCocoClass('cup')).toBe('cup');
    expect(categoryForCocoClass('potted plant')).toBe('plant');
    expect(categoryForCocoClass('dining table')).toBe('table');
    expect(categoryForCocoClass('wine glass')).toBe('glass');
  });

  it('is case-insensitive', () => {
    expect(categoryForCocoClass('CUP')).toBe('cup');
  });

  it('returns null for classes with no musical mapping', () => {
    expect(categoryForCocoClass('giraffe')).toBeNull();
    expect(categoryForCocoClass('person')).toBeNull();
  });

  it('gives every category traits and a blurb', () => {
    for (const cat of ['cup', 'bottle', 'table', 'laptop', 'keys', 'plant'] as const) {
      const info = roleInfoFor(cat);
      expect(info.traits.length).toBeGreaterThan(0);
      expect(info.blurb.length).toBeGreaterThan(0);
      expect(info.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe('parseDetections', () => {
  it('decodes a y-first box into x-first screen coordinates', () => {
    const dets = parseDetections(
      boxesFor([0.2, 0.3, 0.6, 0.8]),
      [idx('cup')],
      [0.9],
      1,
    );

    expect(dets).toHaveLength(1);
    expect(dets[0].box.x).toBeCloseTo(0.2, 5);
    expect(dets[0].box.y).toBeCloseTo(0.3, 5);
    expect(dets[0].box.width).toBeCloseTo(0.4, 5);
    expect(dets[0].box.height).toBeCloseTo(0.5, 5);
  });

  it('attaches the musical role', () => {
    const [det] = parseDetections(
      boxesFor([0.1, 0.1, 0.5, 0.5]),
      [idx('bottle')],
      [0.8],
      1,
    );
    expect(det.displayName).toBe('Bottle');
    expect(det.role.display).toBe('Hit');
  });

  it('drops detections below the confidence floor', () => {
    const dets = parseDetections(
      boxesFor([0.1, 0.1, 0.5, 0.5]),
      [idx('cup')],
      [MIN_SCORE - 0.01],
      1,
    );
    expect(dets).toHaveLength(0);
  });

  it('drops classes with no musical mapping', () => {
    const dets = parseDetections(
      boxesFor([0.1, 0.1, 0.5, 0.5]),
      [idx('person')],
      [0.99],
      1,
    );
    expect(dets).toHaveLength(0);
  });

  it('drops degenerate boxes', () => {
    const dets = parseDetections(
      boxesFor([0.5, 0.5, 0.505, 0.505]),
      [idx('cup')],
      [0.9],
      1,
    );
    expect(dets).toHaveLength(0);
  });

  it('clamps boxes that extend past the frame', () => {
    const [det] = parseDetections(
      boxesFor([-0.1, -0.2, 1.3, 1.4]),
      [idx('cup')],
      [0.9],
      1,
    );
    expect(det.box.x).toBeGreaterThanOrEqual(0);
    expect(det.box.y).toBeGreaterThanOrEqual(0);
    expect(det.box.x + det.box.width).toBeLessThanOrEqual(1.0001);
    expect(det.box.y + det.box.height).toBeLessThanOrEqual(1.0001);
  });

  it('returns the strongest detections first', () => {
    const dets = parseDetections(
      boxesFor([0.1, 0.1, 0.3, 0.3], [0.5, 0.5, 0.7, 0.7]),
      [idx('cup'), idx('bottle')],
      [0.6, 0.95],
      2,
    );
    expect(dets[0].className).toBe('bottle');
  });

  it('caps how many labels are shown at once', () => {
    const many = Array.from({ length: 20 }, (_, i) => [
      0.05 * i,
      0.05,
      0.05 * i + 0.1,
      0.2,
    ]) as Array<[number, number, number, number]>;

    const dets = parseDetections(
      boxesFor(...many),
      many.map(() => idx('cup')),
      many.map(() => 0.9),
      many.length,
    );
    expect(dets.length).toBeLessThanOrEqual(MAX_DETECTIONS);
  });

  it('respects the reported count over the array length', () => {
    const dets = parseDetections(
      boxesFor([0.1, 0.1, 0.3, 0.3], [0.5, 0.5, 0.7, 0.7]),
      [idx('cup'), idx('cup')],
      [0.9, 0.9],
      1,
    );
    expect(dets).toHaveLength(1);
  });

  it('handles an empty frame', () => {
    expect(parseDetections([], [], [], 0)).toEqual([]);
  });
});

describe('DetectionTracker', () => {
  const cup = (x: number, y: number, score = 0.9) =>
    parseDetections(boxesFor([x, y, x + 0.2, y + 0.2]), [idx('cup')], [score], 1);

  it('keeps a detection alive across a dropped frame', () => {
    const t = new DetectionTracker();
    t.update(cup(0.3, 0.3));
    const afterGap = t.update([]);
    expect(afterGap).toHaveLength(1);
  });

  it('eventually forgets an object that has gone', () => {
    const t = new DetectionTracker();
    t.update(cup(0.3, 0.3));
    for (let i = 0; i < 12; i++) t.update([]);
    expect(t.size).toBe(0);
  });

  it('treats a small movement as the same object', () => {
    const t = new DetectionTracker();
    t.update(cup(0.3, 0.3));
    t.update(cup(0.33, 0.32));
    expect(t.size).toBe(1);
  });

  it('treats a large jump as a new object', () => {
    const t = new DetectionTracker();
    t.update(cup(0.1, 0.1));
    t.update(cup(0.8, 0.8));
    expect(t.size).toBe(2);
  });

  it('eases the box toward its new position rather than snapping', () => {
    const t = new DetectionTracker();
    t.update(cup(0.3, 0.3));
    const [moved] = t.update(cup(0.4, 0.3));
    // Smoothed, so it lands between the old and new positions.
    expect(moved.box.x).toBeGreaterThan(0.3);
    expect(moved.box.x).toBeLessThan(0.4);
  });

  it('clear() empties the tracker', () => {
    const t = new DetectionTracker();
    t.update(cup(0.3, 0.3));
    t.clear();
    expect(t.size).toBe(0);
  });
});

describe('tensor-shaped input', () => {
  /**
   * The frame processor copies native output tensors into plain arrays before
   * crossing the worklet bridge. It did not originally, and the objects that
   * arrived had `length` undefined, so every detection was silently dropped —
   * no error, no labels, on device only. These pin the shapes the parser must
   * accept and what it does when they are wrong.
   */
  it('accepts Float32Array output, as the model actually returns', () => {
    const boxes = new Float32Array([0.3, 0.2, 0.7, 0.6]);
    const classes = new Float32Array([idx('cup')]);
    const scores = new Float32Array([0.9]);
    const dets = parseDetections(boxes, classes, scores, 1);
    expect(dets).toHaveLength(1);
    expect(dets[0].className).toBe('cup');
  });

  it('returns nothing rather than throwing on an empty buffer', () => {
    expect(parseDetections(new Float32Array(), new Float32Array(), new Float32Array(), 0))
      .toEqual([]);
  });

  it('never reads past the scores it was given', () => {
    // A count larger than the data is exactly what a mis-read count tensor
    // produces; it must not invent detections from undefined entries.
    const dets = parseDetections(
      new Float32Array([0.3, 0.2, 0.7, 0.6]),
      new Float32Array([idx('cup')]),
      new Float32Array([0.9]),
      25,
    );
    expect(dets).toHaveLength(1);
  });
});
