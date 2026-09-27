import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '../components/Icon';
import { accentGradient, color, font, space } from '../theme';
import type { Tab } from './store';

export const TAB_BAR_HEIGHT = 64;

const TABS: Array<{ tab: Tab; label: string; icon: IconName }> = [
  { tab: 'home', label: 'Home', icon: 'home' },
  { tab: 'jams', label: 'My Jams', icon: 'jams' },
  { tab: 'studio', label: 'Studio', icon: 'studio' },
  { tab: 'settings', label: 'Settings', icon: 'settings' },
];

/**
 * Home | My Jams | ( capture ) | Studio | Settings. Capture sits in the middle
 * because it is the start of everything: the ring is the one place the accent
 * gradient is always visible.
 */
export function TabBar({ active, onSelect, onCapture }: { active: Tab; onSelect: (t: Tab) => void; onCapture: () => void }) {
  const insets = useSafeAreaInsets();
  const item = (t: (typeof TABS)[number]) => {
    const on = t.tab === active;
    return (
      <Pressable
        key={t.tab}
        onPress={() => onSelect(t.tab)}
        accessibilityRole="tab"
        accessibilityLabel={t.label}
        accessibilityState={{ selected: on }}
        style={styles.tab}
      >
        <Icon name={t.icon} size={22} color={on ? color.text : color.textMuted} />
        <Text style={[font.caption, on && { color: color.text }]}>{t.label}</Text>
        <View style={[styles.dot, on && { backgroundColor: color.cyan }]} />
      </Pressable>
    );
  };
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
      {item(TABS[0])}
      {item(TABS[1])}
      <Pressable onPress={onCapture} accessibilityRole="button" accessibilityLabel="Capture a sound" style={styles.captureWrap}>
        <LinearGradient colors={[...accentGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.ring}>
          <View style={styles.ringInner}>
            <View style={styles.recordDot} />
          </View>
        </LinearGradient>
      </Pressable>
      {item(TABS[2])}
      {item(TABS[3])}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: space.sm,
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  tab: { flex: 1, alignItems: 'center', gap: 2, minHeight: 52, justifyContent: 'center' },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 1 },
  captureWrap: { width: 72, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 56, height: 56, borderRadius: 28, padding: 3 },
  ringInner: { flex: 1, borderRadius: 25, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center' },
  recordDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: color.text },
});
