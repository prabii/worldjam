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
import * as Haptics from 'expo-haptics';
import { ObjectIcon } from '@/components/ObjectIcon';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  onStart: () => void;
  onHowItWorks: () => void;
}

/**
 * Welcome screen.
 *
 * The object icons here are illustrative of what CAN be recorded — they are
 * not selectable and carry no audio, which is why they sit above the tagline
 * as artwork rather than as a picker. Every sound in the app comes from the
 * user's own recording.
 */
const EXAMPLES = [
  { category: 'cup' as const, label: 'CUPS' },
  { category: 'plant' as const, label: 'PLANTS' },
  { category: 'laptop' as const, label: 'LAPTOPS' },
  { category: 'bottle' as const, label: 'BOTTLES' },
  { category: 'keys' as const, label: 'KEYS' },
];

export function WelcomeScreen({ onStart, onHowItWorks }: Props) {
  const insets = useSafeAreaInsets();

  const glow = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(20)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Content settles in rather than snapping — the first impression of the
    // product should feel considered.
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 600,
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

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [fade, rise, glow]);

  return (
    <View style={styles.root}>
      <Image
        source={require('../../assets/splash.png')}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        accessible={false}
      />

      {/* Darkens the lower half so the controls stay readable over artwork. */}
      <View style={styles.scrim} pointerEvents="none" />

      <Animated.View
        style={[
          styles.content,
          {
            paddingTop: insets.top + spacing.xl,
            paddingBottom: insets.bottom + spacing.xl,
            opacity: fade,
            transform: [{ translateY: rise }],
          },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.kicker}>TURN{'\n'}YOUR WORLD{'\n'}INTO A SONG</Text>
          <Text style={styles.kickerRight}>
            REAL OBJECTS{'\n'}REAL SOUNDS{'\n'}INFINITE MUSIC
          </Text>
        </View>

        <View style={styles.spacer} />

        <View style={styles.examples}>
          {EXAMPLES.map((e) => (
            <View key={e.label} style={styles.example}>
              <ObjectIcon category={e.category} color={colors.vibe} size={26} />
              <Text style={styles.exampleLabel}>{e.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.divider} />

        <Text style={styles.blurb}>
          Scan your surroundings, capture real sounds,{'\n'}and let AI turn them into
          music.
        </Text>

        <Animated.View
          style={{
            shadowColor: colors.vibe,
            shadowOpacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] }),
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 0 },
          }}
        >
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              onStart();
            }}
            accessibilityRole="button"
            accessibilityLabel="Get started"
            style={styles.cta}
          >
            <Text style={styles.ctaText}>Get Started</Text>
            <Text style={styles.ctaArrow}>→</Text>
          </Pressable>
        </Animated.View>

        <Pressable
          onPress={onHowItWorks}
          accessibilityRole="button"
          accessibilityLabel="See how it works"
          style={styles.secondary}
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
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5,6,10,0.35)',
  },
  content: { flex: 1, paddingHorizontal: spacing.xl },

  header: { flexDirection: 'row', justifyContent: 'space-between' },
  kicker: {
    ...type.caption,
    fontSize: 11,
    letterSpacing: 2.5,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.65)',
  },
  kickerRight: {
    ...type.caption,
    fontSize: 11,
    letterSpacing: 2.5,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'right',
  },

  spacer: { flex: 1 },

  examples: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  example: { alignItems: 'center', gap: 6 },
  exampleLabel: {
    ...type.caption,
    fontSize: 9,
    letterSpacing: 1.4,
    color: 'rgba(255,255,255,0.55)',
  },

  divider: {
    width: 36,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },

  blurb: {
    ...type.body,
    fontSize: 16,
    lineHeight: 23,
    color: 'rgba(255,255,255,0.88)',
    textAlign: 'center',
    marginBottom: spacing.xl,
  },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.vibe,
  },
  ctaText: { ...type.title, fontSize: 19, color: '#08090C' },
  ctaArrow: { ...type.title, fontSize: 19, color: '#08090C' },

  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  secondaryText: { ...type.body, color: 'rgba(255,255,255,0.9)' },
  playRing: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playTri: {
    width: 0,
    height: 0,
    marginLeft: 2,
    borderTopWidth: 4,
    borderBottomWidth: 4,
    borderLeftWidth: 7,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: 'rgba(255,255,255,0.9)',
  },
});
