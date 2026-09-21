import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import { parseDetections, type Detection } from './detector';

/**
 * The bridge between camera frames and the detection parser.
 *
 * The model is loaded once and shared here so that the parser stays testable
 * without a camera. The frame processor itself lives in DetectorCamera, which
 * needs VisionCamera's Frame type.
 */

type Listener = (detections: Detection[]) => void;

const listeners = new Set<Listener>();
let model: TensorflowModel | null = null;
let loading: Promise<TensorflowModel | null> | null = null;

/**
 * Loads the detector, once.
 *
 * Failure is returned as null rather than thrown: a missing or incompatible
 * model must leave the app fully usable — the scan screen falls back to "hold
 * anywhere to record", which works for objects the model could never name.
 */
export async function loadDetector(): Promise<TensorflowModel | null> {
  if (model) return model;
  if (loading) return loading;

  loading = (async () => {
    const startedAt = Date.now();
    try {
      console.log('[worldjam] loading detector…');
      const loaded = await loadTensorflowModel(
        require('../../assets/models/efficientdet-lite.tflite'),
      );
      model = loaded;
      console.log(
        `[worldjam] detector ready in ${Date.now() - startedAt}ms; ` +
          `inputs=${loaded.inputs?.length ?? '?'} outputs=${loaded.outputs?.length ?? '?'}`,
      );
      return loaded;
    } catch (err) {
      console.warn(
        `[worldjam] detector failed to load after ${Date.now() - startedAt}ms:`,
        err,
      );
      return null;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

export function getModel(): TensorflowModel | null {
  return model;
}

/** Publishes a frame's detections to every subscriber. */
export function publish(detections: Detection[]): void {
  for (const listener of listeners) listener(detections);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  void loadDetector();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Runs the model on one already-resized RGB frame and publishes the result.
 *
 * `input` must be 320x320 uint8 RGB — what EfficientDet-Lite expects. Resizing
 * is the caller's job because it is done on the frame processor's worklet
 * thread, where the pixel buffer already lives.
 */
export function runOnFrame(input: Uint8Array): Detection[] {
  const m = model;
  if (!m) return [];

  try {
    const outputs = m.runSync([input]);
    // EfficientDet-Lite emits four tensors: boxes, classes, scores, count.
    const [boxes, classes, scores, count] = outputs as unknown as [
      Float32Array,
      Float32Array,
      Float32Array,
      Float32Array,
    ];
    const detections = parseDetections(boxes, classes, scores, count?.[0] ?? 0);
    publish(detections);
    return detections;
  } catch (err) {
    console.warn('[worldjam] detection failed:', err);
    return [];
  }
}

export default { subscribe, loadDetector, runOnFrame, getModel };
