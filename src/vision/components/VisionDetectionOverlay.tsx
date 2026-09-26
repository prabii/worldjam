import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import type { VisionObjectSummary } from '../../../modules/worldjam-vision/src';
import { colors } from '@/theme';
import { coverMap } from '../geometry';

interface Props {
  objects: VisionObjectSummary[];
  /** Upright frame width / height. */
  frameAspect: number;
  /** When set, this track is highlighted (capture target) instead of the guide's primary. */
  highlightTrackId?: string | null;
  /** Suffix on the highlighted label, e.g. "closest". */
  highlightTag?: string;
  /** Labels are never drawn above this y (px) — keeps them clear of screen chrome such as a header. */
  labelMinTop?: number;
}

const LABEL_H = 22;
const LABEL_W = 150;

/**
 * Boxes drawn over the preview. The preview fills the view with `cover`
 * scaling, so boxes (normalised to the full frame) are mapped through the
 * same crop to line up with what is on screen. Purely visual: hidden from
 * screen readers, which get the spoken read-out instead.
 */
export function VisionDetectionOverlay({ objects, frameAspect, highlightTrackId, highlightTag, labelMinTop = 0 }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  const { w, h } = size;
  const map = coverMap(w, h, frameAspect);

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
          const hot = highlightTrackId !== undefined ? o.trackId === highlightTrackId : o.isPrimary;
          const color = hot ? colors.live : colors.vibe;
          const r = map.boxToView(o.bbox);
          // The label sits above the box, but is kept on screen: clamped to the
          // visible width, and moved inside the box when above would put it off
          // the top or under the screen's own controls.
          const outsideTop = r.y - LABEL_H;
          const labelTop = outsideTop >= labelMinTop ? outsideTop : Math.max(r.y, labelMinTop) + 2;
          const labelLeft = Math.min(Math.max(r.x, 2), Math.max(2, w - LABEL_W));
          return (
            <React.Fragment key={o.trackId}>
              <View
                style={[
                  styles.box,
                  { left: r.x, top: r.y, width: r.width, height: r.height, borderColor: color, borderWidth: hot ? 3 : 1.5 },
                ]}
              />
              {labelTop < h - LABEL_H && (
                <Text
                  style={[styles.label, { top: labelTop, left: labelLeft, maxWidth: LABEL_W, backgroundColor: color }]}
                  numberOfLines={1}
                >
                  {hot ? '● ' : ''}
                  {o.spokenLabel}
                  {hot && highlightTag ? ` · ${highlightTag}` : ''}
                </Text>
              )}
            </React.Fragment>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', borderRadius: 8 },
  label: {
    position: 'absolute',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#08090C',
    overflow: 'hidden',
  },
});
