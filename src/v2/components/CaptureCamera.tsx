import React, { forwardRef, useEffect, useMemo } from 'react';
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
import { color, font } from '../theme';

/**
 * Capture camera: the on-device object detector suggests a name for what the
 * user records (V1 vision, reused), and in Video mode the same camera records
 * MP4 with sound. One camera, one frame plugin — no second camera stack.
 */
export const CaptureCamera = forwardRef<Camera, { active: boolean; video: boolean }>(function CaptureCamera({ active, video }, ref) {
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const format = useCameraFormat(device, [{ videoResolution: { width: 1280, height: 720 } }, { fps: 30 }]);
  const plugin = useMemo(() => {
    WorldVision.initialize();
    return VisionCameraProxy.initFrameProcessorPlugin(WORLD_VISION_PLUGIN, {});
  }, []);

  useEffect(() => {
    if (!hasPermission) void requestPermission().catch(() => {});
  }, [hasPermission, requestPermission]);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      if (plugin != null) plugin.call(frame);
    },
    [plugin],
  );

  if (!hasPermission) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.fallback]}>
        <Text style={font.body}>Camera permission is needed to see what you record.</Text>
      </View>
    );
  }
  if (!device) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.fallback]}>
        <Text style={font.body}>No camera available.</Text>
      </View>
    );
  }
  return (
    <Camera
      ref={ref}
      style={StyleSheet.absoluteFill}
      device={device}
      format={format}
      isActive={active}
      pixelFormat="yuv"
      video={video}
      audio={video}
      frameProcessor={plugin ? frameProcessor : undefined}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    />
  );
});

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface, padding: 24 },
});
