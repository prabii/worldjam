import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { AccompanimentLayer, VocalTake, WorldJamObject } from '@/types';
import { ObjectIcon } from './ObjectIcon';
import { Waveform } from './Waveform';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  objects: WorldJamObject[];
  pcmBySlot: Map<number, number[]>;
  vocalTake: VocalTake | null;
  accompaniment: AccompanimentLayer[];
  onToggleObject: (id: string) => void;
  onTriggerObject: (id: string) => void;
}

/**
 * "Your World, Your Music" — panel 6 of the mockups.
 *
 * Every captured source listed with its own waveform and a "(real)" marker,
 * plus the voice and the AI accompaniment. The word (real) is doing the
 * product's main argument: these are not samples, and the waveforms beside
 * each row are the evidence.
 */
export function LayerList({
  objects,
  pcmBySlot,
  vocalTake,
  accompaniment,
  onToggleObject,
  onTriggerObject,
}: Props) {
  const muted = (o: WorldJamObject) => o.volume === 0;

  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>Your World, Your Music</Text>

      {objects.map((o) => (
        <Pressable
          key={o.id}
          onPress={() => onTriggerObject(o.id)}
          onLongPress={() => {
            Haptics.selectionAsync().catch(() => {});
            onToggleObject(o.id);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${o.label}, ${muted(o) ? 'muted' : 'playing'}`}
          accessibilityHint="Tap to play, long press to mute"
          style={[styles.row, muted(o) && styles.rowMuted]}
        >
          <ObjectIcon category={o.category} color={o.color} size={18} />
          <Text style={styles.name} numberOfLines={1}>
            {o.label} <Text style={styles.realTag}>(real)</Text>
          </Text>
          <Waveform
            pcm={pcmBySlot.get(o.slot) ?? null}
            width={110}
            height={20}
            color={o.color}
            bars={34}
          />
        </Pressable>
      ))}

      {vocalTake && (
        <View style={styles.row}>
          <ObjectIcon category="voice" color={colors.ai} size={18} />
          <Text style={styles.name} numberOfLines={1}>
            Vocals <Text style={styles.realTag}>(you)</Text>
          </Text>
          <Waveform
            pcm={pcmBySlot.get(vocalTake.slot) ?? null}
            width={110}
            height={20}
            color={colors.ai}
            bars={34}
          />
        </View>
      )}

      {accompaniment.length > 0 && (
        <View style={styles.row}>
          <View style={styles.aiGlyph}>
            <Text style={styles.aiGlyphText}>✦</Text>
          </View>
          <Text style={styles.name} numberOfLines={1}>
            AI Background
          </Text>
          <Text style={styles.layerNames} numberOfLines={1}>
            {accompaniment.join(' · ')}
          </Text>
        </View>
      )}
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
  header: { ...type.title, fontSize: 17, color: colors.text, marginBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowMuted: { opacity: 0.35 },
  name: { ...type.body, color: colors.text, flex: 1 },
  realTag: { ...type.caption, color: colors.textFaint },
  layerNames: { ...type.caption, color: colors.textFaint, width: 110, textAlign: 'right' },
  aiGlyph: {
    width: 18,
    alignItems: 'center',
  },
  aiGlyphText: { color: colors.ai, fontSize: 14 },
});
