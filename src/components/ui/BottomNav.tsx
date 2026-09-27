import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { gradients } from '@/theme/gradients';
import { colors, radius, spacing, type } from '@/theme';

export type NavTab = 'home' | 'studio' | 'play' | 'profile';

export type AppScreen =
  | 'welcome'
  | 'home'
  | 'capture'
  | 'jam'
  | 'jams'
  | 'play'
  | 'tiles'
  | 'profile';

interface Props {
  active: NavTab;
  onSelect: (tab: NavTab) => void;
  onCapture: () => void;
}

export function BottomNav({ active, onSelect, onCapture }: Props) {
  const insets = useSafeAreaInsets();

  const tab = (key: NavTab, label: string, glyph: React.ReactNode) => {
    const isActive = active === key;

    return (
      <Pressable
        key={key}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onSelect(key);
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: isActive }}
        accessibilityLabel={label}
        style={styles.tab}
      >
        <View style={styles.glyphWrap}>{glyph}</View>
        <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
          {label}
        </Text>
        {isActive && <View style={styles.activeDot} />}
      </Pressable>
    );
  };

  const tint = (key: NavTab) => (active === key ? colors.vibe : colors.textDim);

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {/* Solid background that covers to the very bottom edge */}
      <View style={[styles.bgFill, { height: insets.bottom + 80 }]} />

      <View style={styles.bar}>
        {tab('home', 'Home', <HomeGlyph color={tint('home')} />)}
        {tab('studio', 'Studio', <StudioGlyph color={tint('studio')} />)}

        <View style={styles.centreSpacer} />

        {tab('play', 'Play', <PlayGlyph color={tint('play')} />)}
        {tab('profile', 'Profile', <ProfileGlyph color={tint('profile')} />)}
      </View>

      <View style={[styles.captureWrap, { bottom: insets.bottom + 20 }]} pointerEvents="box-none">
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            onCapture();
          }}
          accessibilityRole="button"
          accessibilityLabel="Capture a new sound"
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
    </View>
  );
}

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

function PlayGlyph({ color }: { color: string }) {
  return (
    <View style={styles.glyph}>
      <View
        style={[
          styles.playTri,
          {
            borderLeftColor: color,
          },
        ]}
      />
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
    paddingHorizontal: spacing.sm,
  },
  bgFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(10,10,12,0.98)',
  },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.vibe,
    marginTop: 1,
  },
  centreSpacer: { width: 64 },
  glyphWrap: { height: 22, justifyContent: 'center' },
  glyph: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { ...type.caption, fontSize: 9, color: colors.textDim },
  tabLabelActive: { color: colors.vibe },

  captureWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  captureInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.bg,
  },
  plusH: { width: 20, height: 2.5, borderRadius: 2, backgroundColor: '#FFFFFF' },
  plusV: {
    position: 'absolute',
    width: 2.5,
    height: 20,
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

  playTri: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 8,
    borderBottomWidth: 8,
    borderLeftWidth: 13,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },

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
