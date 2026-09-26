import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { transport } from '@/audio/transport';
import { describeGrid, gridRows, stepBeats, type BeatGrid, type GridSteps } from '@/audio/beatGrid';
import { describeFeel } from '@/audio/groove';
import type { ArrangementPlan, WorldJamObject } from '@/types';
import { ObjectIcon } from './ObjectIcon';
import { gradients } from '@/theme/gradients';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  grid: BeatGrid;
  objects: WorldJamObject[];
  playing: boolean;
  recording: boolean;
  aiMode: boolean;
  arranging: boolean;
  plan: ArrangementPlan | null;
  bpm: number;
  modelReady: boolean;
  onToggleStep: (id: string, step: number) => void;
  onPlaySound: (id: string) => void;
  onSetSteps: (steps: GridSteps) => void;
  onToggleRecord: () => void;
  onClear: () => void;
  onSetAiMode: (on: boolean) => void;
  onReproduce: () => void;
  onAddSound: () => void;
}

/**
 * The studio's step grid — one row per captured sound, one column per step.
 *
 * Rows appear as sounds are captured, so the grid grows with the session:
 * one sound is a single lane, four sounds a 4x8 kit. The user programs a beat
 * by tapping cells, or hits REC and taps the sound names in time to play it
 * in. The AI Producer switch then hands that beat to Gemma, which keeps every
 * hit and builds the rest of the track around it.
 */
export function BeatGridPanel(props: Props) {
  const { grid, objects, playing, recording, aiMode, arranging, plan, bpm, modelReady } = props;
  const rows = gridRows(grid, objects);
  const step = usePlayheadStep(playing, grid.steps);
  const perBeat = grid.steps / 4;

  const recPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!recording) {
      recPulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(recPulse, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(recPulse, { toValue: 0, duration: 500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [recording, recPulse]);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titles}>
          <Text style={styles.title}>Your beat</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {recording ? 'Recording — tap a sound name in time' : describeGrid(grid, objects)}
          </Text>
        </View>

        <View style={styles.seg}>
          {([8, 16] as GridSteps[]).map((n) => (
            <Pressable
              key={n}
              onPress={() => props.onSetSteps(n)}
              accessibilityRole="button"
              accessibilityState={{ selected: grid.steps === n }}
              accessibilityLabel={`${n} steps`}
              style={[styles.segItem, grid.steps === n && styles.segItemOn]}
            >
              <Text style={[styles.segText, grid.steps === n && styles.segTextOn]}>{n}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Beat numbers over the columns. */}
      <View style={styles.row}>
        <View style={styles.labelCell} />
        <View style={styles.cells}>
          {Array.from({ length: 4 }, (_, b) => (
            <View key={b} style={styles.beatGroup}>
              <Text style={[styles.beatNum, playing && Math.floor(step / perBeat) === b && styles.beatNumOn]}>
                {b + 1}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {rows.map(({ object, row }) => (
        <View key={object.id} style={styles.row}>
          <Pressable
            onPress={() => props.onPlaySound(object.id)}
            accessibilityRole="button"
            accessibilityLabel={recording ? `Record ${object.label}` : `Play ${object.label}`}
            style={({ pressed }) => [
              styles.labelCell,
              styles.label,
              { borderColor: object.color },
              pressed && { backgroundColor: `${object.color}44` },
            ]}
          >
            <ObjectIcon category={object.category} color={object.color} size={14} />
            <Text style={styles.labelText} numberOfLines={1}>
              {object.label}
            </Text>
          </Pressable>

          <View style={styles.cells}>
            {Array.from({ length: 4 }, (_, b) => (
              <View key={b} style={styles.beatGroup}>
                {row.slice(b * perBeat, (b + 1) * perBeat).map((on, j) => {
                  const i = b * perBeat + j;
                  const isHead = playing && i === step;
                  return (
                    <Pressable
                      key={i}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        props.onToggleStep(object.id, i);
                        // Hear the sound as it is placed, when nothing else is playing.
                        if (!on && !playing) props.onPlaySound(object.id);
                      }}
                      hitSlop={2}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`${object.label}, beat ${b + 1}, step ${j + 1}`}
                      style={[
                        styles.cell,
                        j === 0 && styles.cellOnBeat,
                        on && { backgroundColor: object.color, borderColor: object.color },
                        isHead && (on ? styles.cellHit : styles.cellHead),
                      ]}
                    />
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      ))}

      {/* The grid grows as sounds are captured: the next lane is one tap away. */}
      <Pressable onPress={props.onAddSound} accessibilityRole="button" style={styles.addRow}>
        <Text style={styles.addText}>
          {objects.length === 0 ? '+ Capture your first sound' : '+ Add a sound (adds a row)'}
        </Text>
      </Pressable>

      <View style={styles.tools}>
        <Pressable
          onPress={props.onToggleRecord}
          disabled={objects.length === 0}
          accessibilityRole="button"
          accessibilityState={{ selected: recording }}
          accessibilityLabel={recording ? 'Stop recording' : 'Record your beat live'}
          style={[styles.tool, recording && styles.toolRec]}
        >
          <Animated.View
            style={[
              styles.recDot,
              { opacity: recording ? recPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) : 1 },
            ]}
          />
          <Text style={[styles.toolText, recording && { color: colors.text }]}>
            {recording ? 'Stop' : 'Rec'}
          </Text>
        </Pressable>

        <Pressable
          onPress={props.onClear}
          accessibilityRole="button"
          accessibilityLabel="Clear the beat"
          style={styles.tool}
        >
          <Text style={styles.toolText}>Clear</Text>
        </Pressable>
      </View>

      {/* --- AI producer --- */}
      <LinearGradient
        colors={aiMode ? ['rgba(91,157,255,0.22)', 'rgba(193,88,232,0.22)'] : ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.04)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.ai, aiMode && styles.aiOn]}
      >
        <View style={styles.aiHeader}>
          <View style={styles.aiTitles}>
            <Text style={styles.aiTitle}>✦ AI Producer</Text>
            <Text style={styles.aiSub}>
              {modelReady ? 'Gemma' : 'Rule-based director'} keeps your beat and builds the full track
              around it: parts for your other sounds, bass, chords, form and groove.
            </Text>
          </View>
          <Switch
            value={aiMode}
            onValueChange={props.onSetAiMode}
            disabled={arranging}
            trackColor={{ false: colors.surfaceRaised, true: gradients.brandShort[1] }}
            thumbColor={aiMode ? '#FFFFFF' : '#9CA3AF'}
            accessibilityLabel="AI producer mode"
          />
        </View>

        {arranging && aiMode && (
          <View style={styles.aiStatus}>
            <ActivityIndicator size="small" color={colors.ai} />
            <Text style={styles.aiStatusText}>
              {modelReady ? 'Gemma is producing around your beat…' : 'Producing…'}
            </Text>
          </View>
        )}

        {aiMode && !arranging && plan && (
          <View style={styles.aiStatus}>
            <Text style={styles.aiFeel}>
              {plan.style} · {describeFeel(plan.style, bpm, plan.bars)}
            </Text>
            <Pressable onPress={props.onReproduce} accessibilityRole="button" style={styles.reproduce}>
              <Text style={styles.reproduceText}>↻ New take</Text>
            </Pressable>
          </View>
        )}
      </LinearGradient>
    </View>
  );
}

/** Current step under the playhead, polled like the rhythm guide's beat. */
function usePlayheadStep(playing: boolean, steps: GridSteps): number {
  const [step, setStep] = useState(-1);
  useEffect(() => {
    if (!playing) {
      setStep(-1);
      return;
    }
    const unit = stepBeats(steps);
    const id = setInterval(() => {
      const pos = transport.getState().position;
      const next = Math.floor((((pos % 4) + 4) % 4) / unit);
      setStep((prev) => (prev === next ? prev : next));
    }, 40);
    return () => clearInterval(id);
  }, [playing, steps]);
  return step;
}

const LABEL_W = 78;

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 6,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  titles: { flex: 1 },
  title: { ...type.title, fontSize: 17, color: colors.text },
  subtitle: { ...type.caption, color: colors.textDim, marginTop: 2 },

  seg: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  segItem: { paddingHorizontal: spacing.md, paddingVertical: 6 },
  segItemOn: { backgroundColor: colors.vibeDim },
  segText: { ...type.caption, fontWeight: '700', color: colors.textFaint },
  segTextOn: { color: colors.vibe },

  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  labelCell: { width: LABEL_W },
  label: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    backgroundColor: colors.surfaceSolid,
  },
  labelText: { ...type.caption, fontSize: 11, color: colors.text, flex: 1 },

  cells: { flex: 1, flexDirection: 'row', gap: 5 },
  beatGroup: { flex: 1, flexDirection: 'row', gap: 2, justifyContent: 'center' },
  beatNum: { ...type.caption, fontSize: 9, color: colors.textFaint },
  beatNumOn: { color: colors.live },

  cell: {
    flex: 1,
    height: 30,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  cellOnBeat: { backgroundColor: 'rgba(255,255,255,0.08)' },
  cellHead: { borderColor: colors.live, backgroundColor: colors.liveDim },
  cellHit: { borderColor: '#FFFFFF', transform: [{ scale: 1.08 }] },

  addRow: {
    height: 32,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  addText: { ...type.caption, color: colors.textDim },

  tools: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toolRec: { backgroundColor: 'rgba(244,63,94,0.28)', borderColor: '#F43F5E' },
  toolText: { ...type.label, fontSize: 13, color: colors.textDim },
  recDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#F43F5E' },

  ai: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  aiOn: { borderColor: 'rgba(167,139,250,0.6)' },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  aiTitles: { flex: 1, gap: 2 },
  aiTitle: { ...type.label, fontSize: 15, color: colors.text },
  aiSub: { ...type.caption, color: colors.textDim },
  aiStatus: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  aiStatusText: { ...type.caption, color: colors.ai },
  aiFeel: { ...type.caption, color: colors.ai, flex: 1, textTransform: 'capitalize' },
  reproduce: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.ai,
  },
  reproduceText: { ...type.caption, fontWeight: '700', color: colors.ai },
});
