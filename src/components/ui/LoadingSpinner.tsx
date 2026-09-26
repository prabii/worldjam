import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors, type } from '@/theme';

interface Props {
  label?: string;
  size?: number;
  color?: string;
}

export function LoadingSpinner({ label, size = 48, color = colors.vibe }: Props) {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const spinAnim = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.6,
          duration: 800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    spinAnim.start();
    pulseAnim.start();
    return () => {
      spinAnim.stop();
      pulseAnim.stop();
    };
  }, [spin, pulse]);

  const rotation = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const r = size / 2;
  const thickness = Math.max(2, size / 12);

  return (
    <View style={styles.wrap}>
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            opacity: pulse,
            transform: [{ rotate: rotation }],
          },
        ]}
      >
        <View
          style={[
            styles.ring,
            {
              width: size,
              height: size,
              borderRadius: r,
              borderWidth: thickness,
              borderColor: 'rgba(255,255,255,0.06)',
              borderTopColor: color,
              borderRightColor: color,
            },
          ]}
        />
      </Animated.View>
      {label && <Text style={styles.label}>{label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 12 },
  ring: {},
  label: { ...type.caption, color: colors.textDim },
});
