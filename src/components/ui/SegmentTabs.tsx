import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { colors } from '@/theme';
import { Glyph, type GlyphName } from './Glyph';

export interface SegmentTab {
  key: string;
  icon: GlyphName;
  label: string;
  sub?: string;
  disabled?: boolean;
}

interface Props {
  tabs: SegmentTab[];
  active: string;
  onSelect: (key: string) => void;
}

/**
 * The four-up tab bar (Compose / Effects / Mix / Export).
 *
 * One bordered strip with dividers between cells rather than four separate
 * buttons, so the active cell's gradient reads as lighting up part of a
 * single control — which is what the mockup shows.
 */
export function SegmentTabs({ tabs, active, onSelect }: Props) {
  return (
    <View style={styles.bar}>
      {tabs.map((tab, i) => {
        const isActive = tab.key === active;
        return (
          <React.Fragment key={tab.key}>
            {i > 0 && <View style={styles.divider} />}
            <Pressable
              style={styles.cell}
              disabled={tab.disabled}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onSelect(tab.key);
              }}
              accessibilityRole="tab"
              accessibilityLabel={tab.sub ? `${tab.label}, ${tab.sub}` : tab.label}
              accessibilityState={{ selected: isActive, disabled: !!tab.disabled }}
            >
              {isActive && (
                <LinearGradient
                  colors={['rgba(124,58,237,0.85)', 'rgba(168,85,247,0.55)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              )}
              <Glyph
                name={tab.icon}
                size={20}
                color={
                  tab.disabled
                    ? 'rgba(200,214,240,0.35)'
                    : isActive
                      ? '#FFFFFF'
                      : 'rgba(226,235,255,0.85)'
                }
              />
              <View style={styles.cellText}>
                <Text
                  style={[
                    styles.label,
                    isActive && styles.labelActive,
                    tab.disabled && styles.labelDisabled,
                  ]}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
                {tab.sub && (
                  <Text
                    style={[styles.sub, isActive && styles.subActive]}
                    numberOfLines={1}
                  >
                    {tab.sub}
                  </Text>
                )}
              </View>
            </Pressable>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.28)',
    backgroundColor: 'rgba(12,15,26,0.9)',
    overflow: 'hidden',
  },
  divider: { width: 1, backgroundColor: 'rgba(120,140,190,0.22)' },
  cell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 13,
    paddingHorizontal: 9,
    overflow: 'hidden',
  },
  cellText: { flex: 1 },
  label: { fontSize: 13, fontWeight: '700', color: 'rgba(226,235,255,0.9)' },
  labelActive: { color: '#FFFFFF' },
  labelDisabled: { color: 'rgba(200,214,240,0.4)' },
  sub: { fontSize: 10, fontWeight: '500', color: colors.textFaint },
  subActive: { color: 'rgba(233,213,255,0.92)' },
});
