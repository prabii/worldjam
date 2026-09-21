import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '@/theme';
import { Glyph, type GlyphName } from './Glyph';

export interface RailItem {
  key: string;
  icon: GlyphName;
  label: string;
  active?: boolean;
  disabled?: boolean;
}

interface Props {
  items: RailItem[];
  onSelect: (key: string) => void;
}

/**
 * The floating vertical tool rail on the left of the scan viewfinder.
 *
 * It sits over the camera feed, so it carries its own translucent backing —
 * without it the icons vanish against a bright surface, which is exactly the
 * case when someone points the phone at a lit table.
 */
export function ToolRail({ items, onSelect }: Props) {
  return (
    <View style={styles.rail}>
      {items.map((item) => (
        <Pressable
          key={item.key}
          style={styles.item}
          disabled={item.disabled}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            onSelect(item.key);
          }}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          accessibilityState={{ selected: !!item.active, disabled: !!item.disabled }}
        >
          <View
            style={[
              styles.puck,
              item.active && styles.puckActive,
              item.disabled && styles.puckDisabled,
            ]}
          >
            <Glyph
              name={item.icon}
              size={22}
              color={
                item.disabled
                  ? 'rgba(200,214,240,0.35)'
                  : item.active
                    ? '#FFFFFF'
                    : 'rgba(226,235,255,0.92)'
              }
            />
          </View>
          <Text style={[styles.label, item.disabled && styles.labelDisabled]}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    backgroundColor: 'rgba(10,12,18,0.68)',
    borderRadius: 34,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 14,
    paddingHorizontal: 8,
    gap: 16,
    alignItems: 'center',
  },
  item: { alignItems: 'center', gap: 5, width: 62 },
  puck: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(28,33,48,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  puckActive: {
    backgroundColor: 'rgba(99,102,241,0.55)',
    borderColor: 'rgba(196,181,253,0.85)',
  },
  puckDisabled: { opacity: 0.45 },
  label: { fontSize: 11, fontWeight: '600', color: 'rgba(226,235,255,0.88)' },
  labelDisabled: { color: 'rgba(200,214,240,0.4)' },
});
