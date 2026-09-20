import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { transport } from '@/audio/transport';
import { lineAtBeat, type LyricSet } from '@/ai/lyrics';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  lyrics: LyricSet | null;
  bars: number;
  playing: boolean;
  /** Speaks the upcoming line, for users who cannot read the screen. */
  onSpeakLine?: (text: string) => void;
  speakEnabled?: boolean;
}

/**
 * Karaoke-style lyric display.
 *
 * Shows the current line large and the next line dimmed beneath it, so the
 * singer can see what is coming. Three lines at most on screen: more than
 * that and a performer cannot find their place at a glance.
 *
 * When voice guidance is on, each line is also spoken one beat ahead — the
 * accessibility path, so a blind user can sing along without reading.
 */
export function LyricDisplay({
  lyrics,
  bars,
  playing,
  onSpeakLine,
  speakEnabled,
}: Props) {
  const [current, setCurrent] = useState(-1);
  const fade = useRef(new Animated.Value(1)).current;
  const spokenFor = useRef(-1);

  useEffect(() => {
    if (!lyrics || !playing) {
      setCurrent(-1);
      spokenFor.current = -1;
      return;
    }

    const id = setInterval(() => {
      const beat = transport.getState().position;
      const idx = lineAtBeat(lyrics, beat, bars);

      setCurrent((prev) => {
        if (idx !== prev) {
          // Brief fade so a line change reads as deliberate rather than a
          // flicker.
          fade.setValue(0.3);
          Animated.timing(fade, {
            toValue: 1,
            duration: 220,
            useNativeDriver: true,
          }).start();
        }
        return idx;
      });

      // Speak the NEXT line slightly ahead, so a blind singer hears it in
      // time to sing it rather than after the moment has passed.
      if (speakEnabled && onSpeakLine && idx >= 0) {
        const next = (idx + 1) % lyrics.lines.length;
        const nextBeat = lyrics.lines[next].beat;
        const loopBeats = bars * 4;
        const pos = ((beat % loopBeats) + loopBeats) % loopBeats;
        const until = (nextBeat - pos + loopBeats) % loopBeats;

        if (until > 0 && until < 1.2 && spokenFor.current !== next) {
          spokenFor.current = next;
          onSpeakLine(lyrics.lines[next].text);
        }
      }
    }, 80);

    return () => clearInterval(id);
  }, [lyrics, playing, bars, fade, onSpeakLine, speakEnabled]);

  if (!lyrics) return null;

  const lines = lyrics.lines;
  const currentLine = current >= 0 ? lines[current] : null;
  const nextLine = current >= 0 ? lines[(current + 1) % lines.length] : lines[0];

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>LYRICS</Text>
        <Text style={[styles.source, lyrics.source === 'gemma' && { color: colors.ai }]}>
          {lyrics.source === 'gemma' ? `Gemma · ${lyrics.mood}` : `template · ${lyrics.mood}`}
        </Text>
      </View>

      {playing && currentLine ? (
        <>
          <Animated.Text style={[styles.currentLine, { opacity: fade }]}>
            {currentLine.text}
          </Animated.Text>
          <Text style={styles.nextLine} numberOfLines={1}>
            {nextLine.text}
          </Text>
        </>
      ) : (
        <View style={styles.staticList}>
          {lines.map((l, i) => (
            <Text key={i} style={styles.staticLine} numberOfLines={1}>
              {l.text}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.hookRow}>
        <Text style={styles.hookLabel}>HOOK</Text>
        <Text style={styles.hookText} numberOfLines={1}>
          {lyrics.hook}
        </Text>
      </View>

      {/* Beat markers, so a singer can see where lines land. */}
      <View style={styles.timeline}>
        {lines.map((l, i) => (
          <View
            key={i}
            style={[
              styles.tick,
              { left: `${(l.beat / (bars * 4)) * 100}%` },
              current === i && styles.tickActive,
            ]}
          />
        ))}
      </View>
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
    gap: spacing.sm,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  header: { ...type.caption, color: colors.textFaint },
  source: { ...type.caption, color: colors.textFaint },

  currentLine: {
    ...type.title,
    fontSize: 21,
    lineHeight: 28,
    color: colors.text,
    minHeight: 28,
  },
  nextLine: { ...type.body, color: colors.textFaint },

  staticList: { gap: 3 },
  staticLine: { ...type.body, color: colors.textDim },

  hookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  hookLabel: { ...type.caption, fontSize: 9, color: colors.vibe },
  hookText: { ...type.label, color: colors.vibe, flex: 1 },

  timeline: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: spacing.xs,
  },
  tick: {
    position: 'absolute',
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.textFaint,
  },
  tickActive: { backgroundColor: colors.vibe, width: 6, height: 5, top: -1 },
});
