import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  WorldVision,
  isWorldVisionAvailable,
  type CaptureTarget,
  type VisionObjectSummary,
  type VisionStatus,
} from '../../../modules/worldjam-vision/src';

/**
 * Vision in capture mode: the native pipeline tracks objects and picks the
 * closest one (depth model, or the object the user tapped). It never speaks by
 * itself here — the capture screen decides what to announce.
 */
export function useCaptureTarget(active: boolean) {
  const [target, setTarget] = useState<CaptureTarget | null>(null);
  const [objects, setObjects] = useState<VisionObjectSummary[]>([]);
  const [status, setStatus] = useState<VisionStatus>(() => WorldVision.getBackend());
  const targetRef = useRef<CaptureTarget | null>(null);

  useEffect(() => {
    if (!isWorldVisionAvailable) return;
    const subs = [
      WorldVision.addListener('onCaptureTarget', (t) => {
        const next = t.trackId ? t : null;
        targetRef.current = next;
        setTarget(next);
      }),
      WorldVision.addListener('onVisionState', (s) => setObjects(s.objects)),
      WorldVision.addListener('onStatus', setStatus),
    ];
    setStatus(WorldVision.initialize());
    return () => subs.forEach((s) => s.remove());
  }, []);

  useEffect(() => {
    if (!isWorldVisionAvailable) return;
    const apply = (fg: boolean) => {
      if (active && fg) {
        WorldVision.setMode('capture');
        WorldVision.startDetection();
      } else {
        WorldVision.stopDetection();
      }
    };
    apply(AppState.currentState === 'active');
    const sub = AppState.addEventListener('change', (s) => apply(s === 'active'));
    return () => {
      sub.remove();
      WorldVision.stopDetection();
      WorldVision.clearFocusPoint();
    };
  }, [active]);

  /** Freezes the current target, e.g. at the moment recording starts (the hand may then cover it). */
  const snapshot = useCallback((): CaptureTarget | null => targetRef.current, []);

  const focus = useCallback((x: number, y: number) => WorldVision.setFocusPoint(x, y), []);
  const clearFocus = useCallback(() => WorldVision.clearFocusPoint(), []);

  return { available: isWorldVisionAvailable, target, objects, status, snapshot, focus, clearFocus };
}
