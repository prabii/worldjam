import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { Style } from '@/types';
import { colors, radius, spacing, type } from '@/theme';

/**
 * "Choose a vibe" — panel 7 of the product mockups.
 *
 * A fixed 3x2 grid rather than a scrolling strip: every option is visible at
 * once, which matters when the demo beat is "say a genre and watch the same
 * sounds transform". A judge should not have to scroll to find Jazz.
 */
const VIBES: Array<{ id: Style; label: string }> = [
  { id: 'chill', label: 'Chill' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'edm', label: 'EDM' },
  { id: 'lofi', label: 'Lofi' },
  { id: 'rock', label: 'Rock' },
  { id: 'jazz', label: 'Jazz' },
];

interface Props {
  active: Style;
  busy?: boolean;
  onSelect: (style: Style) => void;
}

export function VibeGrid({ active, busy, onSelect }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>Choose a vibe</Text>

      <View style={styles.grid}>
        {VIBES.map((v) => {
          const isActive = v.id === active;
          return (
            <Pressable
              key={v.id}
              disabled={busy}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                onSelect(v.id);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive, disabled: busy }}
              style={[styles.chip, isActive && styles.chipActive, busy && styles.busy]}
            >
              <Text style={[styles.label, isActive && styles.labelActive]}>{v.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg, alignItems: 'center' },
  header: { ...type.title, color: colors.text },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.md,
  },
  chip: {
    // Three per row at phone width, with room for "Cinematic".
    minWidth: 98,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
  },
  chipActive: {
    borderColor: colors.vibe,
    backgroundColor: colors.vibeDim,
  },
  busy: { opacity: 0.5 },
  label: { ...type.label, color: colors.textDim },
  labelActive: { color: colors.vibe },
});
