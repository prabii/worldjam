import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import type { VisionObjectSummary } from '../../../modules/worldjam-vision/src';
import { colors } from '@/theme';

interface Props {
  objects: VisionObjectSummary[];
  /** Upright frame width / height. */
  frameAspect: number;
}

/**
 * Boxes drawn over the preview. The preview fills the view with `cover`
 * scaling, so boxes (normalised to the full frame) are mapped through the
 * same crop to line up with what is on screen. Purely visual: hidden from
 * screen readers, which get the spoken read-out instead.
 */
export function VisionDetectionOverlay({ objects, frameAspect }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  const { w, h } = size;
  let scaleW = w;
  let scaleH = h;
  let offX = 0;
  let offY = 0;
  if (w > 0 && h > 0 && frameAspect > 0) {
    if (w / h > frameAspect) {
      scaleW = w;
      scaleH = w / frameAspect;
      offY = (h - scaleH) / 2;
    } else {
      scaleH = h;
      scaleW = h * frameAspect;
      offX = (w - scaleW) / 2;
    }
  }

  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={onLayout}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {w > 0 &&
        objects.map((o) => {
          const color = o.isPrimary ? colors.live : colors.vibe;
          return (
            <View
              key={o.trackId}
              style={[
                styles.box,
                {
                  left: offX + o.bbox.x * scaleW,
                  top: offY + o.bbox.y * scaleH,
                  width: o.bbox.width * scaleW,
                  height: o.bbox.height * scaleH,
                  borderColor: color,
                  borderWidth: o.isPrimary ? 3 : 1.5,
                },
              ]}
            >
              <Text style={[styles.label, { backgroundColor: color }]} numberOfLines={1}>
                {o.isPrimary ? '● ' : ''}
                {o.spokenLabel}
              </Text>
            </View>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', borderRadius: 8 },
  label: {
    position: 'absolute',
    top: -22,
    left: -1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#08090C',
    overflow: 'hidden',
  },
});
