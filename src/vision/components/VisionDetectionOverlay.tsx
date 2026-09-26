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

interface Rect { x: number; y: number; w: number; h: number }

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Highlighted object first, then smaller boxes (usually the objects, not the surfaces they sit on). */
function orderForLabels(objects: VisionObjectSummary[], highlight?: string | null): VisionObjectSummary[] {
  const hot = (o: VisionObjectSummary) => (highlight !== undefined ? o.trackId === highlight : o.isPrimary);
  return [...objects].sort((a, b) => {
    if (hot(a) !== hot(b)) return hot(a) ? -1 : 1;
    return a.bbox.width * a.bbox.height - b.bbox.width * b.bbox.height;
  });
}

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
  const placed: Rect[] = [];

  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={onLayout}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {w > 0 &&
        orderForLabels(objects, highlightTrackId).map((o) => {
          const hot = highlightTrackId !== undefined ? o.trackId === highlightTrackId : o.isPrimary;
          const color = hot ? colors.live : colors.vibe;
          const r = map.boxToView(o.bbox);
          // The label sits above the box, but is kept on screen: clamped to the
          // visible width, and moved inside the box when above would put it off
          // the top or under the screen's own controls.
          const outsideTop = r.y - LABEL_H;
          const labelTop = outsideTop >= labelMinTop ? outsideTop : Math.max(r.y, labelMinTop) + 2;
          const labelLeft = Math.min(Math.max(r.x, 2), Math.max(2, w - LABEL_W));
          const text = `${hot ? '● ' : ''}${o.spokenLabel}${hot && highlightTag ? ` · ${highlightTag}` : ''}`;
          // Greedy placement: the highlighted label is placed first; any later
          // label that would overlap one already placed is skipped (its box stays).
          const rect = { x: labelLeft, y: labelTop, w: Math.min(LABEL_W, 16 + text.length * 7.2), h: LABEL_H };
          const showLabel = labelTop < h - LABEL_H && !placed.some((p) => overlaps(p, rect));
          if (showLabel) placed.push(rect);
          return (
            <React.Fragment key={o.trackId}>
              <View
                style={[
                  styles.box,
                  { left: r.x, top: r.y, width: r.width, height: r.height, borderColor: color, borderWidth: hot ? 3 : 1.5 },
                ]}
              />
              {showLabel && (
                <Text
                  style={[styles.label, { top: labelTop, left: labelLeft, maxWidth: LABEL_W, backgroundColor: color }]}
                  numberOfLines={1}
                >
                  {text}
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
