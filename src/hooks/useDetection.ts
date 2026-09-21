import { useEffect, useRef, useState } from 'react';
import { DetectionTracker, type Detection } from '@/vision/detector';

/**
 * Live object detection for the scan viewfinder.
 *
 * The detector runs natively on camera frames and pushes results here. Until
 * that native frame processor is compiled into the app, `ready` stays false
 * and the hook returns an empty list — the scan screen then falls back to
 * "hold anywhere to record", which is the behaviour the product needs anyway
 * for objects the model has never seen.
 *
 * Keeping this behind one hook means the screen does not care which of those
 * two worlds it is in.
 */

export interface DetectionState {
  detections: Detection[];
  /** True once the model is loaded and frames are being processed. */
  ready: boolean;
  error: string | null;
}

/**
 * The native frame processor, when the build includes it.
 *
 * Resolved lazily and defensively: a missing native module must degrade to
 * "no detections" rather than throw at import time and take the whole screen
 * down with it.
 */
function loadNativeDetector(): { subscribe: (cb: (d: Detection[]) => void) => () => void } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@/vision/nativeDetector');
    return mod?.default ?? mod ?? null;
  } catch {
    return null;
  }
}

export function useDetection(enabled: boolean): DetectionState {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One tracker for the lifetime of the hook, so smoothing survives re-renders.
  const tracker = useRef(new DetectionTracker());

  useEffect(() => {
    if (!enabled) {
      tracker.current.clear();
      setDetections([]);
      setReady(false);
      return;
    }

    const native = loadNativeDetector();
    if (!native) {
      setReady(false);
      setError('on-device detector not in this build');
      return;
    }

    setError(null);
    setReady(true);

    const unsubscribe = native.subscribe((raw) => {
      setDetections(tracker.current.update(raw));
    });

    return () => {
      unsubscribe();
      tracker.current.clear();
    };
  }, [enabled]);

  return { detections, ready, error };
}
