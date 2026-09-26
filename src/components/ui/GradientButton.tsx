import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { gradients, type GradientStops } from '@/theme/gradients';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  label: string;
  onPress: () => void;
  /** Trailing glyph, e.g. the arrow on "Get Started". */
  trailing?: string;
  disabled?: boolean;
  busy?: boolean;
  /** What the button says while busy. */
  busyLabel?: string;
  /** Pill by default, matching the primary CTA in the design system. */
  shape?: 'pill' | 'rounded';
  gradient?: GradientStops;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

/**
 * The primary gradient CTA from the design system.
 *
 * The glow is drawn as a blurred sibling behind the button rather than via
 * shadow props: Android cannot tint elevation shadows, so a coloured shadow
 * simply would not appear on the target device.
 */
export function GradientButton({
  label,
  onPress,
  trailing,
  disabled,
  busy,
  busyLabel = 'Working…',
  shape = 'pill',
  gradient = gradients.brand,
  style,
  accessibilityLabel,
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  const press = (to: number) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();

  const br = shape === 'pill' ? radius.pill : radius.md;
  const inactive = disabled || busy;

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      {/* Glow layer: a slightly larger, blurred copy of the gradient. */}
      {!inactive && (
        <View pointerEvents="none" style={[styles.glowWrap, { borderRadius: br }]}>
          <LinearGradient
            colors={gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[StyleSheet.absoluteFill, { borderRadius: br, opacity: 0.55 }]}
          />
        </View>
      )}

      <Pressable
        onPress={() => {
          if (inactive) return;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          onPress();
        }}
        onPressIn={() => !inactive && press(0.97)}
        onPressOut={() => press(1)}
        disabled={inactive}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!inactive, busy: !!busy }}
        accessibilityLabel={accessibilityLabel ?? label}
      >
        <LinearGradient
          colors={inactive ? (['#2A2E38', '#1C1F27'] as GradientStops) : gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.button, { borderRadius: br }]}
        >
          <Text style={[styles.label, inactive && styles.labelDisabled]}>
            {busy ? busyLabel : label}
          </Text>
          {trailing && !busy && (
            <Text style={[styles.trailing, inactive && styles.labelDisabled]}>
              {trailing}
            </Text>
          )}
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  glowWrap: {
    position: 'absolute',
    top: 3,
    left: 6,
    right: 6,
    bottom: -3,
    opacity: 0.5,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  label: { ...type.title, fontSize: 18, color: '#FFFFFF' },
  labelDisabled: { color: colors.textFaint },
  trailing: { ...type.title, fontSize: 18, color: '#FFFFFF' },
});
