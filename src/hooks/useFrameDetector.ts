import { useCallback, useEffect, useRef } from 'react';
import { runOnFrame, loadDetector } from '@/vision/nativeDetector';

/**
 * Wires camera frames into the detector.
 *
 * Detection is throttled rather than run on every frame. EfficientDet-Lite
 * takes 80–150ms per inference on a mid-range phone, so at 30fps the queue
 * would grow without bound and the preview would stutter — the camera and the
 * model would be fighting for the same cores. Roughly four inferences a second
 * is enough for labels that track an object a person is holding still enough
 * to tap.
 */
const MIN_INTERVAL_MS = 250;

export function useFrameDetector(enabled: boolean) {
  const lastRun = useRef(0);

  useEffect(() => {
    if (enabled) void loadDetector();
  }, [enabled]);

  /**
   * Called from the frame processor with an already-resized 320x320 RGB
   * buffer. Returns immediately when a run is still within the throttle
   * window, so the camera thread is never blocked waiting on inference.
   */
  const onFrame = useCallback(
    (input: Uint8Array) => {
      if (!enabled) return;
      const now = Date.now();
      if (now - lastRun.current < MIN_INTERVAL_MS) return;
      lastRun.current = now;
      runOnFrame(input);
    },
    [enabled],
  );

  return { onFrame };
}
