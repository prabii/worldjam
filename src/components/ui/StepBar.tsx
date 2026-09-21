import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '@/theme';

export const FLOW_STEPS = ['Scan', 'Customize', 'Compose', 'Your Jam'] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

interface Props {
  /** 1-based, matching the numerals drawn in the circles. */
  current: number;
  /** Lets the user jump back to a step they have already completed. */
  onSelect?: (step: number) => void;
}

/**
 * The four-step progress header.
 *
 * The connecting rule is drawn as a sibling behind the circles rather than as
 * borders between them, so the line passes *through* the row at the circles'
 * vertical centre no matter how tall the labels wrap.
 */
export function StepBar({ current, onSelect }: Props) {
  return (
    <View style={styles.wrap}>
      {/* Rule behind the numerals. Inset by half a circle at each end so it
          starts and stops at the first and last circle, not the screen edge. */}
      <View style={styles.ruleTrack} pointerEvents="none">
        <View style={styles.rule} />
        <View
          style={[
            styles.ruleFill,
            {
              width: `${Math.max(
                0,
                Math.min(1, (current - 1) / (FLOW_STEPS.length - 1)),
              ) * 100}%`,
            },
          ]}
        >
          <LinearGradient
            colors={['#4DA6FF', '#A855F7']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
      </View>

      <View style={styles.row}>
        {FLOW_STEPS.map((label, i) => {
          const n = i + 1;
          const active = n === current;
          const done = n < current;
          const reachable = n <= current;

          return (
            <Pressable
              key={label}
              style={styles.step}
              disabled={!onSelect || !reachable}
              onPress={() => onSelect?.(n)}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: !reachable }}
              accessibilityLabel={`Step ${n}, ${label}${
                active ? ', current' : done ? ', done' : ''
              }`}
            >
              <View style={styles.circleWrap}>
                {active && <View style={styles.circleGlow} pointerEvents="none" />}
                {active || done ? (
                  <LinearGradient
                    colors={active ? ['#6366F1', '#A855F7'] : ['#243049', '#1A2136']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.circle, active && styles.circleActive]}
                  >
                    <Text style={styles.numeral}>{n}</Text>
                  </LinearGradient>
                ) : (
                  <View style={[styles.circle, styles.circleIdle]}>
                    <Text style={[styles.numeral, styles.numeralIdle]}>{n}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.label, active && styles.labelActive]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const CIRCLE = 44;

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 4 },
  ruleTrack: {
    position: 'absolute',
    // Aligns with the circles' centre: top padding + half the circle.
    top: 6 + CIRCLE / 2 - 1,
    left: 18 + CIRCLE / 2,
    right: 18 + CIRCLE / 2,
    height: 2,
  },
  rule: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(120,140,190,0.22)',
    borderRadius: 2,
  },
  ruleFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 2,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  step: { alignItems: 'center', width: 84, gap: 8 },
  circleWrap: { width: CIRCLE, height: CIRCLE },
  circleGlow: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderRadius: (CIRCLE + 8) / 2,
    borderWidth: 2,
    borderColor: 'rgba(168,85,247,0.55)',
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleActive: { borderWidth: 1.5, borderColor: 'rgba(196,181,253,0.9)' },
  circleIdle: {
    backgroundColor: 'rgba(18,22,34,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.28)',
  },
  numeral: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  numeralIdle: { color: 'rgba(200,214,240,0.7)', fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600', color: 'rgba(200,214,240,0.62)' },
  labelActive: { color: colors.text, fontWeight: '700' },
});
