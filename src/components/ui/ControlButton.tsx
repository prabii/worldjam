import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { gradients } from '@/theme/gradients';
import { colors, radius, type } from '@/theme';

export type ControlKind = 'play' | 'pause' | 'stop' | 'record' | 'add' | 'mic';

interface Props {
  kind: ControlKind;
  onPress: () => void;
  /** Shows the active treatment — e.g. record while recording. */
  active?: boolean;
  disabled?: boolean;
  label?: string;
  size?: number;
}

/**
 * Circular transport control from the design system.
 *
 * Icons are drawn with views rather than a font or SVG: at these sizes a
 * triangle and two bars are a handful of styled Views, and that avoids
 * shipping an icon dependency for five glyphs.
 */
export function ControlButton({
  kind,
  onPress,
  active,
  disabled,
  label,
  size = 62,
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  const accent =
    kind === 'record' ? '#F43F5E' : kind === 'play' ? '#8B5CF6' : colors.vibe;

  const isFilled = kind === 'play' || (kind === 'record' && active);

  return (
    <View style={styles.wrap}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          onPress={() => {
            if (disabled) return;
            Haptics.impactAsync(
              kind === 'record'
                ? Haptics.ImpactFeedbackStyle.Heavy
                : Haptics.ImpactFeedbackStyle.Light,
            ).catch(() => {});
            onPress();
          }}
          onPressIn={() =>
            !disabled &&
            Animated.spring(scale, {
              toValue: 0.92,
              useNativeDriver: true,
              speed: 40,
              bounciness: 0,
            }).start()
          }
          onPressOut={() =>
            Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20 }).start()
          }
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={label ?? kind}
          accessibilityState={{ disabled: !!disabled, selected: !!active }}
        >
          <LinearGradient
            colors={
              isFilled
                ? kind === 'record'
                  ? gradients.record
                  : gradients.brand
                : gradients.control
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.circle,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                borderColor: disabled ? colors.border : accent,
                opacity: disabled ? 0.45 : 1,
              },
            ]}
          >
            <Glyph kind={kind} active={active} accent={accent} />
          </LinearGradient>
        </Pressable>
      </Animated.View>

      {label && <Text style={styles.caption}>{label}</Text>}
    </View>
  );
}

function Glyph({
  kind,
  active,
  accent,
}: {
  kind: ControlKind;
  active?: boolean;
  accent: string;
}) {
  switch (kind) {
    case 'play':
      return <View style={styles.playTri} />;

    case 'pause':
      return (
        <View style={styles.row}>
          <View style={[styles.pauseBar, { backgroundColor: accent }]} />
          <View style={[styles.pauseBar, { backgroundColor: accent }]} />
        </View>
      );

    case 'stop':
      return <View style={styles.stopSquare} />;

    case 'record':
      return (
        <View
          style={[
            active ? styles.recordSquare : styles.recordDot,
            { backgroundColor: active ? '#FFFFFF' : '#F43F5E' },
          ]}
        />
      );

    case 'add':
      return (
        <View>
          <View style={[styles.plusH, { backgroundColor: accent }]} />
          <View style={[styles.plusV, { backgroundColor: accent }]} />
        </View>
      );

    case 'mic':
      return (
        <View style={styles.micWrap}>
          <View style={[styles.micBody, { backgroundColor: accent }]} />
          <View style={[styles.micStem, { backgroundColor: accent }]} />
          <View style={[styles.micBase, { borderColor: accent }]} />
        </View>
      );
  }
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 6 },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  caption: {
    ...type.caption,
    fontSize: 10,
    color: colors.textDim,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', gap: 5 },

  playTri: {
    width: 0,
    height: 0,
    marginLeft: 5,
    borderTopWidth: 11,
    borderBottomWidth: 11,
    borderLeftWidth: 18,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#FFFFFF',
  },
  pauseBar: { width: 5, height: 20, borderRadius: 2 },
  stopSquare: { width: 17, height: 17, borderRadius: 3, backgroundColor: '#FFFFFF' },
  recordDot: { width: 22, height: 22, borderRadius: 11 },
  recordSquare: { width: 18, height: 18, borderRadius: 4 },

  plusH: { width: 22, height: 3, borderRadius: 2 },
  plusV: { width: 3, height: 22, borderRadius: 2, position: 'absolute', left: 9.5, top: -9.5 },

  micWrap: { alignItems: 'center' },
  micBody: { width: 11, height: 17, borderRadius: 6 },
  micStem: { width: 2.5, height: 5, marginTop: 1 },
  micBase: { width: 15, height: 2.5, borderRadius: 2, borderBottomWidth: 2.5 },
});
