import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors } from '@/theme';

interface Props {
  playing: boolean;
  barCount?: number;
  height?: number;
  color?: string;
}

/**
 * Animated frequency-style visualizer bars that pulse when music is playing.
 * Uses deterministic pseudo-random animation to simulate a frequency spectrum.
 */
export function FrequencyVisualizer({
  playing,
  barCount = 32,
  height = 48,
  color = colors.vibe,
}: Props) {
  const anims = useRef<Animated.Value[]>(
    Array.from({ length: barCount }, () => new Animated.Value(0.15)),
  ).current;

  useEffect(() => {
    if (!playing) {
      // Settle to idle
      Animated.parallel(
        anims.map((a) =>
          Animated.timing(a, {
            toValue: 0.15,
            duration: 400,
            easing: Easing.out(Easing.quad),
            useNativeDriver: false,
          }),
        ),
      ).start();
      return;
    }

    const animations: Animated.CompositeAnimation[] = [];

    const animate = () => {
      const batch = anims.map((a, i) => {
        // Shape: higher in the middle, lower at edges (like a real spectrum)
        const center = barCount / 2;
        const dist = Math.abs(i - center) / center;
        const baseHeight = 0.3 + (1 - dist) * 0.5;
        // Add variation
        const variation = 0.15 + Math.random() * 0.35;
        const target = Math.min(1, baseHeight * variation + 0.1);

        return Animated.timing(a, {
          toValue: target,
          duration: 80 + Math.random() * 120,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        });
      });

      const anim = Animated.parallel(batch);
      animations.push(anim);
      anim.start(() => {
        if (playing) animate();
      });
    };

    animate();

    return () => {
      animations.forEach((a) => a.stop());
    };
  }, [playing, anims, barCount]);

  return (
    <View style={[styles.container, { height }]}>
      {anims.map((anim, i) => {
        const barHeight = anim.interpolate({
          inputRange: [0, 1],
          outputRange: [2, height],
        });

        // Gradient effect: bars near center are brighter
        const center = barCount / 2;
        const dist = Math.abs(i - center) / center;
        const opacity = 0.4 + (1 - dist) * 0.6;

        return (
          <Animated.View
            key={i}
            style={[
              styles.bar,
              {
                height: barHeight,
                backgroundColor: color,
                opacity,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 2,
    overflow: 'hidden',
  },
  bar: {
    flex: 1,
    minWidth: 2,
    maxWidth: 6,
    borderRadius: 1.5,
  },
});
