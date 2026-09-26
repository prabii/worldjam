import type { ObjectCategory } from '@/types';
import type { CaptureTarget } from '../../modules/worldjam-vision/src';
import { categoryFor } from './objectCategory';

/**
 * What a new capture is called and where it sits.
 *
 * With a detected target the capture is named after it ("Laptop"). Without
 * one the label is the store's sentinel 'Object', which makes the store name
 * the capture from its sound instead (Tick / Chime / Boom…).
 */
export interface CaptureNaming {
  label: string;
  category: ObjectCategory;
  fromDetection: boolean;
}

export const UNNAMED_SENTINEL = 'Object';

export function namingFor(target: CaptureTarget | null | undefined): CaptureNaming {
  const label = target?.trackId ? target.spokenLabel?.trim() : undefined;
  if (!label) return { label: UNNAMED_SENTINEL, category: 'unknown', fromDetection: false };
  return { label, category: categoryFor(target?.label ?? label), fromDetection: true };
}

/** The 3-second notice and the optional spoken line when several objects are in view. */
export function multipleObjectsMessage(target: CaptureTarget | null | undefined): string | null {
  if (!target?.trackId || !target.multipleObjectsDetected || !target.spokenLabel) return null;
  const n = target.objectCount;
  return `${n} objects detected. Using the closest one: ${target.spokenLabel}.`;
}

/**
 * Whether a target change deserves a new multiple-objects notice: only when
 * the chosen object or the "several objects" state changes, never for the same
 * situation twice in a row.
 */
export function noticeKey(target: CaptureTarget | null | undefined): string | null {
  if (!target?.trackId || !target.multipleObjectsDetected) return null;
  return `${target.trackId}`;
}
