import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { transport } from '@/audio/transport';
import { Waveform } from './Waveform';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  title: string;
  playing: boolean;
  bpm: number;
  bars: number;
  /** Mixed preview PCM, when a track has been rendered. */
  previewPcm: number[] | null;
  exporting: boolean;
  onTogglePlay: () => void;
  onSave: () => void;
  onShare: () => void;
}

/**
 * "Play, Save & Share" — panel 8 of the mockups.
 *
 * A finished-track surface rather than another set of controls: the point of
 * this panel in the demo is that the jam became *a thing you can keep*.
 */
export function TrackPlayer({
  title,
  playing,
  bpm,
  bars,
  previewPcm,
  exporting,
  onTogglePlay,
  onSave,
  onShare,
}: Props) {
  const [progress, setProgress] = useState(0);

  const loopSeconds = (bars * 4 * 60) / bpm;

  useEffect(() => {
    if (!playing) {
      setProgress(0);
      return;
    }
    const id = setInterval(() => {
      const beat = transport.getState().position;
      const beatsPerLoop = bars * 4;
      setProgress(((beat % beatsPerLoop) + beatsPerLoop) % beatsPerLoop / beatsPerLoop);
    }, 80);
    return () => clearInterval(id);
  }, [playing, bars]);

  const elapsed = progress * loopSeconds;
  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <View style={styles.art}>
          <View style={styles.artBars}>
            {[8, 14, 10, 16, 11].map((h, i) => (
              <View key={i} style={[styles.artBar, { height: h }]} />
            ))}
          </View>
        </View>

        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.time}>
            {fmt(elapsed)} / {fmt(loopSeconds)}
          </Text>
        </View>
      </View>

      <View style={styles.playRow}>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            onTogglePlay();
          }}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause' : 'Play'}
          style={styles.playButton}
        >
          {playing ? <View style={styles.pauseIcon} /> : <View style={styles.playIcon} />}
        </Pressable>

        <View style={styles.waveWrap}>
          <Waveform
            pcm={previewPcm}
            width={210}
            height={38}
            color={colors.vibe}
            bars={56}
            progress={playing ? progress : undefined}
          />
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={onSave}
          disabled={exporting}
          accessibilityRole="button"
          style={[styles.action, exporting && styles.actionBusy]}
        >
          <Text style={styles.actionGlyph}>↓</Text>
          <Text style={styles.actionText}>{exporting ? 'Saving…' : 'Save'}</Text>
        </Pressable>

        <Pressable
          onPress={onShare}
          disabled={exporting}
          accessibilityRole="button"
          style={[styles.action, exporting && styles.actionBusy]}
        >
          <Text style={styles.actionGlyph}>↗</Text>
          <Text style={styles.actionText}>Share</Text>
        </Pressable>

        <View style={[styles.action, styles.actionDisabled]}>
          <Text style={[styles.actionGlyph, styles.disabledGlyph]}>◎</Text>
          <Text style={[styles.actionText, styles.disabledText]}>Jam Together</Text>
        </View>
      </View>

      <Text style={styles.soonNote}>Jam Together arrives in a future build.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  art: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSolid,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 18 },
  artBar: { width: 3, borderRadius: 2, backgroundColor: colors.vibe },
  meta: { flex: 1, gap: 2 },
  title: { ...type.title, fontSize: 17, color: colors.text },
  time: { ...type.caption, color: colors.textFaint, fontVariant: ['tabular-nums'] },

  playRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  playButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    width: 0,
    height: 0,
    marginLeft: 4,
    borderTopWidth: 10,
    borderBottomWidth: 10,
    borderLeftWidth: 17,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.bg,
  },
  pauseIcon: {
    width: 14,
    height: 16,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderColor: colors.bg,
  },
  waveWrap: { flex: 1, alignItems: 'center' },

  actions: { flexDirection: 'row', gap: spacing.sm },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  actionBusy: { opacity: 0.5 },
  actionDisabled: { opacity: 0.4 },
  actionGlyph: { ...type.title, fontSize: 16, color: colors.text },
  actionText: { ...type.caption, color: colors.textDim },
  disabledGlyph: { color: colors.textFaint },
  disabledText: { color: colors.textFaint },
  soonNote: { ...type.caption, color: colors.textFaint, textAlign: 'center' },
});
