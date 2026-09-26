/**
 * Calibrated foot tracking, without a model.
 *
 * Pose estimation would be the textbook answer, but the bundled detector is
 * EfficientDet-Lite on COCO — which has no foot, ankle or leg class — and
 * running any model per frame is what previously exhausted the camera's
 * buffer pool (see DetectorCamera.tsx). So this takes the other road: the
 * player points the camera at their own shoe once, we memorise its colour,
 * and from then on we look for that colour.
 *
 * The tracker never needs to know what a foot IS. It only needs to know what
 * THIS foot looks like, which is a far smaller question and answerable with
 * arithmetic over a downscaled frame.
 *
 * Everything here is pure so it can be tested without a camera or a device.
 */

/** Pixels are sampled from a frame downscaled to this square. */
export const SAMPLE_SIZE = 48;

/** The three lanes a foot can land in. */
export type Lane = 0 | 1 | 2;

/**
 * A memorised appearance, in normalised rg-chromaticity plus lightness.
 *
 * Chromaticity rather than raw RGB because a shoe moving across a floor
 * passes through shadow, and raw RGB would read that as a different object.
 * Dividing out total intensity keeps "blue shoe" stable from bright to dim.
 */
export interface FootSignature {
  /** r / (r+g+b), 0..1 */
  r: number;
  /** g / (r+g+b), 0..1 */
  g: number;
  /** Mean of r,g,b over 0..255, kept so black and white stay separable. */
  lightness: number;
  /** Spread seen during calibration; the match threshold scales with it. */
  spread: number;
}

export interface FootReading {
  /** Fraction of sampled pixels that matched, 0..1. */
  coverage: number;
  /** Horizontal centre of the matched pixels, 0..1, or null when nothing matched. */
  x: number | null;
  /** Vertical centre of the matched pixels, 0..1, or null when nothing matched. */
  y: number | null;
}

/**
 * Chromaticity of one pixel.
 *
 * Near-black pixels have no meaningful hue — r/(r+g+b) explodes into noise as
 * the denominator approaches zero — so they report a neutral third each and
 * are separated by lightness instead.
 */
export function chromaOf(r: number, g: number, b: number): {
  r: number;
  g: number;
  lightness: number;
} {
  const sum = r + g + b;
  const lightness = sum / 3 / 255;
  if (sum < 24) return { r: 1 / 3, g: 1 / 3, lightness };
  return { r: r / sum, g: g / sum, lightness };
}

/**
 * Builds a signature from the centre region of a calibration frame.
 *
 * Only the middle is sampled: the player is asked to put their foot in a
 * reticle, and including the edges would average the floor into the shoe.
 */
export function calibrate(
  rgb: Uint8Array | number[],
  size = SAMPLE_SIZE,
  /** Half-width of the centre box, as a fraction of the frame. */
  half = 0.18,
): FootSignature | null {
  const lo = Math.floor(size * (0.5 - half));
  const hi = Math.ceil(size * (0.5 + half));

  let n = 0;
  let sr = 0;
  let sg = 0;
  let sl = 0;

  for (let y = lo; y < hi; y++) {
    for (let x = lo; x < hi; x++) {
      const i = (y * size + x) * 3;
      const c = chromaOf(rgb[i], rgb[i + 1], rgb[i + 2]);
      sr += c.r;
      sg += c.g;
      sl += c.lightness;
      n++;
    }
  }

  if (n === 0) return null;

  const mr = sr / n;
  const mg = sg / n;
  const ml = sl / n;

  // Second pass for spread, so a mottled trainer gets a looser threshold
  // than a flat-coloured one.
  let variance = 0;
  for (let y = lo; y < hi; y++) {
    for (let x = lo; x < hi; x++) {
      const i = (y * size + x) * 3;
      const c = chromaOf(rgb[i], rgb[i + 1], rgb[i + 2]);
      variance += (c.r - mr) ** 2 + (c.g - mg) ** 2;
    }
  }

  const spread = Math.sqrt(variance / n);

  return { r: mr, g: mg, lightness: ml, spread };
}

/** How close a pixel must sit to the signature to count as the foot. */
export function toleranceFor(sig: FootSignature): number {
  // A floor of 0.035 keeps a perfectly flat colour from matching nothing due
  // to sensor noise; the cap stops a badly-calibrated signature matching the
  // entire room.
  return Math.min(0.12, Math.max(0.035, sig.spread * 2.5));
}

/**
 * Scans a frame for the memorised foot.
 *
 * Returns how much of the frame matched and where its centre of mass sits.
 * Coverage matters as much as position: a foot that has been planted fills a
 * large part of the view, whereas a stray pixel of similar colour does not.
 */
export function findFoot(
  rgb: Uint8Array | number[],
  sig: FootSignature,
  size = SAMPLE_SIZE,
): FootReading {
  const tol = toleranceFor(sig);
  const tolSq = tol * tol;

  let matched = 0;
  let sumX = 0;
  let sumY = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      const c = chromaOf(rgb[i], rgb[i + 1], rgb[i + 2]);

      const dr = c.r - sig.r;
      const dg = c.g - sig.g;
      if (dr * dr + dg * dg > tolSq) continue;

      // Lightness guards the near-neutral case, where chromaticity alone
      // cannot tell a white shoe from a grey floor.
      if (Math.abs(c.lightness - sig.lightness) > 0.34) continue;

      matched++;
      sumX += x;
      sumY += y;
    }
  }

  const total = size * size;
  if (matched === 0) return { coverage: 0, x: null, y: null };

  return {
    coverage: matched / total,
    x: sumX / matched / (size - 1),
    y: sumY / matched / (size - 1),
  };
}

/** Which third of the frame a horizontal position falls in. */
export function laneOf(x: number): Lane {
  if (x < 1 / 3) return 0;
  if (x < 2 / 3) return 1;
  return 2;
}

/**
 * Turns a stream of readings into discrete stamps.
 *
 * A foot held still over a lane must fire once, not once per frame, so this
 * is edge-triggered: coverage rising through `enter` is a stamp, and the lane
 * cannot fire again until coverage falls back below `exit`. The gap between
 * the two thresholds is hysteresis — without it, a foot hovering at exactly
 * the boundary would machine-gun the lane as coverage jittered.
 */
export class StampDetector {
  private armed = true;
  private lastLane: Lane | null = null;

  constructor(
    /** Coverage at which a foot counts as planted. */
    private readonly enter = 0.06,
    /** Coverage below which the foot counts as lifted. */
    private readonly exit = 0.035,
    /** Minimum gap between two stamps, in milliseconds. */
    private readonly refractoryMs = 120,
  ) {}

  private lastFiredAt = -Infinity;

  /**
   * Feeds one reading. Returns the lane to fire, or null.
   *
   * `now` is passed in rather than read from the clock so the behaviour is
   * deterministic under test.
   */
  push(reading: FootReading, now: number): Lane | null {
    if (reading.x == null || reading.coverage < this.exit) {
      // Foot lifted (or never there): re-arm for the next stamp.
      this.armed = true;
      this.lastLane = null;
      return null;
    }

    if (reading.coverage < this.enter) return null;
    if (!this.armed) {
      // Still planted from the previous stamp. Sliding sideways to a new
      // lane without lifting counts as a fresh stamp, which is how a player
      // shuffling along the three pads expects it to behave.
      const lane = laneOf(reading.x);
      if (lane !== this.lastLane && now - this.lastFiredAt >= this.refractoryMs) {
        this.lastLane = lane;
        this.lastFiredAt = now;
        return lane;
      }
      return null;
    }

    if (now - this.lastFiredAt < this.refractoryMs) return null;

    const lane = laneOf(reading.x);
    this.armed = false;
    this.lastLane = lane;
    this.lastFiredAt = now;
    return lane;
  }

  reset(): void {
    this.armed = true;
    this.lastLane = null;
    this.lastFiredAt = -Infinity;
  }
}
