import React, { useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { colors } from '@/theme';
import { Glyph, type GlyphName } from './Glyph';

interface Props {
  icon: GlyphName;
  label: string;
  /** 0..1. */
  value: number;
  onChange: (v: number) => void;
  accent: string;
  soloed?: boolean;
  onSolo?: () => void;
  onMenu?: () => void;
}

/**
 * One row of the Sound Layers panel: icon tile, name, slider, percentage, and
 * the solo / overflow buttons.
 *
 * The track measures itself on layout rather than assuming a width, so the row
 * stays correct inside the narrower Track Detail card as well as the full-width
 * studio panel.
 */
export function LayerSlider({
  icon,
  label,
  value,
  onChange,
  accent,
  soloed,
  onSolo,
  onMenu,
}: Props) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const startValue = useRef(value);
  const latest = useRef(value);
  latest.current = value;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    widthRef.current = w;
    setWidth(w);
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          startValue.current = latest.current;
          Haptics.selectionAsync().catch(() => {});
          // A tap anywhere on the track jumps there, which is what a fader
          // row is expected to do; the drag then continues from that point.
          if (widthRef.current > 0) {
            const x = e.nativeEvent.locationX;
            const v = Math.max(0, Math.min(1, x / widthRef.current));
            startValue.current = v;
            onChange(v);
          }
        },
        onPanResponderMove: (_e, g) => {
          if (widthRef.current <= 0) return;
          const v = Math.max(
            0,
            Math.min(1, startValue.current + g.dx / widthRef.current),
          );
          onChange(v);
        },
      }),
    [onChange],
  );

  const pct = Math.round(value * 100);

  return (
    <View style={styles.row}>
      <View style={[styles.tile, { borderColor: accent + '66' }]}>
        <LinearGradient
          colors={[accent + '3A', 'transparent']}
          style={StyleSheet.absoluteFill}
        />
        <Glyph name={icon} size={20} color={accent} />
      </View>

      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>

      <View
        style={styles.trackWrap}
        onLayout={onLayout}
        {...responder.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel={`${label} level`}
        accessibilityValue={{ min: 0, max: 100, now: pct }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const step = e.nativeEvent.actionName === 'increment' ? 0.05 : -0.05;
          onChange(Math.max(0, Math.min(1, latest.current + step)));
        }}
      >
        <View style={styles.track} />
        <View style={[styles.fill, { width: value * width }]}>
          <LinearGradient
            colors={[accent, '#A855F7']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <View
          style={[
            styles.thumb,
            { left: Math.max(0, value * width - 8), borderColor: accent },
          ]}
        />
      </View>

      <Text style={styles.pct}>{pct}%</Text>

      {onSolo && (
        <Pressable
          onPress={onSolo}
          style={[styles.chip, soloed && { borderColor: accent, backgroundColor: accent + '2E' }]}
          accessibilityRole="button"
          accessibilityLabel={`Solo ${label}`}
          accessibilityState={{ selected: !!soloed }}
        >
          <Text style={[styles.chipText, soloed && { color: accent }]}>S</Text>
        </Pressable>
      )}

      {onMenu && (
        <Pressable
          onPress={onMenu}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${label} options`}
        >
          <Glyph name="more" size={18} color={colors.textDim} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(20,24,36,0.9)',
  },
  label: { width: 104, fontSize: 13, fontWeight: '600', color: colors.text },
  trackWrap: { flex: 1, height: 26, justifyContent: 'center' },
  track: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(120,140,190,0.22)',
  },
  fill: {
    position: 'absolute',
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
  },
  thumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
  },
  pct: { width: 38, textAlign: 'right', fontSize: 12, fontWeight: '700', color: colors.textDim },
  chip: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.textDim },
});
