import React, { memo, useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { WorldJamObject } from '@/types';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  object: WorldJamObject;
  onTrigger: (id: string) => void;
  onLongPress: (id: string) => void;
  /** Set briefly when the transport fires this object, to flash the card. */
  beatPulse: number;
}

/**
 * A captured object, rendered as a playable pad.
 *
 * The visual feedback is deliberately driven by the press itself rather than
 * by any audio callback: the whole point is that the response feels immediate,
 * so nothing here waits on a round trip.
 */
function SoundObjectCardImpl({ object, onTrigger, onLongPress, beatPulse }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;

  const flash = useCallback(() => {
    glow.setValue(1);
    Animated.timing(glow, {
      toValue: 0,
      duration: 340,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [glow]);

  // Pulse when the sequencer plays this object, so the user can see the
  // pattern as well as hear it.
  useEffect(() => {
    if (beatPulse > 0) flash();
  }, [beatPulse, flash]);

  const handlePressIn = useCallback(() => {
    // Fire on press-in, not press-out: waiting for release would add the
    // user's own finger-lift time to the perceived latency.
    onTrigger(object.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    flash();
    Animated.spring(scale, {
      toValue: 0.93,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  }, [flash, object.id, onTrigger, scale]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 10,
    }).start();
  }, [scale]);

  const f = object.features;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onLongPress={() => onLongPress(object.id)}
        delayLongPress={500}
        accessibilityRole="button"
        accessibilityLabel={`Play ${object.label}, role ${object.role}`}
        style={[styles.card, { borderColor: object.color }]}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.glow,
            { backgroundColor: object.color, opacity: glow.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.35],
            }) },
          ]}
        />

        <View style={styles.header}>
          <View style={[styles.dot, { backgroundColor: object.color }]} />
          <Text style={styles.realTag}>REAL</Text>
        </View>

        <Text style={styles.label} numberOfLines={1}>
          {object.label}
        </Text>

        <Text style={[styles.role, { color: object.color }]}>{object.role}</Text>

        {object.beatPattern.length > 0 && (
          <View style={styles.beats}>
            {[1, 2, 3, 4].map((b) => (
              <View
                key={b}
                style={[
                  styles.beatDot,
                  object.beatPattern.some((p) => Math.floor(p) === b) && {
                    backgroundColor: object.color,
                  },
                ]}
              />
            ))}
          </View>
        )}

        {f && (
          <Text style={styles.meta}>
            {Math.round(f.brightness)}Hz · {f.decay.toFixed(2)}s
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 116,
    height: 126,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  glow: {
    borderRadius: radius.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  realTag: {
    ...type.caption,
    color: colors.textFaint,
  },
  label: {
    ...type.title,
    fontSize: 17,
    color: colors.text,
  },
  role: {
    ...type.caption,
    textTransform: 'uppercase',
  },
  beats: {
    flexDirection: 'row',
    gap: 4,
  },
  beatDot: {
    width: 14,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  meta: {
    ...type.mono,
    fontSize: 10,
    color: colors.textFaint,
  },
});

export const SoundObjectCard = memo(SoundObjectCardImpl);
