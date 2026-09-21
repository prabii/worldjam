import React, { useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { colors } from '@/theme';

interface Props {
  bpm: number;
  onChange: (bpm: number) => void;
  min?: number;
  max?: number;
  /** Tick labels drawn under the track. */
  ticks?: number[];
}

/**
 * The tempo slider, labelled in BPM with ticks beneath.
 *
 * Snaps to whole BPM and fires a light haptic on each change of value rather
 * than on each touch event, so dragging feels like a detented control instead
 * of a continuous buzz.
 */
export function TempoSlider({
  bpm,
  onChange,
  min = 60,
  max = 180,
  ticks = [60, 90, 120, 150, 180],
}: Props) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const lastValue = useRef(bpm);
  lastValue.current = bpm;

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  };

  const set = (x: number) => {
    if (widthRef.current <= 0) return;
    const ratio = Math.max(0, Math.min(1, x / widthRef.current));
    const next = Math.round(min + ratio * (max - min));
    if (next !== lastValue.current) {
      Haptics.selectionAsync().catch(() => {});
      onChange(next);
    }
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => set(e.nativeEvent.locationX),
        onPanResponderMove: (e) => set(e.nativeEvent.locationX),
      }),
    // `set` closes over refs only, so the responder never needs rebuilding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min, max, onChange],
  );

  const ratio = Math.max(0, Math.min(1, (bpm - min) / (max - min)));

  return (
    <View>
      <View
        style={styles.trackWrap}
        onLayout={onLayout}
        {...responder.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="Tempo"
        accessibilityValue={{ min, max, now: bpm, text: `${bpm} BPM` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const step = e.nativeEvent.actionName === 'increment' ? 1 : -1;
          onChange(Math.max(min, Math.min(max, lastValue.current + step)));
        }}
      >
        <View style={styles.track} />
        <View style={[styles.fill, { width: ratio * width }]}>
          <LinearGradient
            colors={['#6366F1', '#A855F7']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <View style={[styles.thumb, { left: Math.max(0, ratio * width - 11) }]} />
      </View>

      <View style={styles.ticks}>
        {ticks.map((t) => (
          <Text key={t} style={styles.tick}>
            {t}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  trackWrap: { height: 30, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(120,140,190,0.22)' },
  fill: { position: 'absolute', height: 6, borderRadius: 3, overflow: 'hidden' },
  thumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: 'rgba(168,85,247,0.8)',
  },
  ticks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  tick: { fontSize: 11, fontWeight: '600', color: colors.textFaint },
});
