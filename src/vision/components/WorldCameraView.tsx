import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  VisionCameraProxy,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { WORLD_VISION_PLUGIN, WorldVision } from '../../../modules/worldjam-vision/src';
import { colors } from '@/theme';

interface Props {
  active: boolean;
  /** Upright frame width / height, so the overlay can mirror the preview's crop. */
  onFrameAspect?: (aspect: number) => void;
}

/**
 * Live camera for the vision screen.
 *
 * Uses the VisionCamera stack the app already ships (no second camera
 * library). The frame processor only hands each frame to the native plugin;
 * conversion, inference, tracking and speech all happen natively, and the
 * frame is released as soon as the call returns.
 */
export function WorldCameraView({ active, onFrameAspect }: Props) {
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const format = useCameraFormat(device, [
    { videoResolution: { width: 1280, height: 720 } },
    { fps: 30 },
  ]);

  const plugin = useMemo(() => {
    WorldVision.initialize(); // registers the native plugin (idempotent)
    return VisionCameraProxy.initFrameProcessorPlugin(WORLD_VISION_PLUGIN, {});
  }, []);

  useEffect(() => {
    if (hasPermission) return;
    const id = setTimeout(() => {
      void requestPermission().catch(() => {});
    }, 0);
    return () => clearTimeout(id);
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    if (!format || !onFrameAspect) return;
    const w = Math.min(format.videoWidth, format.videoHeight);
    const h = Math.max(format.videoWidth, format.videoHeight);
    onFrameAspect(w / h);
  }, [format, onFrameAspect]);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      if (plugin != null) plugin.call(frame);
    },
    [plugin],
  );

  if (!hasPermission) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.fallback]} accessible accessibilityLabel="Camera permission needed">
        <Text style={styles.fallbackText}>Camera permission needed for object detection.</Text>
      </View>
    );
  }
  if (!device) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.fallback]} accessible accessibilityLabel="No camera available">
        <Text style={styles.fallbackText}>No camera available.</Text>
      </View>
    );
  }

  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      format={format}
      isActive={active}
      pixelFormat="yuv"
      audio={false}
      frameProcessor={plugin ? frameProcessor : undefined}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B0E16', padding: 24 },
  fallbackText: { color: colors.textDim, fontSize: 15, fontWeight: '600', textAlign: 'center' },
});
