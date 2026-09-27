import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSession } from '@/state/sessionStore';
import { MELODY_INSTRUMENTS, type MelodyInstrument } from '@/audio/melodySynth';
import { colors, radius, spacing, type } from '@/theme';

/**
 * Your tune, heard back three ways.
 *
 * After a hum or a sung phrase: the raw voice exactly as sung, the same tune
 * played on an instrument, and a full song in any genre built around it by
 * the on-device music model — with the voice layered back on top if wanted.
 */

const SONG_GENRES = ['Bollywood', 'Pop', 'Indian classical', 'Lofi', 'Mass beat', 'Hip hop', 'Cinematic', 'Jazz'];

export function TuneCard() {
  const take = useSession((s) => s.vocalTake);
  const tuneStatus = useSession((s) => s.tuneStatus);
  const tuneMessage = useSession((s) => s.tuneMessage);
  const playVoice = useSession((s) => s.playVoice);
  const playTune = useSession((s) => s.playTune);
  const songFromTune = useSession((s) => s.songFromTune);
  const playTuneSong = useSession((s) => s.playTuneSong);

  const [instrument, setInstrument] = useState<MelodyInstrument>('piano');
  const [genre, setGenre] = useState('Bollywood');

  if (!take) return null;
  const hasTune = take.notes.length >= 3;
  const working = tuneStatus === 'working';

  return (
    <View style={styles.card}>
      <Text style={styles.title}>🎤 Your tune</Text>
      <Text style={styles.meta}>
        {take.notes.length} notes{take.detectedKey ? ` · ${take.detectedKey}` : ''} · {take.duration.toFixed(1)}s
      </Text>

      {/* 1. The voice, exactly as sung. */}
      <Pressable onPress={playVoice} style={styles.row} accessibilityRole="button">
        <Text style={styles.rowIcon}>▶</Text>
        <Text style={styles.rowText}>Play my voice</Text>
      </Pressable>

      {!hasTune ? (
        <Text style={styles.warn}>
          No clear tune detected — hum a phrase of a few notes, a bit louder.
        </Text>
      ) : (
        <>
          {/* 2. The same tune on an instrument. */}
          <Text style={styles.label}>Play it on</Text>
          <View style={styles.chips}>
            {MELODY_INSTRUMENTS.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => {
                  setInstrument(m.id);
                  playTune(m.id);
                }}
                style={[styles.chip, instrument === m.id && styles.chipOn]}
              >
                <Text style={styles.chipText}>
                  {m.emoji} {m.name}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* 3. A whole song built around the tune. */}
          <Text style={styles.label}>Make a song from it</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.genreRow}>
            {SONG_GENRES.map((g) => (
              <Pressable
                key={g}
                onPress={() => setGenre(g)}
                style={[styles.chip, genre === g && styles.chipOn]}
              >
                <Text style={styles.chipText}>{g}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Pressable
            onPress={() => void songFromTune(genre, instrument)}
            disabled={working}
            style={styles.go}
            accessibilityRole="button"
          >
            <LinearGradient
              colors={working ? ['#2A2A32', '#22222A'] : ['#BF5AF2', '#FF375F']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.goInner}
            >
              {working ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.goText}>✦ Make a {genre} song from my tune</Text>
              )}
            </LinearGradient>
          </Pressable>

          {tuneMessage && (
            <Text style={[styles.msg, tuneStatus === 'error' && { color: colors.accent }]}>
              {tuneMessage}
            </Text>
          )}

          {tuneStatus === 'ready' && (
            <View style={styles.replayRow}>
              <Pressable onPress={() => playTuneSong(false)} style={styles.replay}>
                <Text style={styles.replayText}>▶ Song</Text>
              </Pressable>
              <Pressable onPress={() => playTuneSong(true)} style={styles.replay}>
                <Text style={styles.replayText}>▶ Song + my voice</Text>
              </Pressable>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(191,90,242,0.4)',
    backgroundColor: 'rgba(191,90,242,0.07)',
    gap: spacing.sm,
  },
  title: { ...type.title, fontSize: 18, color: colors.text },
  meta: { ...type.caption, color: colors.textDim },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowIcon: { color: colors.ai, fontSize: 14 },
  rowText: { ...type.label, color: colors.text },
  warn: { ...type.caption, color: colors.warn, lineHeight: 16 },
  label: { ...type.caption, letterSpacing: 1, color: colors.textFaint, marginTop: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  genreRow: { gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSolid,
  },
  chipOn: { borderColor: colors.ai, backgroundColor: 'rgba(191,90,242,0.18)' },
  chipText: { ...type.label, fontSize: 13, color: colors.text },
  go: { marginTop: spacing.sm },
  goInner: { paddingVertical: spacing.md, borderRadius: radius.pill, alignItems: 'center' },
  goText: { ...type.label, fontSize: 15, color: '#FFFFFF' },
  msg: { ...type.caption, color: colors.ai, lineHeight: 16 },
  replayRow: { flexDirection: 'row', gap: spacing.sm },
  replay: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.ai,
    alignItems: 'center',
  },
  replayText: { ...type.label, fontSize: 13, color: colors.ai },
});
