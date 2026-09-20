import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { WorldJamObject } from '@/types';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  objects: WorldJamObject[];
  onVolumeChange: (id: string, volume: number) => void;
  onRemove: (id: string) => void;
}

const LEVELS = [0, 0.35, 0.7, 1];

/**
 * Per-object level control.
 *
 * Stepped buttons rather than a slider: this is operated mid-performance,
 * often without looking, and a slider needs precision the situation does not
 * allow. Four steps are enough to duck a layer or push it forward.
 */
export function MixerPanel({ objects, onVolumeChange, onRemove }: Props) {
  if (objects.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>MIX</Text>

      {objects.map((o) => (
        <View key={o.id} style={styles.row}>
          <View style={[styles.swatch, { backgroundColor: o.color }]} />

          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>
              {o.label}
            </Text>
            <Text style={styles.role}>{o.role}</Text>
          </View>

          <View style={styles.levels}>
            {LEVELS.map((lv) => {
              const active = Math.abs(o.volume - lv) < 0.01;
              return (
                <Pressable
                  key={lv}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    onVolumeChange(o.id, lv);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${o.label} volume ${Math.round(lv * 100)} percent`}
                  style={[
                    styles.level,
                    active && { backgroundColor: o.color, borderColor: o.color },
                  ]}
                >
                  <Text style={[styles.levelText, active && styles.levelTextActive]}>
                    {lv === 0 ? 'M' : `${Math.round(lv * 100)}`}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={() => onRemove(o.id)}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${o.label}`}
            hitSlop={8}
            style={styles.remove}
          >
            <Text style={styles.removeText}>✕</Text>
          </Pressable>
        </View>
      ))}
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
  header: { ...type.caption, color: colors.textFaint, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  swatch: { width: 4, height: 30, borderRadius: 2 },
  info: { flex: 1 },
  name: { ...type.body, color: colors.text },
  role: { ...type.caption, color: colors.textFaint },
  levels: { flexDirection: 'row', gap: 4 },
  level: {
    width: 32,
    height: 28,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelText: { ...type.caption, fontSize: 10, color: colors.textDim },
  levelTextActive: { color: colors.bg },
  remove: { padding: spacing.xs },
  removeText: { ...type.body, color: colors.textFaint },
});
