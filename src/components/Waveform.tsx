import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { colors } from '@/theme';

interface Props {
  /** Mono PCM. Downsampled to `bars` peaks for display. */
  pcm: number[] | Float32Array | null;
  width: number;
  height: number;
  color: string;
  /** Number of vertical bars. Fewer reads cleaner at small sizes. */
  bars?: number;
  /** 0..1 — draws a progress head, for the player in panel 8. */
  progress?: number;
  /** Mirrors around the centre line, as in the mockups. */
  mirrored?: boolean;
}

/**
 * The waveform that appears on every captured sound in the mockups.
 *
 * It renders the *actual* recorded audio, not a decorative stand-in — which is
 * the whole point of WorldJam. A judge comparing two object cards should see
 * two genuinely different shapes, because a cup and a table really do look
 * different.
 *
 * Peaks are computed with max-abs per bucket rather than RMS: a percussive hit
 * is mostly silence around a sharp transient, and RMS averages that away into
 * a flat smear.
 */
export function Waveform({
  pcm,
  width,
  height,
  color,
  bars = 40,
  progress,
  mirrored = true,
}: Props) {
  const peaks = useMemo(() => {
    if (!pcm || pcm.length === 0) return null;

    const bucket = Math.max(1, Math.floor(pcm.length / bars));
    const out: number[] = [];
    let max = 0;

    for (let b = 0; b < bars; b++) {
      const start = b * bucket;
      const end = Math.min(pcm.length, start + bucket);
      let peak = 0;
      for (let i = start; i < end; i++) {
        const v = Math.abs(pcm[i]);
        if (v > peak) peak = v;
      }
      out.push(peak);
      if (peak > max) max = peak;
    }

    // Normalise so a quiet capture still reads clearly at card size.
    return max > 1e-6 ? out.map((p) => p / max) : out;
  }, [pcm, bars]);

  if (!peaks) {
    // Placeholder keeps layout stable while a capture is being processed.
    return <View style={[styles.placeholder, { width, height }]} />;
  }

  const barWidth = width / bars;
  const gap = Math.min(1.5, barWidth * 0.35);
  const drawWidth = Math.max(0.8, barWidth - gap);
  const centre = height / 2;
  const headIndex = progress != null ? Math.floor(progress * bars) : -1;

  return (
    <Svg width={width} height={height}>
      {peaks.map((peak, i) => {
        // A floor keeps silent stretches visible as a thin line rather than
        // disappearing, which reads as a rendering bug.
        const h = Math.max(1.5, peak * (mirrored ? height * 0.9 : height));
        const y = mirrored ? centre - h / 2 : height - h;
        const played = headIndex >= 0 && i <= headIndex;

        return (
          <Rect
            key={i}
            x={i * barWidth + gap / 2}
            y={y}
            width={drawWidth}
            height={h}
            rx={drawWidth / 2}
            fill={color}
            opacity={headIndex < 0 ? 0.95 : played ? 1 : 0.3}
          />
        );
      })}
    </Svg>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: colors.border,
    borderRadius: 3,
    opacity: 0.4,
  },
});
