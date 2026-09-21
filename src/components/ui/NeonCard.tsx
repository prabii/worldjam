import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius } from '@/theme';

interface Props {
  children: React.ReactNode;
  /** Border tint. Defaults to the neutral panel edge used across the mockups. */
  accent?: string;
  /** Adds the outer bloom. Off for dense lists, where every card glowing
   *  turns the screen into a haze. */
  glow?: boolean;
  padded?: boolean;
  style?: ViewStyle;
}

/**
 * The dark panel every section of the mockups sits inside.
 *
 * The look is a near-black fill with a 1px lit edge, so the whole design reads
 * as glass lit from behind. The bloom is a second, larger rounded view behind
 * the card rather than a shadow, because Android renders `elevation` as an
 * untintable grey and a coloured `shadowColor` simply does not show there.
 */
export function NeonCard({
  children,
  accent = 'rgba(99,102,241,0.38)',
  glow = false,
  padded = true,
  style,
}: Props) {
  return (
    <View style={style}>
      {glow && (
        <View
          pointerEvents="none"
          style={[styles.bloom, { borderColor: accent, shadowColor: accent }]}
        />
      )}
      <LinearGradient
        colors={['rgba(23,26,38,0.92)', 'rgba(11,13,20,0.96)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.6, y: 1 }}
        style={[styles.card, { borderColor: accent }, padded && styles.padded]}
      >
        {children}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  padded: { padding: 16 },
  bloom: {
    position: 'absolute',
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: radius.lg + 3,
    borderWidth: 2,
    opacity: 0.35,
  },
});

/** Section heading with the small leading glyph the mockups use. */
export function CardHeading({
  icon,
  title,
  right,
}: {
  icon?: React.ReactNode;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={headingStyles.row}>
      {icon}
      <View style={headingStyles.titleWrap}>
        <Text style={headingStyles.title}>{title}</Text>
      </View>
      {right}
    </View>
  );
}

const headingStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleWrap: { flex: 1 },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2,
  },
});
