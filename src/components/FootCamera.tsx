import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { Worklets } from 'react-native-worklets-core';
import { colors, type } from '@/theme';
import {
  SAMPLE_SIZE,
  StampDetector,
  calibrate,
  findFoot,
  type FootReading,
  type FootSignature,
  type Lane,
} from '@/vision/footTracker';

interface Props {
  /** Memorised foot, or null while the player is still calibrating. */
  signature: FootSignature | null;
  /** Set true for one frame to capture the reticle contents as the signature. */
  capturing: boolean;
  onCalibrated: (sig: FootSignature) => void;
  /**
   * Fired once per foot-plant, with the lane it landed in.
   *
   * Optional: the whack-a-mole game needs nine cells rather than three
   * lanes, so it reads `onReading` and runs its own edge detection instead.
   */
  onStamp?: (lane: Lane) => void;
  /** Continuous position, for the on-screen tracking dot. */
  onReading: (reading: FootReading) => void;
}

/**
 * The camera, watching for one memorised foot.
 *
 * Deliberately runs no model. DetectorCamera documents why the frame-processor
 * path was disabled: inference took 80–150ms while the CameraX buffer was
 * held, which exhausted the six-image pool within a handful of frames and took
 * the camera, the GL surface and the screen down with it.
 *
 * Colour matching over a 48x48 sample is a few thousand integer comparisons —
 * microseconds, not milliseconds — so the buffer is released the same frame it
 * was lent. That is what makes it safe to run this on every frame where the
 * detector could not run on one frame in eight.
 */
export function FootCamera({
  signature,
  capturing,
  onCalibrated,
  onStamp,
  onReading,
}: Props) {
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const { resize } = useResizePlugin();

  const stamps = useMemo(() => new StampDetector(), []);

  // Held in refs so the worklet's dependency list stays stable: rebuilding the
  // frame processor mid-game drops frames.
  const sigRef = useRef(signature);
  sigRef.current = signature;
  const capturingRef = useRef(capturing);
  capturingRef.current = capturing;

  useEffect(() => {
    if (hasPermission) return;
    // On a tick, not during mount: asking before the Activity is attached
    // surfaces as "Tried to use permissions API while not attached".
    const id = setTimeout(() => {
      void requestPermission().catch(() => {});
    }, 0);
    return () => clearTimeout(id);
  }, [hasPermission, requestPermission]);

  /**
   * Called from the worklet with a copy of the downscaled frame.
   *
   * The pixel work itself is trivial, but it allocates a result object, and a
   * frame processor that allocates will eventually stall the pipeline — so the
   * analysis runs here on the JS thread, off the camera's back.
   */
  const analyse = useMemo(
    () =>
      Worklets.createRunOnJS((pixels: number[], wantCalibration: boolean) => {
        if (wantCalibration) {
          const sig = calibrate(pixels);
          if (sig) onCalibrated(sig);
          return;
        }

        const sig = sigRef.current;
        if (!sig) return;

        const reading = findFoot(pixels, sig);
        onReading(reading);

        const lane = stamps.push(reading, Date.now());
        if (lane != null) onStamp?.(lane);
      }),
    [onCalibrated, onReading, onStamp, stamps],
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';

      /*
       * One exit point, always.
       *
       * CameraX lends this function a buffer from a pool of six and reclaims
       * it on return. An early `return` while work is still in flight is what
       * exhausted the pool and killed the camera the last time a frame
       * processor shipped in this app, so skipping is expressed as doing no
       * work rather than as returning early, and the whole body is guarded.
       */
      try {
        const resized = resize(frame, {
          scale: { width: SAMPLE_SIZE, height: SAMPLE_SIZE },
          pixelFormat: 'rgb',
          dataType: 'uint8',
        });

        // The resized buffer is native-backed; reading `length` on the JS side
        // of the bridge gives undefined, so it is copied into a plain array
        // inside the worklet. At 48x48x3 that is 6,912 numbers — small enough
        // to cross every frame.
        const out: number[] = [];
        for (let i = 0; i < SAMPLE_SIZE * SAMPLE_SIZE * 3; i++) out.push(resized[i]);

        analyse(out, capturingRef.current);
      } catch {
        // A single bad frame must never take the camera down.
      }
    },
    [resize, analyse],
  );

  if (!device) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.fallback]}>
        <Text style={styles.fallbackText}>No camera available</Text>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.fallback]}>
        <Text style={styles.fallbackText}>Camera permission needed</Text>
      </View>
    );
  }

  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      isActive
      frameProcessor={frameProcessor}
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
  fallbackText: { ...type.body, color: colors.textDim },
});
