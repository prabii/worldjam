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
import { LinearGradient } from 'expo-linear-gradient';
import { GradientButton } from '@/components/ui/GradientButton';
import { colors } from '@/theme';

interface Props {
  onStart: () => void;
  onHowItWorks: () => void;
}

/**
 * Welcome screen.
 *
 * The artwork is used as a backdrop for its globe and wordmark, but the
 * controls are drawn as real views.
 *
 * Two earlier attempts were wrong in opposite directions. The first re-created
 * the artwork's kickers and blurb as text on top of an image that already
 * contained them, so every line appeared twice. The second removed all text
 * and placed invisible tap targets over the painted buttons — which fails
 * because the artwork is 0.563 aspect and a phone is nearer 0.45, so `cover`
 * crops it vertically by a device-dependent amount and the targets land
 * nowhere near the buttons they were measured against.
 *
 * So: the image is anchored to the top where the globe lives, the lower part
 * of the screen is a solid scrim, and the buttons are ordinary components that
 * are visible wherever they are laid out. Nothing depends on knowing how the
 * image was cropped.
 */
export function WelcomeScreen({ onStart, onHowItWorks }: Props) {
  const insets = useSafeAreaInsets();
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 650,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(rise, {
        toValue: 0,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, rise]);

  return (
    <View style={styles.root}>
      {/* The artwork's globe and wordmark sit in its upper two thirds, so the
          image is pinned to the top and allowed to run under the controls,
          where the scrim covers it. */}
      <Image
        source={require('../../assets/splash.png')}
        style={styles.art}
        resizeMode="cover"
        accessible={false}
      />

      {/* Fades the artwork out before the controls begin, so the buttons sit
          on a clean surface no matter where the crop landed. */}
      <LinearGradient
        colors={['rgba(5,6,10,0)', 'rgba(5,6,10,0.75)', '#05060A']}
        locations={[0, 0.45, 0.72]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <Animated.View
        style={[
          styles.controls,
          {
            paddingBottom: insets.bottom + 28,
            opacity: fade,
            transform: [{ translateY: rise }],
          },
        ]}
      >
        <Text style={styles.blurb}>
          Scan your surroundings, capture real sounds,{'\n'}and let AI turn them
          into music.
        </Text>

        <GradientButton
          label="Get Started"
          trailing="→"
          onPress={onStart}
          accessibilityLabel="Get started capturing sounds"
        />

        <Pressable
          onPress={onHowItWorks}
          accessibilityRole="button"
          accessibilityLabel="See how it works"
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
        >
          <Text style={styles.secondaryText}>See How It Works</Text>
          <View style={styles.playRing}>
            <View style={styles.playTri} />
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05060A' },

  art: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Taller than the controls need, so the globe is never clipped at the top
    // on a tall screen.
    height: '78%',
  },

  controls: {
    marginTop: 'auto',
    paddingHorizontal: 22,
    gap: 14,
  },
  blurb: {
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
    color: colors.text,
    marginBottom: 4,
  },

  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 15,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  secondaryPressed: { backgroundColor: 'rgba(255,255,255,0.08)' },
  secondaryText: { fontSize: 15.5, fontWeight: '600', color: colors.text },
  playRing: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playTri: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftWidth: 10,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#FFFFFF',
  },
});
