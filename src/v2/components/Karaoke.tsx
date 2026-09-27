import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { MusicPlan, PlanLyrics } from '../contracts/musicPlan';
import { karaokeLines } from '../audio/karaoke';
import { color, font, radius, space } from '../theme';

/** Lyrics with the current line lit, the next lines dimmed — the user sings along. */
export function Karaoke({ lyrics, plan, durationMs, positionMs, playing }: { lyrics: PlanLyrics; plan: MusicPlan | null; durationMs: number; positionMs: number; playing: boolean }) {
  const lines = useMemo(() => karaokeLines(lyrics, plan, durationMs), [lyrics, plan, durationMs]);
  let current = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].startMs <= positionMs) current = i;
  const from = Math.max(0, current - 1);
  const shown = playing || current >= 0 ? lines.slice(from, from + 5) : lines.slice(0, 5);
  return (
    <View style={styles.box} accessibilityLabel="Lyrics">
      <Text style={font.label}>{lyrics.title} · sing along</Text>
      {shown.map((l, k) => {
        const idx = (playing || current >= 0 ? from : 0) + k;
        const on = idx === current;
        return (
          <Text key={`${idx}:${l.text}`} style={[styles.line, on ? styles.on : idx < current ? styles.past : styles.next]}>
            {l.text}
          </Text>
        );
      })}
      {!lines.length && <Text style={font.body}>No lines yet.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: space.md, gap: 6, borderRadius: radius.card, backgroundColor: color.bg },
  line: { fontSize: 17, lineHeight: 24 },
  on: { color: color.cyan, fontWeight: '700', fontSize: 20, lineHeight: 28 },
  past: { color: color.textMuted },
  next: { color: color.textSecondary },
});
