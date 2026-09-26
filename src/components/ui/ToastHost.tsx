import React, { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOAST_MS, useToast, type ToastKind } from '@/state/toastStore';
import { useSession } from '@/state/sessionStore';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  /**
   * Mirror the session's status messages as toasts. On only where the screen
   * has no status line of its own, so nothing is said twice.
   */
  bridgeStatus: boolean;
}

const TONE: Record<ToastKind, { fg: string; bg: string; glyph: string }> = {
  info: { fg: colors.vibe, bg: 'rgba(12, 28, 38, 0.96)', glyph: '•' },
  success: { fg: colors.live, bg: 'rgba(10, 32, 26, 0.96)', glyph: '✓' },
  error: { fg: colors.danger, bg: 'rgba(40, 14, 16, 0.96)', glyph: '!' },
  ai: { fg: colors.ai, bg: 'rgba(28, 20, 44, 0.96)', glyph: '✦' },
  progress: { fg: colors.ai, bg: 'rgba(22, 20, 34, 0.96)', glyph: '' },
};

/**
 * Slides the current toast down from under the status bar.
 *
 * Every toast is also announced to TalkBack: for a blind user the toast is
 * the only confirmation that a save or an arrangement actually happened.
 */
export function ToastHost({ bridgeStatus }: Props) {
  const insets = useSafeAreaInsets();
  const current = useToast((s) => s.current);
  const hide = useToast((s) => s.hide);
  const anim = useRef(new Animated.Value(0)).current;
  const shownId = useRef<number | null>(null);

  // Bridge session status messages into toasts.
  useEffect(() => {
    if (!bridgeStatus) return;
    return useSession.subscribe((s, prev) => {
      if (s.statusMessage && s.statusMessage !== prev.statusMessage) {
        useToast.getState().show(s.statusMessage);
      }
    });
  }, [bridgeStatus]);

  useEffect(() => {
    if (!current) {
      Animated.timing(anim, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start();
      shownId.current = null;
      return;
    }

    if (shownId.current !== current.id) {
      shownId.current = current.id;
      anim.setValue(0);
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6 }).start();
    }

    // Progress ticks are not re-announced, or TalkBack would read a counter.
    if (current.kind !== 'progress') {
      AccessibilityInfo.announceForAccessibility(current.message);
    }

    const t = setTimeout(() => hide(current.id), TOAST_MS[current.kind]);
    return () => clearTimeout(t);
  }, [current, anim, hide]);

  if (!current) return null;
  const tone = TONE[current.kind];

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          top: insets.top + spacing.sm,
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) },
            { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
          ],
        },
      ]}
    >
      <Pressable
        onPress={() => hide(current.id)}
        accessibilityRole="alert"
        accessibilityHint="Tap to dismiss"
        style={[styles.toast, { backgroundColor: tone.bg, borderColor: tone.fg }]}
      >
        <View style={[styles.badge, { backgroundColor: `${tone.fg}33` }]}>
          {current.kind === 'progress' ? (
            <ActivityIndicator size="small" color={tone.fg} />
          ) : (
            <Text style={[styles.glyph, { color: tone.fg }]}>{tone.glyph}</Text>
          )}
        </View>
        <Text style={styles.message} numberOfLines={2}>
          {current.message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
    zIndex: 100,
    elevation: 100,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    maxWidth: 440,
    paddingVertical: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { ...type.label, fontSize: 14 },
  message: { ...type.label, color: colors.text, flexShrink: 1 },
});
