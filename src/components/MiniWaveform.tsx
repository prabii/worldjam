import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface Props {
  /** Any stable string — the same seed always draws the same shape. */
  seed: string;
  color: string;
  bars?: number;
  height?: number;
}

/**
 * The small waveform strip on a library row.
 *
 * Drawn from a hash of the jam's id rather than its audio. Decoding every
 * saved recording to draw a list would mean reading megabytes of PCM per
 * screenful, and the strip's job here is to make rows distinguishable at a
 * glance, which a stable per-jam shape does. The real waveform is drawn on
 * the track screen, where the audio is already loaded.
 */
export function MiniWaveform({ seed, color, bars = 48, height = 26 }: Props) {
  const heights = useMemo(() => {
    // xorshift seeded from the id: deterministic, and spread out enough that
    // two adjacent ids do not produce near-identical shapes.
    let state = 0;
    for (let i = 0; i < seed.length; i++) {
      state = (state * 31 + seed.charCodeAt(i)) >>> 0;
    }
    if (state === 0) state = 0x9e3779b9;

    const next = () => {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 0xffffffff;
    };

    return Array.from({ length: bars }, (_, i) => {
      // An envelope so the strip reads as a recorded sound rather than noise.
      const t = i / (bars - 1);
      const envelope = Math.sin(t * Math.PI) ** 0.7;
      return Math.max(0.08, envelope * (0.35 + next() * 0.65));
    });
  }, [seed, bars]);

  return (
    <View style={[styles.row, { height }]}>
      {heights.map((h, i) => (
        <View
          key={i}
          style={[styles.bar, { height: Math.max(2, h * height) }]}
        >
          <LinearGradient
            colors={[color, color + '66']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  bar: { flex: 1, minWidth: 1.5, borderRadius: 1.5, overflow: 'hidden' },
});
