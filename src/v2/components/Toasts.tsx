import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { color, font, radius, space } from '../theme';
import { Icon } from './Icon';

type Kind = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  text: string;
  kind: Kind;
}

const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let nextId = 1;

/** Short, non-blocking confirmation. Errors stay a little longer. */
export function toast(text: string, kind: Kind = 'info'): void {
  const id = nextId++;
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, kind }] }));
  setTimeout(() => useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 5000 : 2600);
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const insets = useSafeAreaInsets();
  if (toasts.length === 0) return null;
  return (
    <View style={[styles.wrap, { top: insets.top + space.sm }]} pointerEvents="none" accessibilityLiveRegion="polite">
      {toasts.map((t) => (
        <View key={t.id} style={[styles.toast, t.kind === 'error' && { borderColor: color.error }]}>
          <Icon
            name={t.kind === 'error' ? 'close' : t.kind === 'success' ? 'check' : 'waveform'}
            size={16}
            color={t.kind === 'error' ? color.error : t.kind === 'success' ? color.success : color.cyan}
          />
          <Text style={[font.label, { color: color.text, flex: 1 }]}>{t.text}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, gap: space.sm },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.card,
    backgroundColor: color.elevated,
    borderWidth: 1,
    borderColor: color.line,
  },
});
