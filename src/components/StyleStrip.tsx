import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { Style } from '@/types';
import { colors, radius, spacing, type } from '@/theme';

const STYLES: Array<{ id: Style; label: string }> = [
  { id: 'natural', label: 'Natural' },
  { id: 'jazz', label: 'Jazz' },
  { id: 'lofi', label: 'Lo-fi' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'electronic', label: 'Electronic' },
  { id: 'rock', label: 'Rock' },
];

interface Props {
  active: Style;
  disabled?: boolean;
  onSelect: (style: Style) => void;
}

/**
 * The genre-morph control (feature A3). Tapping a style re-arranges the same
 * captured sounds — the demo beat where a judge hears their own cup become
 * jazz.
 */
export function StyleStrip({ active, disabled, onSelect }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {STYLES.map((s) => {
        const isActive = s.id === active;
        return (
          <Pressable
            key={s.id}
            disabled={disabled}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onSelect(s.id);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            style={[styles.chip, isActive && styles.chipActive, disabled && styles.disabled]}
          >
            <Text style={[styles.text, isActive && styles.textActive]}>{s.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.ai, backgroundColor: colors.aiDim },
  disabled: { opacity: 0.4 },
  text: { ...type.label, color: colors.textDim },
  textActive: { color: colors.ai },
});
