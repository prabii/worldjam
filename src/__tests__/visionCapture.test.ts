import { coverMap } from '@/vision/geometry';
import { categoryFor } from '@/vision/objectCategory';
import { multipleObjectsMessage, namingFor, noticeKey, UNNAMED_SENTINEL } from '@/vision/captureNaming';
import type { CaptureTarget } from '../../modules/worldjam-vision/src';

const target = (over: Partial<CaptureTarget> = {}): CaptureTarget => ({
  trackId: 'track_3',
  label: 'laptop',
  spokenLabel: 'Laptop',
  bbox: { x: 0.2, y: 0.3, width: 0.4, height: 0.2 },
  depth: 0.8,
  method: 'depth',
  objectCount: 1,
  multipleObjectsDetected: false,
  others: [],
  ...over,
});

describe('coverMap', () => {
  it('maps a portrait frame into a taller view by cropping the sides', () => {
    // 9:16 frame in a 1000x2000 view (1:2): scaled to height, 1125 wide, 62.5 px cropped each side.
    const m = coverMap(1000, 2000, 9 / 16);
    const b = m.boxToView({ x: 0.5, y: 0.25, width: 0.1, height: 0.1 });
    expect(b.x).toBeCloseTo(-62.5 + 562.5, 3);
    expect(b.y).toBeCloseTo(500, 3);
    expect(b.width).toBeCloseTo(112.5, 3);
  });

  it('round-trips points between view and frame', () => {
    const m = coverMap(1080, 1500, 9 / 16);
    const f = m.pointToFrame(0.3, 0.7);
    const v = m.pointToView(f.x, f.y);
    expect(v.x).toBeCloseTo(0.3, 5);
    expect(v.y).toBeCloseTo(0.7, 5);
  });

  it('accounts for the crop: the top of a square view is below the top of a 9:16 frame', () => {
    // Frame scaled to 1000 wide → 1777.8 tall, 388.9 px cropped above and below.
    const m = coverMap(1000, 1000, 9 / 16);
    const f = m.pointToFrame(0, 0);
    expect(f.x).toBeCloseTo(0, 5);
    expect(f.y).toBeCloseTo(388.888 / 1777.777, 4);
    const back = m.pointToView(0.5, 0);
    expect(back.y).toBe(0); // clamped: frame top is off-screen
  });
});

describe('categoryFor', () => {
  it.each([
    ['cup', 'cup'],
    ['mug', 'cup'],
    ['water bottle', 'bottle'],
    ['keys', 'keys'],
    ['phone', 'phone'],
    ['cell phone', 'phone'],
    ['desk', 'table'],
    ['plant', 'plant'],
    ['watch', 'unknown'],
    ['pen', 'unknown'],
  ])('%s → %s', (label, cat) => {
    expect(categoryFor(label)).toBe(cat);
  });

  it('handles empty input', () => {
    expect(categoryFor(undefined)).toBe('unknown');
    expect(categoryFor('')).toBe('unknown');
  });
});

describe('namingFor', () => {
  it('names the capture after the detected object', () => {
    expect(namingFor(target())).toEqual({ label: 'Laptop', category: 'laptop', fromDetection: true });
  });

  it('falls back to the store sentinel so the sound names itself', () => {
    expect(namingFor(null)).toEqual({ label: UNNAMED_SENTINEL, category: 'unknown', fromDetection: false });
    expect(namingFor(target({ trackId: null }))).toEqual({
      label: UNNAMED_SENTINEL,
      category: 'unknown',
      fromDetection: false,
    });
  });
});

describe('multiple-objects notice', () => {
  it('is silent for a single object', () => {
    expect(multipleObjectsMessage(target())).toBeNull();
    expect(noticeKey(target())).toBeNull();
  });

  it('names the count and the closest object', () => {
    const t = target({ objectCount: 3, multipleObjectsDetected: true, others: ['Cup', 'Pen'] });
    expect(multipleObjectsMessage(t)).toBe('3 objects detected. Using the closest one: Laptop.');
    expect(noticeKey(t)).toBe('track_3');
  });

  it('keys on the chosen object, so the same situation is not repeated', () => {
    const a = target({ objectCount: 2, multipleObjectsDetected: true });
    const b = target({ objectCount: 3, multipleObjectsDetected: true });
    expect(noticeKey(a)).toBe(noticeKey(b));
    expect(noticeKey(target({ trackId: 'track_9', objectCount: 2, multipleObjectsDetected: true }))).not.toBe(noticeKey(a));
  });
});
