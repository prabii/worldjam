import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { transport } from '@/audio/transport';
import type { ArrangementPlan, WorldJamObject } from '@/types';
import { ObjectIcon } from './ObjectIcon';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  plan: ArrangementPlan | null;
  objects: WorldJamObject[];
  playing: boolean;
}

/**
 * "Try this pattern" — panel 5 of the mockups.
 *
 * Shows the arrangement as a sequence of object icons with hit counts
 * (Mug x2 > Table x1 > Keys x2), with the current step highlighted while the
 * transport runs.
 *
 * Beyond guiding the player, this scripts the demo: with the next object always
 * named on screen, a nervous presenter cannot wander, and a judge handed the
 * phone knows instantly what to do with it.
 */
export function RhythmGuide({ plan, objects, playing }: Props) {
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    if (!playing) {
      setBeat(0);
      return;
    }
    // Polled rather than pushed from the audio thread: a visual a frame late
    // is invisible, whereas waking React per scheduled event is not free.
    const id = setInterval(() => {
      setBeat(Math.floor(transport.getState().position) % 4);
    }, 60);
    return () => clearInterval(id);
  }, [playing]);

  const byLabel = useMemo(
    () => new Map(objects.map((o) => [o.label.toLowerCase(), o])),
    [objects],
  );

  /** One entry per beat of the bar, listing what plays there. */
  const steps = useMemo(() => {
    if (!plan) return [];
    const perBeat: Array<WorldJamObject[]> = [[], [], [], []];

    for (const entry of plan.objectPattern) {
      const obj = byLabel.get(entry.object.toLowerCase());
      if (!obj) continue;
      for (const b of entry.beats) {
        const idx = Math.floor(b) - 1;
        if (idx >= 0 && idx < 4) perBeat[idx].push(obj);
      }
    }
    return perBeat;
  }, [plan, byLabel]);

  /** Per-object hit counts, for the "x2" labels in the mockup. */
  const counts = useMemo(() => {
    if (!plan) return [];
    return plan.objectPattern
      .map((entry) => ({
        object: byLabel.get(entry.object.toLowerCase()),
        count: entry.beats.length,
      }))
      .filter((e): e is { object: WorldJamObject; count: number } => e.object != null);
  }, [plan, byLabel]);

  if (!plan || counts.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          Capture a few objects, then tap Arrange to get a pattern.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Try this pattern:</Text>
        <Text style={[styles.source, plan.source === 'gemma' && { color: colors.ai }]}>
          {plan.source === 'gemma' ? 'Gemma' : 'rule-based'}
        </Text>
      </View>

      {/* The sequence, as panel 5 shows it: icon, name, count, chevron. */}
      <View style={styles.sequence}>
        {/* Keyed by position as well as id: the same object can appear more
            than once in a sequence, and an id alone then collides. */}
        {counts.map((entry, i) => (
          <React.Fragment key={`${entry.object.id}-${i}`}>
            <View style={styles.seqItem}>
              <View style={[styles.seqIcon, { borderColor: entry.object.color }]}>
                <ObjectIcon
                  category={entry.object.category}
                  color={entry.object.color}
                  size={24}
                />
              </View>
              <Text style={styles.seqLabel} numberOfLines={1}>
                {entry.object.label}
              </Text>
              <Text style={[styles.seqCount, { color: entry.object.color }]}>
                x{entry.count}
              </Text>
            </View>
            {i < counts.length - 1 && <Text style={styles.chevron}>›</Text>}
          </React.Fragment>
        ))}
      </View>

      {/* Beat grid with the playhead. */}
      <View style={styles.grid}>
        {steps.map((slot, i) => {
          const active = playing && beat === i;
          return (
            <View key={i} style={[styles.cell, active && styles.cellActive]}>
              <Text style={[styles.beatNum, active && styles.beatNumActive]}>{i + 1}</Text>
              <View style={styles.chips}>
                {slot.map((o, j) => (
                  <View key={j} style={[styles.chip, { backgroundColor: o.color }]} />
                ))}
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: playing ? `${((beat + 1) / 4) * 100}%` : '0%' },
          ]}
        />
      </View>
      <Text style={styles.stepText}>
        {playing ? `Beat ${beat + 1} of 4` : `${plan.bpm} BPM · ${plan.bars} bars`}
      </Text>
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  header: { ...type.title, fontSize: 17, color: colors.text },
  source: { ...type.caption, color: colors.textFaint },
  sequence: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  seqItem: { alignItems: 'center', gap: 2, minWidth: 54 },
  seqIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSolid,
  },
  seqLabel: { ...type.caption, fontSize: 10, color: colors.textDim },
  seqCount: { ...type.caption, fontSize: 10 },
  chevron: { ...type.title, color: colors.textFaint, marginHorizontal: 2 },
  grid: { flexDirection: 'row', gap: spacing.sm },
  cell: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSolid,
    padding: spacing.sm,
    justifyContent: 'space-between',
  },
  cellActive: { borderColor: colors.live, backgroundColor: colors.liveDim },
  beatNum: { ...type.caption, fontSize: 9, color: colors.textFaint },
  beatNumActive: { color: colors.live },
  chips: { flexDirection: 'row', gap: 3, flexWrap: 'wrap' },
  chip: { width: 12, height: 4, borderRadius: 2 },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: colors.live },
  stepText: { ...type.caption, color: colors.textFaint, textAlign: 'center' },
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
