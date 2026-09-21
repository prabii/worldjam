import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { colors } from '@/theme';
import { Glyph, type GlyphName } from '@/components/ui/Glyph';
import type { Detection } from '@/vision/detector';
import type { ObjectCategory } from '@/types';

/** Glyph per category, so the callout matches the mockup's cup icon. */
const CATEGORY_GLYPH: Record<ObjectCategory, GlyphName> = {
  cup: 'cup',
  glass: 'cup',
  bottle: 'cup',
  table: 'grid',
  laptop: 'video',
  keys: 'settings',
  plant: 'plant',
  book: 'file',
  phone: 'video',
  box: 'cube',
  clap: 'user',
  voice: 'mic',
  unknown: 'cube',
};

interface Props {
  detections: Detection[];
  /** Viewfinder size in px, which the normalised boxes scale against. */
  width: number;
  height: number;
  /** The detection currently chosen for capture. */
  selectedId?: string | null;
  onSelect?: (det: Detection) => void;
}

/**
 * The neon callout labels drawn over the camera feed.
 *
 * Each label sits above its object with a leader line down to the box centre,
 * as in the scan mockup. Labels are placed above the box and flipped below
 * when there is no room at the top — an object near the top of frame is
 * common (someone raising the phone) and a clipped label reads as a bug.
 */
export function DetectionOverlay({
  detections,
  width,
  height,
  selectedId,
  onSelect,
}: Props) {
  if (width <= 0 || height <= 0) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Leader lines are drawn in one SVG beneath the labels so they never
          paint over the text. */}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        {detections.map((d) => {
          const cx = (d.box.x + d.box.width / 2) * width;
          const cy = (d.box.y + d.box.height / 2) * height;
          const above = d.box.y * height > LABEL_H + 16;
          const ly = above ? d.box.y * height - 8 : (d.box.y + d.box.height) * height + 8;
          return (
            <Line
              key={`l-${d.id}`}
              x1={cx}
              y1={cy}
              x2={cx}
              y2={ly}
              stroke={d.role.color}
              strokeWidth={1.5}
              strokeOpacity={0.9}
            />
          );
        })}
      </Svg>

      {detections.map((d) => (
        <DetectionLabel
          key={d.id}
          detection={d}
          width={width}
          height={height}
          selected={selectedId === d.id}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}

const LABEL_H = 58;
const LABEL_W = 190;

function DetectionLabel({
  detection: d,
  width,
  height,
  selected,
  onSelect,
}: {
  detection: Detection;
  width: number;
  height: number;
  selected: boolean;
  onSelect?: (det: Detection) => void;
}) {
  const cx = (d.box.x + d.box.width / 2) * width;
  const boxTop = d.box.y * height;
  const above = boxTop > LABEL_H + 16;

  // Clamped so a label on an object at the frame edge stays fully readable
  // rather than running off the side.
  const left = Math.max(6, Math.min(width - LABEL_W - 6, cx - LABEL_W / 2));
  const top = above
    ? boxTop - LABEL_H - 10
    : (d.box.y + d.box.height) * height + 10;

  return (
    <>
      {/* Corner reticle around the object */}
      <Reticle
        x={d.box.x * width}
        y={boxTop}
        w={d.box.width * width}
        h={d.box.height * height}
        color={d.role.color}
        selected={selected}
      />

      <Pressable
        onPress={() => onSelect?.(d)}
        style={[
          styles.label,
          { left, top, width: LABEL_W, borderColor: d.role.color },
          selected && styles.labelSelected,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${d.displayName}, ${d.role.display}. Tap to capture its sound.`}
        accessibilityState={{ selected }}
      >
        <View style={[styles.labelIcon, { borderColor: d.role.color + '77' }]}>
          <Glyph name={CATEGORY_GLYPH[d.category]} size={18} color={d.role.color} />
        </View>
        <View style={styles.labelText}>
          <Text style={styles.labelTitle}>{d.displayName}</Text>
          <Text style={styles.labelRole} numberOfLines={1}>
            {d.role.display} · {d.role.traits[0]}
          </Text>
        </View>
      </Pressable>
    </>
  );
}

/** The four neon corner brackets framing a detected object. */
function Reticle({
  x,
  y,
  w,
  h,
  color,
  selected,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  selected: boolean;
}) {
  // Corner arm length scales with the box so small objects do not get
  // brackets that meet in the middle.
  const arm = Math.max(14, Math.min(34, Math.min(w, h) * 0.28));
  const t = selected ? 4 : 3;
  const corners = [
    { top: 0, left: 0, borderTopWidth: t, borderLeftWidth: t, borderTopLeftRadius: 12 },
    { top: 0, right: 0, borderTopWidth: t, borderRightWidth: t, borderTopRightRadius: 12 },
    { bottom: 0, left: 0, borderBottomWidth: t, borderLeftWidth: t, borderBottomLeftRadius: 12 },
    { bottom: 0, right: 0, borderBottomWidth: t, borderRightWidth: t, borderBottomRightRadius: 12 },
  ];

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: x, top: y, width: w, height: h }}
    >
      {corners.map((c, i) => (
        <View
          key={i}
          style={[
            { position: 'absolute', width: arm, height: arm, borderColor: color },
            c as object,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    position: 'absolute',
    height: LABEL_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    backgroundColor: 'rgba(10,13,22,0.88)',
  },
  labelSelected: { borderWidth: 2.5, backgroundColor: 'rgba(16,20,34,0.94)' },
  labelIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelText: { flex: 1 },
  labelTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.2 },
  labelRole: { fontSize: 12, fontWeight: '500', color: 'rgba(226,235,255,0.78)' },
});
