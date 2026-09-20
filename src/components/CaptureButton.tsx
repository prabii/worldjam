import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, radius, type } from '@/theme';

interface Props {
  recording: boolean;
  label: string;
  hint?: string;
  tint?: string;
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
}

/**
 * Hold-to-capture control.
 *
 * Hold rather than tap-to-start/tap-to-stop: the user is holding a cup in the
 * other hand and hitting it. A hold makes the capture window exactly as long
 * as they need and ends it without a second deliberate action.
 */
export function CaptureButton({
  recording,
  label,
  hint,
  tint = colors.accent,
  disabled,
  onStart,
  onStop,
}: Props) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!recording) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 620,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 620,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, recording]);

  return (
    <View style={styles.wrap}>
      <Pressable
        disabled={disabled}
        onPressIn={() => {
          if (disabled) return;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
          onStart();
        }}
        onPressOut={() => {
          if (disabled) return;
          onStop();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Hold to capture ${label}`}
        style={[
          styles.button,
          { borderColor: recording ? tint : colors.borderStrong },
          recording && { backgroundColor: `${tint}22` },
          disabled && styles.disabled,
        ]}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              borderColor: tint,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
              transform: [
                { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) },
              ],
            },
          ]}
        />
        <View style={[styles.core, { backgroundColor: recording ? tint : colors.text }]} />
      </Pressable>

      <Text style={styles.label}>{recording ? 'Listening…' : label}</Text>
      {hint && !recording && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 8 },
  button: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  disabled: { opacity: 0.4 },
  ring: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    borderWidth: 2,
  },
  core: { width: 30, height: 30, borderRadius: radius.pill },
  label: { ...type.label, color: colors.text },
  hint: { ...type.caption, color: colors.textFaint },
});
