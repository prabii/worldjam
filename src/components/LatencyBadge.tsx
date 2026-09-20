import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LATENCY_BUDGET_MS, measureLatency } from '@/audio/engine';
import type { LatencyReport } from '@/types';
import { colors, radius, spacing, type } from '@/theme';

/**
 * Live readout of the one number HLD v2 §0 says decides the project.
 *
 * It is on the main screen, not hidden in a debug menu, for two reasons: the
 * team needs to notice a regression the moment it appears, and a judge asking
 * "how fast is it really?" gets an answer measured on the device in front of
 * them rather than a claim.
 */
export function LatencyBadge({ compact = false }: { compact?: boolean }) {
  const [report, setReport] = useState<LatencyReport | null>(null);

  const run = useCallback(() => {
    setReport(measureLatency());
  }, []);

  useEffect(() => {
    // One measurement after the stream has settled; re-measuring constantly
    // would itself add load to the audio path.
    const t = setTimeout(run, 900);
    return () => clearTimeout(t);
  }, [run]);

  if (!report) {
    return (
      <View style={[styles.badge, compact && styles.compact]}>
        <Text style={styles.measuring}>measuring…</Text>
      </View>
    );
  }

  const total = report.dispatchMs + report.streamLatencyMs;
  const tone = !report.nativeAvailable
    ? colors.danger
    : report.passes
      ? colors.live
      : colors.warn;

  return (
    <Pressable
      onPress={run}
      accessibilityRole="button"
      accessibilityLabel="Re-measure audio latency"
      style={[styles.badge, { borderColor: tone }, compact && styles.compact]}
    >
      <View style={[styles.dot, { backgroundColor: tone }]} />

      {report.nativeAvailable ? (
        <Text style={[styles.value, { color: tone }]}>
          {total.toFixed(1)}
          <Text style={styles.unit}> ms</Text>
        </Text>
      ) : (
        <Text style={[styles.value, { color: tone }]}>no native audio</Text>
      )}

      {!compact && report.nativeAvailable && (
        <Text style={styles.detail}>
          {report.sampleRate / 1000}k · {report.bufferFrames}f · budget {LATENCY_BUDGET_MS}ms
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  compact: { paddingVertical: 6, paddingHorizontal: spacing.md },
  dot: { width: 7, height: 7, borderRadius: 4 },
  value: { ...type.label, fontVariant: ['tabular-nums'] },
  unit: { ...type.caption, color: colors.textDim },
  detail: { ...type.mono, fontSize: 10, color: colors.textFaint },
  measuring: { ...type.caption, color: colors.textFaint },
});
