import React, { useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { colors } from '@/theme';

interface Props {
  label: string;
  /** 0..1. */
  value: number;
  onChange: (v: number) => void;
  /** Formats the readout under the label, e.g. "80%" or "+2 st". */
  format?: (v: number) => string;
  accent?: string;
  size?: number;
}

/** Arc sweep, in degrees, leaving a gap at the bottom like a hardware knob. */
const SWEEP = 270;
const START = 135;

/**
 * A rotary knob.
 *
 * Dragged vertically rather than in a circle: circular dragging is the obvious
 * reading of the control, but on a phone it means the finger covers the value
 * it is setting, and a small radius makes the angle jump wildly near the
 * centre. Vertical drag is what hardware-style knobs in mobile audio apps use.
 */
export function Knob({
  label,
  value,
  onChange,
  format = (v) => `${Math.round(v * 100)}%`,
  accent = '#A855F7',
  size = 62,
}: Props) {
  // Held in a ref so the responder closes over a stable object: recreating the
  // PanResponder on every value change would drop the gesture mid-drag.
  const start = useRef(value);
  const latest = useRef(value);
  latest.current = value;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 2,
        onPanResponderGrant: () => {
          start.current = latest.current;
          Haptics.selectionAsync().catch(() => {});
        },
        onPanResponderMove: (_e, g) => {
          // 160px of travel covers the full range — enough for a precise set
          // without needing to drag off the screen.
          const next = Math.max(0, Math.min(1, start.current - g.dy / 160));
          onChange(next);
        },
      }),
    [onChange],
  );

  const r = size / 2 - 5;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  // The arc is drawn as a dashed stroke whose first dash is the visible part.
  const arcLength = (SWEEP / 360) * circumference;
  const filled = arcLength * Math.max(0, Math.min(1, value));

  // Indicator line angle.
  const angle = ((START + SWEEP * value) * Math.PI) / 180;
  const tipX = c + Math.cos(angle) * (r - 7);
  const tipY = c + Math.sin(angle) * (r - 7);

  return (
    <View style={styles.wrap}>
      <View
        {...responder.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const step = e.nativeEvent.actionName === 'increment' ? 0.05 : -0.05;
          onChange(Math.max(0, Math.min(1, latest.current + step)));
        }}
      >
        <Svg width={size} height={size}>
          <Defs>
            <SvgGradient id={`k${label}`} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#4DA6FF" />
              <Stop offset="1" stopColor={accent} />
            </SvgGradient>
          </Defs>

          {/* Track */}
          <Circle
            cx={c}
            cy={c}
            r={r}
            stroke="rgba(120,140,190,0.20)"
            strokeWidth={5}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference}`}
            transform={`rotate(${START} ${c} ${c})`}
          />
          {/* Filled portion */}
          <Circle
            cx={c}
            cy={c}
            r={r}
            stroke={`url(#k${label})`}
            strokeWidth={5}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            transform={`rotate(${START} ${c} ${c})`}
          />
          {/* Indicator dot */}
          <Circle cx={tipX} cy={tipY} r={3} fill="#FFFFFF" />
        </Svg>
      </View>

      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.value, { color: accent }]}>{format(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 5 },
  label: { fontSize: 12, fontWeight: '600', color: colors.textDim },
  value: { fontSize: 13, fontWeight: '700' },
});
