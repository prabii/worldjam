import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, type } from '@/theme';

interface Props {
  size?: 'small' | 'medium' | 'large';
  /** Shows "Turn Your World Into a Song" beneath the wordmark. */
  tagline?: boolean;
  /** Animates the bars, for the splash and loading states. */
  animated?: boolean;
}

/**
 * The WorldJam wordmark: an equaliser glyph beside "World" in white and "Jam"
 * in the brand gradient.
 *
 * The equaliser bars carry the gradient; "Jam" is a solid brand purple. See
 * BrandWord below for why a true gradient text fill is not used.
 */
export function Logo({ size = 'medium', tagline, animated }: Props) {
  const dims = SIZES[size];
  const bars = useRef(
    [0.5, 0.85, 0.35, 1, 0.6].map((v) => new Animated.Value(v)),
  ).current;

  useEffect(() => {
    if (!animated) return;

    const loops = bars.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, {
            toValue: 0.3 + Math.random() * 0.7,
            duration: 380 + i * 90,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(v, {
            toValue: 0.25 + Math.random() * 0.5,
            duration: 420 + i * 70,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [animated, bars]);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {/* Equaliser glyph */}
        <View style={[styles.bars, { height: dims.bar }]}>
          {bars.map((v, i) => (
            <Animated.View key={i} style={styles.barClip}>
              <Animated.View
                style={{
                  width: dims.barW,
                  height: v.interpolate({
                    inputRange: [0, 1],
                    outputRange: [dims.bar * 0.2, dims.bar],
                  }),
                  borderRadius: dims.barW,
                  overflow: 'hidden',
                }}
              >
                <LinearGradient
                  colors={['#38BDF8', '#A855F7', '#EC4899']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            </Animated.View>
          ))}
        </View>

        <View style={styles.word}>
          <Text style={[styles.world, { fontSize: dims.font }]}>World</Text>
          <BrandWord text="Jam" fontSize={dims.font} />
        </View>
      </View>

      {tagline && (
        <Text style={[styles.tagline, { fontSize: dims.tagline }]}>
          Turn Your World Into a Song
        </Text>
      )}
    </View>
  );
}

/**
 * "Jam" in the brand purple.
 *
 * A true gradient text fill needs @react-native-masked-view, which is another
 * native dependency and therefore another rebuild. A solid brand purple against
 * the white "World" carries the same two-tone identity at every size the app
 * uses, so the dependency is not worth it here.
 */
function BrandWord({ text, fontSize }: { text: string; fontSize: number }) {
  return <Text style={[styles.world, styles.jam, { fontSize }]}>{text}</Text>;
}

const SIZES = {
  small: { font: 18, bar: 16, barW: 3, tagline: 9 },
  medium: { font: 26, bar: 24, barW: 4, tagline: 11 },
  large: { font: 40, bar: 36, barW: 6, tagline: 14 },
} as const;

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  barClip: { justifyContent: 'flex-end' },
  word: { flexDirection: 'row', alignItems: 'baseline' },
  world: {
    fontWeight: '800',
    letterSpacing: -0.8,
    color: '#FFFFFF',
  },
  jam: { color: '#C77DFF' },
  tagline: {
    ...type.caption,
    color: colors.textDim,
    letterSpacing: 1,
  },
});
