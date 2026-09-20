import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { transport } from '@/audio/transport';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  playing: boolean;
  armed: boolean;
  bpm: number;
  bars: number;
  onTogglePlay: () => void;
  onToggleArm: () => void;
}

/**
 * Play/record transport with a beat indicator.
 *
 * The beat dots are polled from the transport rather than pushed from the
 * audio thread: a visual a frame late is invisible, whereas waking React on
 * every scheduled event would cost far more than it is worth.
 */
export function TransportBar({
  playing,
  armed,
  bpm,
  bars,
  onTogglePlay,
  onToggleArm,
}: Props) {
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    if (!playing) {
      setBeat(0);
      return;
    }
    const id = setInterval(() => {
      const state = transport.getState();
      setBeat(Math.floor(state.position) % 4);
    }, 60);
    return () => clearInterval(id);
  }, [playing]);

  return (
    <View style={styles.bar}>
      <Pressable
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onTogglePlay();
        }}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Stop' : 'Play'}
        style={[styles.play, playing && styles.playActive]}
      >
        {playing ? (
          <View style={styles.stopIcon} />
        ) : (
          <View style={styles.playIcon} />
        )}
      </Pressable>

      <View style={styles.beats}>
        {[0, 1, 2, 3].map((b) => (
          <View
            key={b}
            style={[
              styles.beatDot,
              playing && beat === b && styles.beatDotActive,
              b === 0 && styles.beatDotDown,
            ]}
          />
        ))}
      </View>

      <View style={styles.tempo}>
        <Text style={styles.bpm}>{bpm}</Text>
        <Text style={styles.bpmLabel}>BPM · {bars} bars</Text>
      </View>

      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          onToggleArm();
        }}
        accessibilityRole="button"
        accessibilityLabel={armed ? 'Stop recording performance' : 'Record performance'}
        style={[styles.arm, armed && styles.armActive]}
      >
        <View style={[styles.armDot, armed && styles.armDotActive]} />
        <Text style={[styles.armText, armed && styles.armTextActive]}>
          {armed ? 'REC' : 'ARM'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  play: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  playActive: { backgroundColor: colors.liveDim, borderColor: colors.live },
  playIcon: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 9,
    borderBottomWidth: 9,
    borderLeftWidth: 15,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.text,
  },
  stopIcon: { width: 14, height: 14, borderRadius: 2, backgroundColor: colors.live },
  beats: { flexDirection: 'row', gap: 6 },
  beatDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.border,
  },
  beatDotDown: { borderWidth: 1, borderColor: colors.borderStrong },
  beatDotActive: { backgroundColor: colors.live, transform: [{ scale: 1.35 }] },
  tempo: { flex: 1 },
  bpm: { ...type.title, color: colors.text, fontVariant: ['tabular-nums'] },
  bpmLabel: { ...type.caption, color: colors.textFaint },
  arm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  armActive: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  armDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textFaint },
  armDotActive: { backgroundColor: colors.accent },
  armText: { ...type.caption, color: colors.textDim },
  armTextActive: { color: colors.accent },
});
