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
import { ObjectIcon } from '@/components/ObjectIcon';
import { GradientButton } from '@/components/ui/GradientButton';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  onStart: () => void;
  onHowItWorks: () => void;
}

/**
 * Home screen, built over the supplied artwork.
 *
 * The globe, wordmark and tagline live in the background image; everything
 * laid out here is the interactive chrome positioned over it. That split
 * keeps the artwork pixel-accurate while the controls stay real views with
 * real touch targets and accessibility labels.
 *
 * The object icons are illustrative of what CAN be recorded — they are not
 * selectable and carry no audio. Every sound in the app comes from the user's
 * own capture.
 */
const EXAMPLES = [
  { category: 'cup' as const, label: 'CUPS', color: '#F472B6' },
  { category: 'plant' as const, label: 'PLANTS', color: '#34D399' },
  { category: 'laptop' as const, label: 'LAPTOPS', color: '#A78BFA' },
  { category: 'bottle' as const, label: 'BOTTLES', color: '#38BDF8' },
  { category: 'keys' as const, label: 'KEYS', color: '#FB923C' },
];

export function WelcomeScreen({ onStart, onHowItWorks }: Props) {
  const insets = useSafeAreaInsets();

  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    // Content settles in rather than snapping — the first impression of the
    // product should feel considered.
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(rise, {
        toValue: 0,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, rise]);

  return (
    <View style={styles.root}>
      {/*
        The artwork is a full mockup: it carries its own headline and wordmark
        baked into the pixels. Stretched across a screen of a different shape
        those bake-ins drift out of place and collide with the live text — on a
        tall phone the wordmark reappeared, huge and half-cropped, behind the
        buttons. So it is used strictly as scenery. Only the globe is wanted,
        which sits in the upper portion, and the rest is covered.
      */}
      <View style={styles.artLayer} pointerEvents="none">
        <Image
          source={require('../../assets/splash.png')}
          style={styles.art}
          resizeMode="cover"
          accessible={false}
        />
      </View>

      {/* Scrim: readable over the globe, opaque where the artwork's own
          lettering would otherwise show through. */}
      <LinearGradient
        colors={[
          'rgba(5,6,10,0.72)',
          'rgba(5,6,10,0.06)',
          'rgba(5,6,10,0.20)',
          'rgba(5,6,10,0.92)',
          '#05060A',
        ]}
        locations={[0, 0.16, 0.4, 0.53, 0.6]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <Animated.View
        style={[
          styles.content,
          {
            paddingTop: insets.top + spacing.lg,
            paddingBottom: insets.bottom + spacing.lg,
            opacity: fade,
            transform: [{ translateY: rise }],
          },
        ]}
      >
        {/* Corner kickers, matching the artwork's placement. */}
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>TURN</Text>
            <Text style={styles.kicker}>YOUR WORLD</Text>
            <Text style={[styles.kicker, styles.kickerAccent]}>INTO A SONG</Text>
            <LinearGradient
              colors={['#38BDF8', '#A855F7']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.rule}
            />
          </View>

          <View style={styles.headerRight}>
            <Text style={[styles.kicker, styles.right]}>REAL OBJECTS</Text>
            <Text style={[styles.kicker, styles.right]}>REAL SOUNDS</Text>
            <Text style={[styles.kicker, styles.kickerAccent, styles.right]}>
              INFINITE MUSIC
            </Text>
            <LinearGradient
              colors={['#A855F7', '#38BDF8']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.rule, styles.ruleRight]}
            />
          </View>
        </View>

        {/* The globe and wordmark are in the artwork behind this space. */}
        <View style={styles.artSpace} />

        <View style={styles.examples}>
          {EXAMPLES.map((e) => (
            <View key={e.label} style={styles.example}>
              <ObjectIcon category={e.category} color={e.color} size={30} />
              <Text style={styles.exampleLabel}>{e.label}</Text>
            </View>
          ))}
        </View>

        <LinearGradient
          colors={['#38BDF8', '#EC4899']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.divider}
        />

        <Text style={styles.blurb}>
          Scan your surroundings, capture real sounds,{'\n'}and let AI turn them into
          music.
        </Text>

        <GradientButton
          label="Get Started"
          trailing="→"
          onPress={onStart}
          accessibilityLabel="Get started capturing sounds"
          style={styles.cta}
        />

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

        {/* Page dots from the artwork. Only the first is active: the other
            three are the onboarding pages still to be built, and showing them
            sets the expectation honestly rather than faking navigation. */}
        <View style={styles.dots}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.dot, i === 0 && styles.dotActive]} />
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05060A' },
  /*
   * The artwork occupies the top two-thirds only. Its lower third holds the
   * mockup's own wordmark and buttons, which the app draws for real, so that
   * part is simply not shown.
   */
  artLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '56%',
    overflow: 'hidden',
  },
  /*
   * Scaled and offset so the window lands on the globe alone.
   *
   * The mockup stacks headline, globe, an icon row and a blurb down its
   * length, and the app renders every one of those for real. Showing any more
   * of the source than the globe therefore prints a second, misaligned copy
   * of the UI behind the live one. The negative top pulls the baked-in
   * headline up out of view; the height leaves the icon row below the cut.
   */
  art: { width: '100%', height: '150%', marginTop: '-14%' },
  content: { flex: 1, paddingHorizontal: spacing.xl },

  header: { flexDirection: 'row', justifyContent: 'space-between' },
  headerRight: { alignItems: 'flex-end' },
  kicker: {
    ...type.caption,
    fontSize: 11,
    letterSpacing: 3,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.82)',
  },
  kickerAccent: { color: '#7DD3FC' },
  right: { textAlign: 'right' },
  rule: { width: 54, height: 2, borderRadius: 2, marginTop: spacing.sm },
  ruleRight: { alignSelf: 'flex-end' },

  /** Reserved for the globe and wordmark in the background artwork. */
  artSpace: { flex: 1 },

  examples: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  example: { alignItems: 'center', gap: 7 },
  exampleLabel: {
    ...type.caption,
    fontSize: 9,
    letterSpacing: 1.6,
    color: 'rgba(255,255,255,0.7)',
  },

  divider: {
    width: 44,
    height: 2,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },

  blurb: {
    ...type.body,
    fontSize: 16,
    lineHeight: 24,
    color: 'rgba(255,255,255,0.92)',
    textAlign: 'center',
    marginBottom: spacing.lg,
  },

  cta: { marginBottom: spacing.md },

  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  secondaryText: { ...type.body, color: 'rgba(255,255,255,0.92)' },
  playRing: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playTri: {
    width: 0,
    height: 0,
    marginLeft: 2.5,
    borderTopWidth: 4.5,
    borderBottomWidth: 4.5,
    borderLeftWidth: 7.5,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: 'rgba(255,255,255,0.95)',
  },

  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  dotActive: { backgroundColor: '#FFFFFF', width: 8, height: 8, borderRadius: 4 },
});
