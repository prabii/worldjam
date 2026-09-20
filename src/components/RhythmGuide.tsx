import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { transport } from '@/audio/transport';
import type { ArrangementPlan, WorldJamObject } from '@/types';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  plan: ArrangementPlan | null;
  objects: WorldJamObject[];
  playing: boolean;
}

/**
 * Feature A4 — the rhythm guide.
 *
 * Beyond telling the user what to hit, this scripts the demo: with the next
 * object always named on screen, a nervous presenter cannot wander, and a
 * judge handed the phone knows instantly what to do with it.
 */
export function RhythmGuide({ plan, objects, playing }: Props) {
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    if (!playing) {
      setBeat(0);
      return;
    }
    const id = setInterval(() => {
      setBeat(Math.floor(transport.getState().position) % 4);
    }, 60);
    return () => clearInterval(id);
  }, [playing]);

  if (!plan || plan.objectPattern.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          Capture a few objects, then tap Arrange to get a pattern.
        </Text>
      </View>
    );
  }

  const byLabel = new Map(objects.map((o) => [o.label.toLowerCase(), o]));

  // Flatten the plan into "what plays on each beat" so the guide reads as a
  // sequence rather than a per-object table.
  const perBeat: Array<Array<{ label: string; color: string }>> = [[], [], [], []];
  for (const entry of plan.objectPattern) {
    const obj = byLabel.get(entry.object.toLowerCase());
    for (const b of entry.beats) {
      const idx = Math.floor(b) - 1;
      if (idx >= 0 && idx < 4) {
        perBeat[idx].push({ label: entry.object, color: obj?.color ?? colors.textDim });
      }
    }
  }

  const sequence = perBeat
    .map((slot) => (slot.length ? slot.map((s) => s.label).join('+') : '–'))
    .join('  →  ');

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>RHYTHM GUIDE</Text>
        <Text style={[styles.source, plan.source === 'gemma' && { color: colors.ai }]}>
          {plan.source === 'gemma' ? 'Gemma 4' : 'rule-based'}
        </Text>
      </View>

      <Text style={styles.sequence}>{sequence}</Text>

      <View style={styles.grid}>
        {perBeat.map((slot, i) => (
          <View
            key={i}
            style={[
              styles.cell,
              playing && beat === i && styles.cellActive,
              i === 0 && styles.cellDown,
            ]}
          >
            <Text style={[styles.beatNum, playing && beat === i && styles.beatNumActive]}>
              {i + 1}
            </Text>
            <View style={styles.chips}>
              {slot.map((s, j) => (
                <View key={j} style={[styles.chip, { backgroundColor: s.color }]} />
              ))}
            </View>
          </View>
        ))}
      </View>

      {plan.reasoning && <Text style={styles.reasoning}>{plan.reasoning}</Text>}
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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  header: { ...type.caption, color: colors.textFaint },
  source: { ...type.caption, color: colors.textFaint },
  sequence: { ...type.title, fontSize: 18, color: colors.text },
  grid: { flexDirection: 'row', gap: spacing.sm },
  cell: {
    flex: 1,
    height: 58,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSolid,
    padding: spacing.sm,
    justifyContent: 'space-between',
  },
  cellDown: { borderColor: colors.borderStrong },
  cellActive: { borderColor: colors.live, backgroundColor: colors.liveDim },
  beatNum: { ...type.caption, color: colors.textFaint },
  beatNumActive: { color: colors.live },
  chips: { flexDirection: 'row', gap: 3, flexWrap: 'wrap' },
  chip: { width: 16, height: 5, borderRadius: 3 },
  reasoning: { ...type.caption, color: colors.textFaint, fontWeight: '500' },
  empty: {
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
  },
  emptyText: { ...type.body, color: colors.textFaint, textAlign: 'center' },
});
