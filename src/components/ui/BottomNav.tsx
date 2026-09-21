import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { gradients } from '@/theme/gradients';
import { colors, radius, spacing, type } from '@/theme';

export type NavTab = 'home' | 'studio' | 'jams' | 'profile';

/**
 * Space a scrolling screen must leave at its bottom so the nav does not cover
 * the last row of content.
 *
 * The bar is absolutely positioned and its raised centre button sits above
 * it, so the clearance is taller than the bar itself. Exported as one constant
 * because six screens were each carrying their own guess, and the first one to
 * be wrong hides real content behind the nav.
 */
export const BOTTOM_NAV_CLEARANCE = 150;

interface Props {
  active: NavTab;
  onSelect: (tab: NavTab) => void;
  /** The centre action — starts a capture. */
  onCapture: () => void;
  /** Tabs with nothing to show yet are rendered but not selectable. */
  disabled?: NavTab[];
}

/**
 * Bottom navigation with the raised gradient capture button.
 *
 * Tabs that have nothing behind them yet are shown dimmed and are genuinely
 * non-interactive, rather than navigating to an empty screen. Showing a tab
 * that does nothing when tapped is worse than showing it as unavailable.
 */
export function BottomNav({ active, onSelect, onCapture, disabled = [] }: Props) {
  const insets = useSafeAreaInsets();

  const tab = (key: NavTab, label: string, glyph: React.ReactNode) => {
    const isDisabled = disabled.includes(key);
    const isActive = active === key && !isDisabled;

    return (
      <Pressable
        key={key}
        onPress={() => {
          if (isDisabled) return;
          Haptics.selectionAsync().catch(() => {});
          onSelect(key);
        }}
        disabled={isDisabled}
        accessibilityRole="tab"
        accessibilityState={{ selected: isActive, disabled: isDisabled }}
        accessibilityLabel={isDisabled ? `${label}, not available yet` : label}
        style={styles.tab}
      >
        <View style={[styles.glyphWrap, isDisabled && styles.dimmed]}>{glyph}</View>
        <Text
          style={[
            styles.tabLabel,
            isActive && styles.tabLabelActive,
            isDisabled && styles.tabLabelDisabled,
          ]}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  const tint = (key: NavTab) =>
    disabled.includes(key)
      ? colors.textFaint
      : active === key
        ? colors.vibe
        : colors.textDim;

  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom + spacing.sm }]}>
      <View style={styles.bar}>
        {tab('home', 'Home', <HomeGlyph color={tint('home')} />)}
        {tab('studio', 'Studio', <StudioGlyph color={tint('studio')} />)}

        {/* Spacer for the raised capture button. */}
        <View style={styles.centreSpacer} />

        {tab('jams', 'My Jams', <JamsGlyph color={tint('jams')} />)}
        {tab('profile', 'Profile', <ProfileGlyph color={tint('profile')} />)}
      </View>

      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          onCapture();
        }}
        accessibilityRole="button"
        accessibilityLabel="Capture a new sound"
        style={[styles.capture, { bottom: insets.bottom + 26 }]}
      >
        <LinearGradient
          colors={gradients.brand}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.captureInner}
        >
          <View style={styles.plusH} />
          <View style={styles.plusV} />
        </LinearGradient>
      </Pressable>
    </View>
  );
}

/* --- glyphs, drawn as views to avoid an icon dependency --- */

function HomeGlyph({ color }: { color: string }) {
  return (
    <View style={styles.glyph}>
      <View style={[styles.homeRoof, { borderBottomColor: color }]} />
      <View style={[styles.homeBody, { borderColor: color }]} />
    </View>
  );
}

function StudioGlyph({ color }: { color: string }) {
  return (
    <View style={[styles.glyph, styles.cube, { borderColor: color }]}>
      <View style={[styles.cubeInner, { borderColor: color }]} />
    </View>
  );
}

function JamsGlyph({ color }: { color: string }) {
  return (
    <View style={styles.glyph}>
      <View style={styles.noteRow}>
        {[7, 12, 9].map((h, i) => (
          <View key={i} style={{ width: 3, height: h, borderRadius: 2, backgroundColor: color }} />
        ))}
      </View>
    </View>
  );
}

function ProfileGlyph({ color }: { color: string }) {
  return (
    <View style={styles.glyph}>
      <View style={[styles.head, { borderColor: color }]} />
      <View style={[styles.shoulders, { borderColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(14,16,22,0.96)',
  },
  tab: { flex: 1, alignItems: 'center', gap: 4 },
  centreSpacer: { width: 76 },
  glyphWrap: { height: 22, justifyContent: 'center' },
  dimmed: { opacity: 0.45 },
  glyph: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { ...type.caption, fontSize: 10, color: colors.textDim },
  tabLabelActive: { color: colors.vibe },
  tabLabelDisabled: { color: colors.textFaint },

  capture: {
    position: 'absolute',
    alignSelf: 'center',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  captureInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.bg,
  },
  plusH: { width: 24, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF' },
  plusV: {
    position: 'absolute',
    width: 3,
    height: 24,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },

  homeRoof: {
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  homeBody: { width: 14, height: 9, borderWidth: 1.8, borderTopWidth: 0 },

  cube: { borderWidth: 1.8, borderRadius: 4, width: 19, height: 19 },
  cubeInner: { width: 9, height: 9, borderWidth: 1.5, borderRadius: 2 },

  noteRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },

  head: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.8 },
  shoulders: {
    width: 17,
    height: 8,
    borderWidth: 1.8,
    borderBottomWidth: 0,
    borderTopLeftRadius: 9,
    borderTopRightRadius: 9,
    marginTop: 2,
  },
});
