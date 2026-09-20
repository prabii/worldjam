import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { WorldJamObject } from '@/types';
import { Waveform } from './Waveform';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  object: WorldJamObject;
  pcm: number[] | null;
  /** Container size, so normalized positions become pixels. */
  containerWidth: number;
  containerHeight: number;
  onTrigger: (id: string) => void;
  onLongPress: (id: string) => void;
}

const LABEL_WIDTH = 96;

/**
 * A captured object anchored over the camera view — the neon-outlined labels
 * in panels 1 and 3 of the mockups.
 *
 * This is the "AR" layer in its removable form (HLD v2 §2, S1): positions come
 * from where the user captured on screen, not from ARCore tracking. That is a
 * deliberate trade — it gives the visual language of the mockups with none of
 * the tracking risk the HLD warns about, and it still works in a dark room or
 * on a handset with no depth support.
 */
export function ARObjectLabel({
  object,
  pcm,
  containerWidth,
  containerHeight,
  onTrigger,
  onLongPress,
}: Props) {
  const glow = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  // A slow breathing pulse so anchors read as live rather than as flat
  // stickers, matching the glow in the mockups.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glow]);

  // Keep the label fully on screen even when captured near an edge.
  const left = Math.max(
    spacing.sm,
    Math.min(containerWidth - LABEL_WIDTH - spacing.sm, object.position.x * containerWidth - LABEL_WIDTH / 2),
  );
  const top = Math.max(
    spacing.xxl,
    Math.min(containerHeight - 90, object.position.y * containerHeight),
  );

  return (
    <Animated.View
      style={[
        styles.wrap,
        { left, top, transform: [{ scale }] },
      ]}
    >
      <Pressable
        onPressIn={() => {
          onTrigger(object.id);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          Animated.sequence([
            Animated.timing(scale, {
              toValue: 1.12,
              duration: 90,
              useNativeDriver: true,
            }),
            Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18 }),
          ]).start();
        }}
        onLongPress={() => onLongPress(object.id)}
        delayLongPress={500}
        accessibilityRole="button"
        accessibilityLabel={`Play ${object.label}`}
      >
        <Animated.View
          style={[
            styles.halo,
            {
              borderColor: object.color,
              opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.65] }),
            },
          ]}
        />

        <View style={[styles.label, { borderColor: object.color }]}>
          <Text style={styles.name} numberOfLines={1}>
            {object.label}
          </Text>
          <Text style={[styles.role, { color: object.color }]} numberOfLines={1}>
            ({object.role})
          </Text>

          <Waveform
            pcm={pcm}
            width={LABEL_WIDTH - spacing.md}
            height={18}
            color={object.color}
            bars={20}
          />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', width: LABEL_WIDTH },
  halo: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.md,
    borderWidth: 3,
  },
  label: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    backgroundColor: 'rgba(10, 12, 16, 0.86)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: 2,
    alignItems: 'center',
  },
  name: { ...type.label, fontSize: 12, color: colors.text },
  role: { ...type.caption, fontSize: 9, textTransform: 'lowercase' },
});
