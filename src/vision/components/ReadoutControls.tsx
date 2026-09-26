import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '@/theme';

/**
 * The speaker button. Large, always present, and it only repeats the stored
 * latest readout — it never triggers detection or a model call.
 */
export function RepeatReadoutButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel="Repeat latest object description"
      accessibilityHint="Speaks the most recent object description again"
      style={({ pressed }) => [styles.repeat, pressed && styles.repeatPressed]}
    >
      <Text style={styles.repeatIcon} accessible={false}>
        🔊
      </Text>
      <Text style={styles.repeatText}>Repeat latest description</Text>
    </Pressable>
  );
}

/** "Audio Object Read-Out" switch. State is spoken and written, never colour-only. */
export function AudioReadoutToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel="Audio Object Read-Out"
      accessibilityState={{ checked: value }}
      style={styles.toggleRow}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>Audio Object Read-Out</Text>
        <Text style={styles.toggleSub}>
          {value ? 'ON — new objects are announced' : 'OFF — only the speaker button speaks'}
        </Text>
      </View>
      <Text style={[styles.toggleState, { color: value ? colors.live : colors.textDim }]}>{value ? 'ON' : 'OFF'}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        accessible={false}
        importantForAccessibility="no"
        trackColor={{ true: colors.live, false: '#3A3F4B' }}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  repeat: {
    minHeight: 76,
    borderRadius: 18,
    backgroundColor: colors.vibe,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 20,
  },
  repeatPressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  repeatIcon: { fontSize: 30 },
  repeatText: { fontSize: 19, fontWeight: '800', color: '#08090C' },
  toggleRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  toggleLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
  toggleSub: { fontSize: 12, fontWeight: '500', color: colors.textDim, marginTop: 2 },
  toggleState: { fontSize: 15, fontWeight: '800', minWidth: 34, textAlign: 'right' },
});
