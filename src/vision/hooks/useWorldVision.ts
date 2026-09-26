import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  WorldVision,
  isWorldVisionAvailable,
  type LatestReadout,
  type VisionDiagnostics,
  type VisionState,
  type VisionStatus,
} from '../../../modules/worldjam-vision/src';
import { formatWithGemma, type TextRuntime } from '../services/gemmaReadoutFormatter';

const EMPTY_STATE: VisionState = {
  primaryObject: null,
  direction: null,
  multipleObjectsDetected: false,
  objectCount: 0,
  objects: [],
  timestamp: 0,
};

interface Options {
  /** Screen visible and camera active. Detection stops when false. */
  active: boolean;
  /** Optional Gemma phrasing; resolved lazily so vision never imports the AI layer eagerly. */
  gemmaRuntime?: () => TextRuntime | null;
  diagnosticsEnabled?: boolean;
}

/**
 * The React side of the vision subsystem: subscribes to native events and
 * exposes the few actions the screen needs. All detection, tracking and speech
 * happens natively; this hook only mirrors compact state.
 */
export function useWorldVision({ active, gemmaRuntime, diagnosticsEnabled = false }: Options) {
  const [status, setStatus] = useState<VisionStatus>(() => WorldVision.getBackend());
  const [state, setState] = useState<VisionState>(EMPTY_STATE);
  const [latest, setLatest] = useState<LatestReadout | null>(() => WorldVision.getLatestReadout());
  const [readoutEnabled, setReadoutEnabledState] = useState<boolean>(() => WorldVision.isReadoutEnabled());
  const [gemmaEnabled, setGemmaEnabledState] = useState(false);
  const [diagnostics, setDiagnostics] = useState<VisionDiagnostics | null>(null);
  const gemmaRef = useRef(gemmaRuntime);
  gemmaRef.current = gemmaRuntime;

  useEffect(() => {
    if (!isWorldVisionAvailable) return;
    const subs = [
      WorldVision.addListener('onStatus', setStatus),
      WorldVision.addListener('onVisionState', setState),
      WorldVision.addListener('onReadout', setLatest),
      WorldVision.addListener('onFormatRequest', (req) => {
        void formatWithGemma(req.event, gemmaRef.current?.() ?? null, Math.max(200, req.timeoutMs - 150)).then(
          (text) => {
            WorldVision.completeReadout(req.requestId, text);
          },
        );
      }),
    ];
    setStatus(WorldVision.initialize());
    return () => subs.forEach((s) => s.remove());
  }, []);

  // Detection runs only while the screen is visible AND the app is foregrounded.
  useEffect(() => {
    if (!isWorldVisionAvailable) return;
    const apply = (fg: boolean) => {
      if (active && fg) WorldVision.startDetection();
      else WorldVision.stopDetection();
    };
    apply(AppState.currentState === 'active');
    const sub = AppState.addEventListener('change', (s) => apply(s === 'active'));
    return () => {
      sub.remove();
      WorldVision.stopDetection();
    };
  }, [active]);

  useEffect(() => {
    if (!diagnosticsEnabled || !isWorldVisionAvailable) return;
    const tick = () => setDiagnostics(WorldVision.getDiagnostics());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [diagnosticsEnabled]);

  const repeat = useCallback(() => WorldVision.repeatLatestReadout(), []);

  const setReadoutEnabled = useCallback((on: boolean) => {
    setReadoutEnabledState(WorldVision.setReadoutEnabled(on));
  }, []);

  const setGemmaEnabled = useCallback((on: boolean) => {
    setGemmaEnabledState(WorldVision.setExternalFormatting(on));
  }, []);

  return {
    available: isWorldVisionAvailable,
    status,
    state,
    latest,
    readoutEnabled,
    setReadoutEnabled,
    gemmaEnabled,
    setGemmaEnabled,
    repeat,
    diagnostics,
  };
}
