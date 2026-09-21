import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface Props {
  /** Animates the bars while a capture is running. */
  active: boolean;
  bars?: number;
  height?: number;
}

/**
 * The cyan→magenta capture waveform.
 *
 * Twenty-two bars, animated by transform on the UI thread. An earlier version
 * used 44 bars animating `height`, which cannot be natively driven: the result
 * was dozens of bridge writes per frame, continuously, and buttons elsewhere
 * on the screen responded visibly late.
 *
 * The bars are decorative rather than a true meter: reading real levels would
 * mean pulling amplitude across the bridge every frame, which is exactly the
 * kind of per-frame traffic the audio path is designed to avoid. Their job is
 * to show that recording is happening, and a fixed envelope does that without
 * costing the capture anything.
 */
export function LiveWaveform({ active, bars = 22, height = 56 }: Props) {
  // One Animated.Value per bar, created once.
  const values = useRef(
    Array.from({ length: bars }, () => new Animated.Value(0.15)),
  ).current;

  // A static envelope so the shape reads as a recorded sound — loud in the
  // middle, tapering at both ends — rather than a flat block of bars.
  const envelope = useRef(
    Array.from({ length: bars }, (_, i) => {
      const t = i / (bars - 1);
      const shape = Math.sin(t * Math.PI);
      return 0.25 + shape * 0.75;
    }),
  ).current;

  useEffect(() => {
    if (!active) {
      // Settle to a flat line when idle.
      const settle = values.map((v) =>
        Animated.timing(v, {
          toValue: 0.12,
          duration: 260,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      );
      Animated.parallel(settle).start();
      return;
    }

    const loops = values.map((v, i) => {
      const peak = envelope[i];
      const animate = (): Animated.CompositeAnimation =>
        Animated.sequence([
          Animated.timing(v, {
            toValue: peak * (0.45 + Math.random() * 0.55),
            duration: 150 + Math.random() * 180,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(v, {
            toValue: peak * (0.18 + Math.random() * 0.35),
            duration: 150 + Math.random() * 180,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]);

      const loop = Animated.loop(animate());
      loop.start();
      return loop;
    });

    return () => loops.forEach((l) => l.stop());
  }, [active, values, envelope]);

  return (
    <View style={[styles.row, { height }]}>
      {values.map((v, i) => (
        <Animated.View
          key={i}
          style={[
            styles.barClip,
            {
              height,
              // scaleY is a transform, so this runs on the UI thread. Animating
              // `height` forced useNativeDriver: false, which meant every frame
              // of every bar crossed the bridge and made the whole screen feel
              // laggy to touch.
              transform: [{ scaleY: v }],
            },
          ]}
        >
          <LinearGradient
            colors={['#38BDF8', '#A855F7', '#EC4899']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
  },
  barClip: {
    flex: 1,
    borderRadius: 2,
    overflow: 'hidden',
    minWidth: 2,
  },
});
