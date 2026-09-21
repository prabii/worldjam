import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  onStart: () => void;
  onHowItWorks: () => void;
}

/**
 * Welcome screen, built over the supplied artwork.
 *
 * The artwork is a complete screen design: it already contains the corner
 * kickers, the globe, the wordmark, the object icons, the blurb, and painted
 * versions of both buttons. So this draws none of those. An earlier version
 * re-created the kickers, icons and blurb as real views on top, which meant
 * every line appeared twice, slightly offset — the artwork's copy showing
 * through behind the app's.
 *
 * What is laid out here is only what has to be interactive: two tap targets
 * positioned over where the buttons are painted. They are transparent, so the
 * artwork's own buttons are what the user sees, but they are real Pressables
 * with real accessibility labels.
 *
 * Positions are fractions of the screen height rather than fixed offsets,
 * because the artwork is scaled with `cover` and a fixed offset would drift
 * away from the painted buttons on a different aspect ratio.
 */

/** Where the artwork paints each control, as a fraction of image height. */
const GET_STARTED_Y = 0.826;
const HOW_IT_WORKS_Y = 0.894;
/** Painted button height, same units. */
const BUTTON_H = 0.046;

export function WelcomeScreen({ onStart, onHowItWorks }: Props) {
  const insets = useSafeAreaInsets();
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // The artwork fades up rather than snapping in — this is the first thing
    // anyone sees of the product.
    Animated.timing(fade, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [fade]);

  return (
    <View style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
        <Image
          source={require('../../assets/splash.png')}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          // The artwork carries the screen's own text, so a screen reader is
          // served by the labelled controls below, not by describing the image.
          accessible={false}
        />
      </Animated.View>

      {/* Tap targets over the painted buttons. Transparent by design: the
          artwork supplies the visuals. */}
      <View style={styles.hitLayer} pointerEvents="box-none">
        <Pressable
          onPress={onStart}
          accessibilityRole="button"
          accessibilityLabel="Get started"
          accessibilityHint="Opens the home screen to begin capturing sounds"
          style={({ pressed }) => [
            styles.hit,
            { top: `${GET_STARTED_Y * 100}%`, height: `${BUTTON_H * 100}%` },
            pressed && styles.hitPressed,
          ]}
        />

        <Pressable
          onPress={onHowItWorks}
          accessibilityRole="button"
          accessibilityLabel="See how it works"
          style={({ pressed }) => [
            styles.hit,
            { top: `${HOW_IT_WORKS_Y * 100}%`, height: `${BUTTON_H * 100}%` },
            pressed && styles.hitPressed,
          ]}
        />
      </View>

      {/* Skip, for anyone who does not want the intro. Placed in the safe area
          rather than over the artwork, so it covers nothing that is painted. */}
      <Pressable
        onPress={onStart}
        accessibilityRole="button"
        accessibilityLabel="Skip intro"
        style={[styles.skip, { top: insets.top + 8 }]}
        hitSlop={10}
      >
        <Text style={styles.skipText}>Skip</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05060A' },

  hitLayer: { ...StyleSheet.absoluteFillObject },
  hit: {
    position: 'absolute',
    left: '16%',
    right: '16%',
    borderRadius: 999,
  },
  /** A faint lift on press, so a tap is acknowledged on a painted button. */
  hitPressed: { backgroundColor: 'rgba(255,255,255,0.14)' },

  skip: {
    position: 'absolute',
    right: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(8,10,18,0.55)',
  },
  skipText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.4,
  },
});
