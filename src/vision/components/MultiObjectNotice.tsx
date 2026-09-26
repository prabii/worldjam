import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { colors } from '@/theme';

export const NOTICE_MS = 3000;

/**
 * A 3-second pop-up: several objects are in view and the closest one will be
 * used. Re-shown only when [noticeKey] changes, so the same situation never
 * nags twice. Announced to screen readers as a polite live region.
 */
export function MultiObjectNotice({ message, noticeKey }: { message: string | null; noticeKey: string | null }) {
  const [shown, setShown] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!noticeKey || !message) return;
    setShown(message);
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setShown(null));
    }, NOTICE_MS);
    return () => clearTimeout(t);
    // Only a new key restarts the notice; message text follows the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noticeKey]);

  if (!shown) return null;
  return (
    <Animated.View
      style={[styles.wrap, { opacity }]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessible
      accessibilityLabel={shown}
    >
      <Text style={styles.icon}>◎</Text>
      <Text style={styles.text}>{shown}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
    maxWidth: '92%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(8,9,12,0.9)',
    borderWidth: 1,
    borderColor: colors.vibe,
  },
  icon: { color: colors.vibe, fontSize: 16, fontWeight: '800' },
  text: { color: colors.text, fontSize: 13, fontWeight: '700', flexShrink: 1 },
});
