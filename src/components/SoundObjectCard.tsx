import React, { memo, useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { WorldJamObject } from '@/types';
import { ObjectIcon } from './ObjectIcon';
import { Waveform } from './Waveform';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  object: WorldJamObject;
  /** The captured PCM, so the card shows this object's real waveform. */
  pcm: number[] | null;
  onTrigger: (id: string) => void;
  onLongPress: (id: string) => void;
  /** Bumped when the sequencer fires this object, to flash the card. */
  beatPulse?: number;
}

const CARD_WIDTH = 132;

/**
 * A captured object as a playable pad — panels 2 and 3 of the mockups.
 *
 * The waveform is the point: it is this object's actual recording, so two
 * cards genuinely look different. That is the visual proof of "real sounds,
 * not samples" and it does more work in a demo than any label.
 *
 * Visual feedback is driven by the press itself, never by an audio callback —
 * waiting on a round trip would undermine the sub-50ms feel the product
 * depends on.
 */
function SoundObjectCardImpl({ object, pcm, onTrigger, onLongPress, beatPulse = 0 }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;

  const flash = useCallback(() => {
    glow.setValue(1);
    Animated.timing(glow, {
      toValue: 0,
      duration: 360,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [glow]);

  // Pulse when the sequencer plays this object, so the pattern is visible as
  // well as audible.
  useEffect(() => {
    if (beatPulse > 0) flash();
  }, [beatPulse, flash]);

  const handlePressIn = useCallback(() => {
    // Fire on press-in: waiting for release would add the user's own
    // finger-lift time to the perceived latency.
    onTrigger(object.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    flash();
    Animated.spring(scale, {
      toValue: 0.94,
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

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onLongPress={() => onLongPress(object.id)}
        delayLongPress={500}
        accessibilityRole="button"
        accessibilityLabel={`Play ${object.label}, ${object.role}`}
        accessibilityHint="Long press to remove"
        style={[styles.card, { borderColor: object.color }]}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.glow,
            {
              backgroundColor: object.color,
              opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.3] }),
            },
          ]}
        />

        <View style={styles.header}>
          <ObjectIcon category={object.category} color={object.color} size={20} />
          <View style={[styles.realTag, { borderColor: object.color }]}>
            <Text style={[styles.realText, { color: object.color }]}>REAL</Text>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.label} numberOfLines={1}>
            {object.label}
          </Text>
          <Text style={[styles.role, { color: object.color }]} numberOfLines={1}>
            {object.role}
          </Text>
        </View>

        <Waveform
          pcm={pcm}
          width={CARD_WIDTH - spacing.md * 2}
          height={26}
          color={object.color}
          bars={26}
        />

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
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
    gap: spacing.sm,
    overflow: 'hidden',
  },
  glow: { borderRadius: radius.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  realTag: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  realText: { ...type.caption, fontSize: 9 },
  body: { gap: 1 },
  label: { ...type.title, fontSize: 16, color: colors.text },
  role: { ...type.caption, textTransform: 'capitalize' },
  beats: { flexDirection: 'row', gap: 4 },
  beatDot: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
});

export const SoundObjectCard = memo(SoundObjectCardImpl);
