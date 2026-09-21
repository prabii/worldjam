import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '@/theme';
import { Glyph } from '@/components/ui/Glyph';
import { roleInfoFor } from '@/vision/objectRoles';
import type { Loop, WorldJamObject } from '@/types';

interface Props {
  objects: WorldJamObject[];
  loop: Loop | null;
  bpm: number;
  /** Current playhead position in beats, or null when stopped. */
  playheadBeat: number | null;
  onSelectObject?: (id: string) => void;
  onRemoveObject?: (id: string) => void;
  onAddObject?: () => void;
}

/** Horizontal pixels per beat. Wide enough that a 16th is still tappable. */
const PX_PER_BEAT = 44;
const ROW_HEIGHT = 62;
const LANE_LABEL_WIDTH = 116;

/**
 * The multi-track arrangement view.
 *
 * One lane per captured object, with a clip drawn at every beat the
 * arrangement plays it. The clips come from the plan's actual events rather
 * than from a decorative layout, so what the user sees is what will sound —
 * which is the whole reason to show a timeline instead of a play button.
 */
export function ArrangeTimeline({
  objects,
  loop,
  bpm,
  playheadBeat,
  onSelectObject,
  onRemoveObject,
  onAddObject,
}: Props) {
  const bars = loop?.bars ?? 4;
  const totalBeats = bars * 4;
  const trackWidth = totalBeats * PX_PER_BEAT;

  /** Events grouped by the object they belong to. */
  const byObject = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const o of objects) map.set(o.id, []);
    for (const e of loop?.events ?? []) {
      const list = map.get(e.objectId);
      if (list) list.push(e.beat);
    }
    return map;
  }, [objects, loop]);

  const secondsPerBeat = 60 / Math.max(1, bpm);

  return (
    <View style={styles.wrap}>
      {/* Ruler */}
      <View style={styles.rulerRow}>
        <View style={{ width: LANE_LABEL_WIDTH }} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEnabled={false}
        >
          <View style={{ width: trackWidth }}>
            <View style={styles.ruler}>
              {Array.from({ length: bars + 1 }, (_, i) => (
                <Text
                  key={i}
                  style={[styles.rulerTick, { left: i * 4 * PX_PER_BEAT - 10 }]}
                >
                  {(i * 4 * secondsPerBeat).toFixed(0)}s
                </Text>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {/* Lanes */}
          {objects.map((o) => {
            const beats = byObject.get(o.id) ?? [];
            const role = roleInfoFor(o.category);

            return (
              <View key={o.id} style={styles.lane}>
                {/* Sticky-ish label column */}
                <Pressable
                  style={styles.laneLabel}
                  onPress={() => onSelectObject?.(o.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${o.label}, ${role.display}, plays on ${
                    beats.length
                  } beat${beats.length === 1 ? '' : 's'}`}
                >
                  <View style={[styles.laneIcon, { borderColor: o.color + '77' }]}>
                    <Glyph name="waveform" size={18} color={o.color} />
                  </View>
                  <View style={styles.laneText}>
                    <Text style={styles.laneName} numberOfLines={1}>
                      {o.label}
                    </Text>
                    <Text style={styles.laneRole} numberOfLines={1}>
                      {role.display}
                    </Text>
                  </View>
                  {onRemoveObject && (
                    <Pressable
                      onPress={() => onRemoveObject(o.id)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${o.label}`}
                    >
                      <Glyph name="more" size={16} color={colors.textFaint} />
                    </Pressable>
                  )}
                </Pressable>

                {/* Clip track */}
                <View style={[styles.track, { width: trackWidth }]}>
                  {/* Bar lines */}
                  {Array.from({ length: bars }, (_, i) => (
                    <View
                      key={i}
                      style={[styles.barLine, { left: i * 4 * PX_PER_BEAT }]}
                    />
                  ))}

                  {beats.map((beat, i) => (
                    <View
                      key={`${beat}-${i}`}
                      style={[
                        styles.clip,
                        {
                          left: beat * PX_PER_BEAT,
                          borderColor: o.color,
                        },
                      ]}
                    >
                      <LinearGradient
                        colors={[o.color + 'CC', o.color + '55']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                      />
                    </View>
                  ))}
                </View>
              </View>
            );
          })}

          {/* Playhead spans every lane, so it is drawn once over the stack. */}
          {playheadBeat != null && objects.length > 0 && (
            <View
              pointerEvents="none"
              style={[
                styles.playhead,
                {
                  left: LANE_LABEL_WIDTH + (playheadBeat % totalBeats) * PX_PER_BEAT,
                  height: objects.length * ROW_HEIGHT,
                },
              ]}
            />
          )}

          {objects.length === 0 && (
            <View style={styles.emptyLane}>
              <Text style={styles.emptyText}>
                Record an object and it will appear here as a track.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {onAddObject && (
        <Pressable
          onPress={onAddObject}
          style={styles.addRow}
          accessibilityRole="button"
          accessibilityLabel="Add another object"
        >
          <Glyph name="plus" size={18} color="#C4B5FD" />
          <Text style={styles.addText}>Add Another Object</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },

  rulerRow: { flexDirection: 'row' },
  ruler: { height: 20 },
  rulerTick: {
    position: 'absolute',
    fontSize: 10.5,
    fontWeight: '600',
    color: colors.textFaint,
  },

  lane: { flexDirection: 'row', height: ROW_HEIGHT, alignItems: 'center' },
  laneLabel: {
    width: LANE_LABEL_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingRight: 8,
    borderRightWidth: 1,
    borderRightColor: 'rgba(120,140,190,0.2)',
    height: '100%',
  },
  laneIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18,22,34,0.9)',
  },
  laneText: { flex: 1 },
  laneName: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  laneRole: { fontSize: 11, color: colors.textDim },

  track: { height: '100%', justifyContent: 'center' },
  barLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(120,140,190,0.16)',
  },
  clip: {
    position: 'absolute',
    width: PX_PER_BEAT - 8,
    height: 34,
    borderRadius: 7,
    borderWidth: 1,
    overflow: 'hidden',
  },

  playhead: {
    position: 'absolute',
    top: 0,
    width: 2,
    backgroundColor: '#FFFFFF',
  },

  emptyLane: { paddingVertical: 30, paddingHorizontal: 20, width: 320 },
  emptyText: { fontSize: 13, color: colors.textDim, lineHeight: 19 },

  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(168,85,247,0.45)',
  },
  addText: { fontSize: 14, fontWeight: '600', color: '#C4B5FD' },
});
