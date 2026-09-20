/**
 * Turns 3D world positions into what you hear.
 *
 * This is the foundation the accessibility layer stands on: a blind user
 * cannot see a label over the mug, but if the mug's sound genuinely arrives
 * from their left and sounds close, the room becomes navigable by ear. The
 * same maths drives the visual AR, so the two never disagree.
 *
 * Deliberately simple: amplitude panning plus distance attenuation, not
 * HRTF convolution. On a phone speaker or cheap earbuds the difference is
 * inaudible, and the CPU saved matters far more given the <50 ms budget.
 */

export interface Pose {
  /** Camera position in world metres. */
  x: number;
  y: number;
  z: number;
  /** Camera orientation as a quaternion. */
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface SpatialResult {
  /** 0 = hard left, 1 = hard right. */
  pan: number;
  /** Gain multiplier from distance, 0..1. */
  gain: number;
  /** Metres from listener to source. */
  distance: number;
  /** Radians, signed: negative = left, positive = right, 0 = straight ahead. */
  azimuth: number;
  /** True when the source is behind the listener. */
  behind: boolean;
}

/** Beyond this a source is effectively inaudible. */
export const MAX_AUDIBLE_DISTANCE = 12;
/** Inside this radius there is no attenuation, avoiding a blast up close. */
const NEAR_FIELD = 0.5;

/**
 * Rotates a world-space vector into the listener's frame.
 *
 * Uses the conjugate of the camera quaternion: rotating the world by the
 * inverse camera rotation is equivalent to expressing it in camera space.
 */
function worldToListener(
  dx: number,
  dy: number,
  dz: number,
  pose: Pose,
): { x: number; y: number; z: number } {
  // Conjugate (inverse for a unit quaternion).
  const qx = -pose.qx;
  const qy = -pose.qy;
  const qz = -pose.qz;
  const qw = pose.qw;

  // v' = q * v * q^-1, expanded.
  const ix = qw * dx + qy * dz - qz * dy;
  const iy = qw * dy + qz * dx - qx * dz;
  const iz = qw * dz + qx * dy - qy * dx;
  const iw = -qx * dx - qy * dy - qz * dz;

  return {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
    y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
  };
}

/**
 * Computes pan and gain for a source at a world position, heard from a pose.
 *
 * ARCore's camera space is right-handed with -Z forward and +X right, which is
 * what the azimuth calculation below assumes.
 */
export function spatialize(
  source: { x: number; y: number; z: number },
  pose: Pose,
): SpatialResult {
  const dx = source.x - pose.x;
  const dy = source.y - pose.y;
  const dz = source.z - pose.z;

  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  const local = worldToListener(dx, dy, dz, pose);

  // -Z is forward, so forward distance is -local.z.
  const forward = -local.z;
  const right = local.x;

  // atan2(right, forward): 0 ahead, +pi/2 right, -pi/2 left.
  const azimuth = Math.atan2(right, forward);
  const behind = forward < 0;

  // Sine panning law: constant perceived power as a source crosses the field.
  // sin of the azimuth gives -1..1 for left..right; map to 0..1.
  const lateral = Math.sin(azimuth);
  let pan = (lateral + 1) / 2;

  // A source behind the listener is pulled toward centre. Without this, a
  // sound directly behind pans identically to one directly ahead, which is
  // the classic front/back confusion — worse for a user relying on hearing.
  if (behind) {
    pan = 0.5 + (pan - 0.5) * 0.6;
  }

  // Inverse-distance rolloff, clamped near the listener.
  const d = Math.max(NEAR_FIELD, distance);
  let gain = NEAR_FIELD / d;

  // Fade the last few metres to silence so distant objects do not linger
  // faintly forever.
  if (distance > MAX_AUDIBLE_DISTANCE * 0.7) {
    const fade =
      1 -
      (distance - MAX_AUDIBLE_DISTANCE * 0.7) / (MAX_AUDIBLE_DISTANCE * 0.3);
    gain *= Math.max(0, fade);
  }

  return {
    pan: Math.min(1, Math.max(0, pan)),
    gain: Math.min(1, Math.max(0, gain)),
    distance,
    azimuth,
    behind,
  };
}

/**
 * Describes a direction in words, for spoken guidance.
 *
 * Coarse buckets on purpose: "slightly left" is actionable, "at 23 degrees"
 * is not, and a person turning toward a sound does not need precision.
 */
export function describeDirection(result: SpatialResult): string {
  const deg = (result.azimuth * 180) / Math.PI;
  const abs = Math.abs(deg);

  let side: string;
  if (abs < 12) side = 'straight ahead';
  else if (abs < 45) side = deg < 0 ? 'slightly left' : 'slightly right';
  else if (abs < 100) side = deg < 0 ? 'to your left' : 'to your right';
  else side = deg < 0 ? 'behind you, left' : 'behind you, right';

  let range: string;
  if (result.distance < 0.6) range = 'very close';
  else if (result.distance < 1.5) range = 'close';
  else if (result.distance < 3) range = 'a step away';
  else range = 'far';

  return `${side}, ${range}`;
}

/** Parses the flat [tx,ty,tz,qx,qy,qz,qw] array from the native bridge. */
export function parsePose(raw: number[]): Pose | null {
  if (raw.length < 7) return null;
  return {
    x: raw[0],
    y: raw[1],
    z: raw[2],
    qx: raw[3],
    qy: raw[4],
    qz: raw[5],
    qw: raw[6],
  };
}

/** One anchor's projected screen position, parsed from the native flat array. */
export interface ProjectedAnchor {
  id: string;
  screenX: number;
  screenY: number;
  distance: number;
  visible: boolean;
}

/** Parses the flat [id, x, y, distance, visible] array from the bridge. */
export function parseProjections(raw: Array<string | number>): ProjectedAnchor[] {
  const out: ProjectedAnchor[] = [];
  for (let i = 0; i + 4 < raw.length; i += 5) {
    out.push({
      id: String(raw[i]),
      screenX: Number(raw[i + 1]),
      screenY: Number(raw[i + 2]),
      distance: Number(raw[i + 3]),
      visible: Number(raw[i + 4]) === 1,
    });
  }
  return out;
}
