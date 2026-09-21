import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { Worklets } from 'react-native-worklets-core';
import { colors } from '@/theme';
import { Glyph } from '@/components/ui/Glyph';
import { DetectionTracker, parseDetections, type Detection } from '@/vision/detector';
import { loadDetector, getModel } from '@/vision/nativeDetector';

interface Props {
  facing: 'back' | 'front';
  torch: boolean;
  /** Turns inference off without tearing the preview down. */
  detecting: boolean;
  onDetections: (detections: Detection[]) => void;
}

/** EfficientDet-Lite's input size. */
const INPUT = 320;

/**
 * Minimum gap between inferences, in milliseconds.
 *
 * Inference takes 80–150ms on a mid-range phone. Running it on every frame at
 * 30fps would queue work faster than it completes and leave the camera and the
 * model fighting for the same cores, which shows up as a stuttering preview.
 * Four a second is enough to track an object someone is holding still enough
 * to tap.
 */
const MIN_INTERVAL_MS = 250;

/**
 * The camera preview with live object detection.
 *
 * VisionCamera rather than expo-camera, because only VisionCamera exposes
 * frames to JS. The frame processor runs on its own worklet thread: it
 * resizes the frame, runs the model, and hands plain detections back to React
 * through a Worklets bridge — the React side never touches a frame buffer.
 */
export function DetectorCamera({ facing, torch, detecting, onDetections }: Props) {
  const device = useCameraDevice(facing);
  const { hasPermission, requestPermission } = useCameraPermission();
  const { resize } = useResizePlugin();
  const [ready, setReady] = useState(false);

  // One tracker for the component's life, so smoothing survives re-renders.
  const tracker = useMemo(() => new DetectionTracker(), []);

  useEffect(() => {
    if (!hasPermission) void requestPermission();
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    let cancelled = false;
    void loadDetector().then((m) => {
      if (!cancelled) setReady(m != null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Called from the worklet thread with raw model output.
   *
   * Parsing and smoothing happen here rather than in the worklet because they
   * allocate, and a frame processor that allocates will eventually stall the
   * camera pipeline.
   */
  const publish = useMemo(
    () =>
      Worklets.createRunOnJS(
        (boxes: number[], classes: number[], scores: number[], count: number) => {
          const parsed = parseDetections(boxes, classes, scores, count);
          onDetections(tracker.update(parsed));
        },
      ),
    [onDetections, tracker],
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      if (!detecting) return;

      // Throttle inside the worklet: returning here costs nothing, whereas
      // hopping to JS to decide would defeat the purpose.
      const now = Date.now();
      // eslint-disable-next-line no-undef
      const last = (globalThis as Record<string, unknown>).__wjLastRun as number | undefined;
      if (last != null && now - last < MIN_INTERVAL_MS) return;
      (globalThis as Record<string, unknown>).__wjLastRun = now;

      const model = getModel();
      if (model == null) return;

      try {
        const resized = resize(frame, {
          scale: { width: INPUT, height: INPUT },
          pixelFormat: 'rgb',
          dataType: 'uint8',
        });

        const out = model.runSync([resized]);
        const boxes = out[0] as unknown as number[];
        const classes = out[1] as unknown as number[];
        const scores = out[2] as unknown as number[];
        const count = (out[3] as unknown as number[])[0] ?? 0;

        publish(boxes, classes, scores, count);
      } catch {
        // A single bad frame must never take the camera down.
      }
    },
    [detecting, resize, publish],
  );

  if (!device) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.fallback]}>
        <Glyph name="video" size={32} color={colors.textFaint} />
        <Text style={styles.fallbackText}>No camera available</Text>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.fallback]}>
        <Glyph name="video" size={32} color={colors.textFaint} />
        <Text style={styles.fallbackText}>Camera permission needed</Text>
      </View>
    );
  }

  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      isActive
      torch={torch ? 'on' : 'off'}
      // Only attach the processor once the model exists, so early frames are
      // not spent calling into a null model.
      frameProcessor={ready ? frameProcessor : undefined}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#0B0E16',
  },
  fallbackText: { fontSize: 13, fontWeight: '600', color: colors.textDim },
});
