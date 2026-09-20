import { useCallback, useEffect, useRef, useState } from 'react';
import WorldJamAudio from 'worldjam-audio';
import { parsePose, parseProjections, type ProjectedAnchor, type Pose } from '@/audio/spatial';

/**
 * Drives the ARCore session and polls anchor positions each frame.
 *
 * DISABLED BY DEFAULT. ARCore's C API requires a GL context with a camera
 * texture bound before Session.update() is called; this hook drives update()
 * from a JS timer with neither, and ARCore segfaults inside libarcore_c.so
 * (SIGSEGV in its tango_pool thread) rather than returning an error. That
 * crash takes the whole app down about two seconds after launch.
 *
 * Doing this properly needs a GLSurfaceView rendering the camera feed and
 * driving update() from its render thread - a real piece of work, and exactly
 * the Tier 3 risk HLD v2 S2 warns about. Until then the app uses the 2D
 * placement path, which costs nothing and cannot crash.
 *
 * The polling rate is deliberately below display rate: anchor positions feed
 * label placement and audio panning, and at 20 Hz neither reads as laggy while
 * the bridge cost stays modest. Pushing this to 60 Hz measurably competes with
 * the audio path for CPU, which is the one thing that must never happen.
 *
 * Returns tracking state and positions; when AR is unavailable the hook simply
 * reports `supported: false` and the UI falls back to 2D placement. HLD v2 §2
 * requires AR to be removable, and that includes it being absent.
 */

const POLL_HZ = 20;

/**
 * Master switch. Turning this on without first adding a GL render thread
 * will crash the app on launch - see the note above.
 */
const AR_ENABLED = false;

export interface ArState {
  /** ARCore exists and a session was created. */
  supported: boolean;
  /** Camera pose is currently locked — anchors are meaningful. */
  tracking: boolean;
  /** Screen positions for each anchored object, keyed by object id. */
  anchors: Map<string, ProjectedAnchor>;
  /** Current camera pose, for spatial audio. */
  pose: Pose | null;
  error: string | null;
}

export function useArTracking(
  enabled: boolean,
  viewWidth: number,
  viewHeight: number,
): ArState & {
  createAnchor: (id: string, screenX: number, screenY: number) => boolean;
  removeAnchor: (id: string) => void;
} {
  const [supported, setSupported] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [anchors, setAnchors] = useState<Map<string, ProjectedAnchor>>(new Map());
  const [pose, setPose] = useState<Pose | null>(null);
  const [error, setError] = useState<string | null>(null);

  const started = useRef(false);

  // --- session lifecycle ---
  useEffect(() => {
    if (!enabled || !AR_ENABLED) {
      setSupported(false);
      setError(
        AR_ENABLED ? null : 'AR needs a GL render thread; using 2D placement',
      );
      return;
    }

    const ok = WorldJamAudio.arSupported();
    setSupported(ok);
    if (!ok) {
      setError(WorldJamAudio.arLastError() ?? 'ARCore not available');
      return;
    }

    if (WorldJamAudio.arStart()) {
      WorldJamAudio.arResume();
      started.current = true;
      setError(null);
    } else {
      setError(WorldJamAudio.arLastError() ?? 'Could not start AR');
      setSupported(false);
    }

    return () => {
      if (started.current) {
        WorldJamAudio.arPause();
        WorldJamAudio.arStop();
        started.current = false;
      }
    };
  }, [enabled]);

  // Tell ARCore the viewport, or projection maths is wrong.
  useEffect(() => {
    if (!started.current || viewWidth === 0) return;
    WorldJamAudio.arSetDisplayGeometry(0, Math.round(viewWidth), Math.round(viewHeight));
  }, [viewWidth, viewHeight]);

  // --- per-frame polling ---
  useEffect(() => {
    if (!enabled || !supported || viewWidth === 0) return;

    const id = setInterval(() => {
      const isTracking = WorldJamAudio.arIsTracking();
      setTracking(isTracking);
      if (!isTracking) return;

      const projected = parseProjections(
        WorldJamAudio.arProjectAnchors(Math.round(viewWidth), Math.round(viewHeight)),
      );
      const map = new Map<string, ProjectedAnchor>();
      for (const p of projected) map.set(p.id, p);
      setAnchors(map);

      setPose(parsePose(WorldJamAudio.arCameraPose()));
    }, 1000 / POLL_HZ);

    return () => clearInterval(id);
  }, [enabled, supported, viewWidth, viewHeight]);

  const createAnchor = useCallback(
    (id: string, screenX: number, screenY: number) => {
      if (!supported || !started.current) return false;
      return WorldJamAudio.arCreateAnchor(id, screenX, screenY);
    },
    [supported],
  );

  const removeAnchor = useCallback((id: string) => {
    if (started.current) WorldJamAudio.arRemoveAnchor(id);
  }, []);

  return { supported, tracking, anchors, pose, error, createAnchor, removeAnchor };
}
