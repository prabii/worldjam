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
  const [position, setPosition] = useState(0);

  useEffect(() => {
    if (!playing) {
      setBeat(0);
      setPosition(0);
      return;
    }
    const id = setInterval(() => {
      const state = transport.getState();
      setBeat(Math.floor(state.position) % 4);
      setPosition(state.position);
    }, 50);
    return () => clearInterval(id);
  }, [playing]);

  // Loop progress: fraction through the current loop
  const totalBeats = bars * 4;
  const loopProgress = playing ? (position % totalBeats) / totalBeats : 0;

  return (
    <View style={styles.outer}>
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
                b === 0 && styles.beatDotDown,
                playing && beat === b && styles.beatDotActive,
              ]}
            />
          ))}
        </View>

        <View style={styles.tempo}>
          <Text style={styles.bpm}>{bpm}</Text>
          <Text style={styles.bpmLabel}>BPM · {bars} bar{bars > 1 ? 's' : ''}</Text>
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

      {/* Loop progress bar */}
      {playing && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${loopProgress * 100}%` }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { gap: 6 },
  progressTrack: {
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginHorizontal: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.live,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceSolid,
    borderWidth: 1,
    borderColor: colors.border,
  },
  play: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  playActive: { backgroundColor: colors.liveDim },
  playIcon: {
    width: 0,
    height: 0,
    marginLeft: 4,
    borderTopWidth: 10,
    borderBottomWidth: 10,
    borderLeftWidth: 16,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.text,
  },
  stopIcon: { width: 16, height: 16, borderRadius: 3, backgroundColor: colors.text },
  beats: { flexDirection: 'row', gap: 7 },
  beatDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  beatDotDown: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.2)' },
  beatDotActive: { backgroundColor: colors.live, transform: [{ scale: 1.4 }] },
  tempo: { flex: 1 },
  bpm: { ...type.title, color: colors.text, fontVariant: ['tabular-nums'] },
  bpmLabel: { ...type.caption, color: colors.textFaint },
  arm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
  },
  armActive: { backgroundColor: colors.accentDim },
  armDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textFaint },
  armDotActive: { backgroundColor: colors.accent },
  armText: { ...type.caption, color: colors.textDim },
  armTextActive: { color: colors.accent },
});
