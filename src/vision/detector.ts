import type { ObjectCategory } from '@/types';
import { labelForIndex } from './cocoLabels';
import { categoryForCocoClass, displayNameFor, roleInfoFor, type RoleInfo } from './objectRoles';

/**
 * Object detection results and the logic that turns raw model output into
 * something the UI can show.
 *
 * The model runs on a background worklet; everything here is pure so it can be
 * tested without a camera, a GPU, or a device.
 */

export interface Detection {
  /** Stable id, so a label does not flicker between frames. */
  id: string;
  /** Raw COCO class name, e.g. "cup". */
  className: string;
  /** Our category, or 'unknown' when we have no mapping. */
  category: ObjectCategory;
  /** Display name and musical role, for the overlay. */
  displayName: string;
  role: RoleInfo;
  /** Confidence, 0..1. */
  score: number;
  /** Bounding box in normalised coordinates (0..1), origin top-left. */
  box: { x: number; y: number; width: number; height: number };
}

/**
 * Minimum confidence to show a label.
 *
 * Deliberately high. A flickering low-confidence guess reads as the app being
 * broken, whereas showing nothing reads as "point it at something" — and the
 * user can always record without a detection.
 */
export const MIN_SCORE = 0.45;

/** Most labels we ever show at once, to keep the overlay readable. */
export const MAX_DETECTIONS = 6;

/**
 * Parses EfficientDet-Lite's four output tensors.
 *
 * The model returns, in order: boxes [1,N,4] as [y1,x1,y2,x2] normalised,
 * class indices [1,N], scores [1,N], and the detection count [1]. That box
 * ordering is y-first, which is the opposite of what almost every UI expects,
 * and getting it backwards silently renders every label in the wrong place.
 */
export function parseDetections(
  boxes: Float32Array | number[],
  classes: Float32Array | number[],
  scores: Float32Array | number[],
  count: number,
): Detection[] {
  const out: Detection[] = [];
  const n = Math.min(Math.round(count), Math.floor(scores.length));

  for (let i = 0; i < n; i++) {
    const score = scores[i];
    if (!Number.isFinite(score) || score < MIN_SCORE) continue;

    const className = labelForIndex(classes[i]);
    const category = categoryForCocoClass(className);

    // Only surface objects we can actually make an instrument from. A label
    // saying "person" or "chair" teaches the user nothing about the product.
    if (!category) continue;

    const y1 = boxes[i * 4];
    const x1 = boxes[i * 4 + 1];
    const y2 = boxes[i * 4 + 2];
    const x2 = boxes[i * 4 + 3];

    const x = Math.max(0, Math.min(1, x1));
    const y = Math.max(0, Math.min(1, y1));
    const width = Math.max(0, Math.min(1 - x, x2 - x1));
    const height = Math.max(0, Math.min(1 - y, y2 - y1));

    // A degenerate box means a bad decode; showing it would draw a label at
    // the corner of the screen attached to nothing.
    if (width < 0.02 || height < 0.02) continue;

    out.push({
      id: `${className}-${Math.round(x * 100)}-${Math.round(y * 100)}`,
      className,
      category,
      displayName: displayNameFor(category),
      role: roleInfoFor(category),
      score,
      box: { x, y, width, height },
    });
  }

  // Strongest first, so the most confident labels survive the cap.
  return out.sort((a, b) => b.score - a.score).slice(0, MAX_DETECTIONS);
}

/**
 * Smooths detections across frames.
 *
 * Raw per-frame output jitters: a cup detected at 0.52 one frame and 0.43 the
 * next would make its label blink. This keeps a detection alive for a few
 * frames after it disappears and eases its box toward the new position, which
 * is the difference between labels that track an object and labels that
 * strobe.
 */
export class DetectionTracker {
  private tracked = new Map<string, { det: Detection; missedFrames: number }>();

  /** Frames a detection survives without being seen again. */
  private readonly maxMissed = 8;
  /** How quickly a box moves toward its new position, 0..1. */
  private readonly smoothing = 0.35;

  update(detections: Detection[]): Detection[] {
    const seen = new Set<string>();

    for (const det of detections) {
      // Match by class and rough position rather than exact id, so an object
      // that drifts a few pixels is the same object.
      const existing = this.findMatch(det);

      if (existing) {
        seen.add(existing.det.id);
        const prev = existing.det.box;
        const next = det.box;
        existing.det = {
          ...det,
          id: existing.det.id,
          box: {
            x: prev.x + (next.x - prev.x) * this.smoothing,
            y: prev.y + (next.y - prev.y) * this.smoothing,
            width: prev.width + (next.width - prev.width) * this.smoothing,
            height: prev.height + (next.height - prev.height) * this.smoothing,
          },
        };
        existing.missedFrames = 0;
      } else {
        seen.add(det.id);
        this.tracked.set(det.id, { det, missedFrames: 0 });
      }
    }

    // Age out anything not seen this frame.
    for (const [id, entry] of this.tracked) {
      if (seen.has(id)) continue;
      entry.missedFrames++;
      if (entry.missedFrames > this.maxMissed) this.tracked.delete(id);
    }

    return [...this.tracked.values()].map((e) => e.det);
  }

  private findMatch(det: Detection) {
    for (const entry of this.tracked.values()) {
      if (entry.det.className !== det.className) continue;
      const dx = entry.det.box.x - det.box.x;
      const dy = entry.det.box.y - det.box.y;
      // Within 20% of the frame counts as the same object moving.
      if (Math.hypot(dx, dy) < 0.2) return entry;
    }
    return null;
  }

  clear(): void {
    this.tracked.clear();
  }

  get size(): number {
    return this.tracked.size;
  }
}
