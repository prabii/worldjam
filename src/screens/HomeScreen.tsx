import React, { useEffect } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BOTTOM_NAV_CLEARANCE } from '@/components/ui/BottomNav';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { ObjectIcon } from '@/components/ObjectIcon';
import { Waveform } from '@/components/Waveform';
import { gradients } from '@/theme/gradients';
import { useSession } from '@/state/sessionStore';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  onScan: () => void;
  onCompose: () => void;
  onOpenSession: (id: string) => void;
}

/**
 * Home dashboard.
 *
 * Sections that have nothing to show are omitted rather than filled with
 * placeholder content: a "Recent Jams" row of invented track names would
 * imply the user has saved work they have not, and that is the kind of
 * dishonesty that makes an app feel like a mockup.
 */

/** Illustrative categories — not selectable, no audio attached. */
const EXPLORE = [
  { category: 'cup' as const, label: 'Cups', role: 'Percussion', color: '#F472B6' },
  { category: 'plant' as const, label: 'Plants', role: 'Ambient', color: '#34D399' },
  { category: 'laptop' as const, label: 'Laptops', role: 'Synth', color: '#A78BFA' },
  { category: 'bottle' as const, label: 'Bottles', role: 'Hit', color: '#38BDF8' },
  { category: 'keys' as const, label: 'Keys', role: 'Clicks', color: '#FB923C' },
];

export function HomeScreen({ onScan, onCompose, onOpenSession }: Props) {
  const insets = useSafeAreaInsets();

  const objects = useSession((s) => s.objects);
  const pcmBySlot = useSession((s) => s.pcmBySlot);
  const savedSessions = useSession((s) => s.savedSessions);
  const refreshSessions = useSession((s) => s.refreshSessions);
  const removeSession = useSession((s) => s.removeSession);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + BOTTOM_NAV_CLEARANCE },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* --- header --- */}
        <View style={styles.header}>
          <View>
            <View style={styles.wordmark}>
              <Text style={styles.world}>World</Text>
              <Text style={styles.jam}>Jam</Text>
              <Text style={styles.tm}>™</Text>
            </View>
            <Text style={styles.tagline}>ANYTHING CAN BE A STUDIO</Text>
          </View>
        </View>

        <View style={styles.greetRow}>
          <View style={styles.greetCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarGlyph}>◕</Text>
            </View>
            <View>
              <Text style={styles.greetName}>Hi, Creator</Text>
              <Text style={styles.greetSub}>Let&apos;s make some music!</Text>
            </View>
          </View>
        </View>

        {/* --- primary actions --- */}
        <View style={styles.tabs}>
          <ActionTab
            label="Scan"
            sub="Objects"
            gradient={gradients.scan}
            active
            onPress={onScan}
          />
          <ActionTab
            label="Compose"
            sub="with AI"
            gradient={gradients.compose}
            onPress={onCompose}
          />
        </View>

        {/* --- capture card --- */}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            onScan();
          }}
          accessibilityRole="button"
          accessibilityLabel="Point at an object to capture its sound"
          style={styles.captureCard}
        >
          <Image
            source={require('../../assets/hero-mug.png')}
            style={styles.captureBg}
            resizeMode="cover"
            accessible={false}
          />
          <LinearGradient
            colors={['rgba(8,9,12,0.78)', 'rgba(8,9,12,0.18)', 'rgba(8,9,12,0.72)']}
            style={StyleSheet.absoluteFill}
          />

          <View style={styles.captureInner}>
            <Text style={styles.captureTitle}>
              Point at an object{'\n'}to capture its sound
            </Text>

            <View style={styles.scanPill}>
              <View style={styles.scanDot} />
              <Text style={styles.scanText}>Tap to Scan</Text>
            </View>
          </View>
        </Pressable>

        {/* --- your sounds, when there are any --- */}
        {objects.length > 0 && (
          <>
            <SectionHeader title="Your Sounds" count={objects.length} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.row}
            >
              {objects.map((o) => (
                <View key={o.id} style={[styles.soundCard, { borderColor: o.color }]}>
                  <ObjectIcon category={o.category} color={o.color} size={26} />
                  <Text style={styles.soundName} numberOfLines={1}>
                    {o.label}
                  </Text>
                  <Waveform
                    pcm={pcmBySlot.get(o.slot) ?? null}
                    width={78}
                    height={18}
                    color={o.color}
                    bars={22}
                  />
                  <Text style={[styles.soundRole, { color: o.color }]}>{o.role}</Text>
                </View>
              ))}
            </ScrollView>
          </>
        )}

        {/* --- explore (illustrative) --- */}
        <SectionHeader title="Explore Sounds" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {EXPLORE.map((e) => (
            <View key={e.label} style={styles.exploreCard}>
              <ObjectIcon category={e.category} color={e.color} size={34} />
              <Text style={styles.exploreName}>{e.label}</Text>
              <View style={[styles.rolePill, { borderColor: e.color }]}>
                <Text style={[styles.roleText, { color: e.color }]}>{e.role}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
        <Text style={styles.exploreNote}>
          Examples of what you can record — every sound in your track is one you
          captured.
        </Text>

        {/* --- create with AI --- */}
        <SectionHeader title="Create with AI" />
        <View style={styles.aiRow}>
          <AiCard
            title="Auto Compose"
            sub="Turn your objects into a song"
            gradient={gradients.scan}
            onPress={onCompose}
          />
          <AiCard
            title="Choose a Style"
            sub="Lo-fi, EDM and more"
            gradient={gradients.capture}
            onPress={onCompose}
          />
        </View>

        {/* --- recent jams, only when some exist --- */}
        {savedSessions.length > 0 && (
          <>
            <SectionHeader title="Recent Jams" count={savedSessions.length} />
            <View style={styles.jamList}>
              {savedSessions.slice(0, 5).map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => onOpenSession(s.id)}
                  onLongPress={() => removeSession(s.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${s.name}`}
                  accessibilityHint="Long press to delete"
                  style={styles.jamCard}
                >
                  <LinearGradient
                    colors={gradients.brandShort}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.jamArt}
                  >
                    <Text style={styles.jamArtGlyph}>♪</Text>
                  </LinearGradient>

                  <View style={styles.jamMeta}>
                    <Text style={styles.jamName} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <Text style={styles.jamSub}>
                      {s.objectCount} sound{s.objectCount === 1 ? '' : 's'} ·{' '}
                      {s.style} · {s.bpm} BPM
                    </Text>
                  </View>

                  <View style={styles.jamPlay}>
                    <View style={styles.jamPlayTri} />
                  </View>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {count != null && <Text style={styles.sectionCount}>{count}</Text>}
    </View>
  );
}

function ActionTab({
  label,
  sub,
  gradient,
  active,
  onPress,
}: {
  label: string;
  sub: string;
  gradient: readonly [string, string, ...string[]];
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${sub}`}
      style={styles.tabWrap}
    >
      {active ? (
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.tab}
        >
          <Text style={styles.tabLabel}>{label}</Text>
          <Text style={styles.tabSub}>{sub}</Text>
        </LinearGradient>
      ) : (
        <View style={[styles.tab, styles.tabIdle]}>
          <Text style={styles.tabLabel}>{label}</Text>
          <Text style={styles.tabSub}>{sub}</Text>
        </View>
      )}
    </Pressable>
  );
}

function AiCard({
  title,
  sub,
  gradient,
  onPress,
}: {
  title: string;
  sub: string;
  gradient: readonly [string, string, ...string[]];
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
      style={styles.aiCard}
    >
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.aiGlyph}
      >
        <Text style={styles.aiGlyphText}>✦</Text>
      </LinearGradient>
      <Text style={styles.aiTitle}>{title}</Text>
      <Text style={styles.aiSub}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { gap: spacing.md, paddingHorizontal: spacing.lg },

  header: { flexDirection: 'row', justifyContent: 'space-between' },
  wordmark: { flexDirection: 'row', alignItems: 'flex-start' },
  world: { ...type.display, fontSize: 32, color: '#FFFFFF' },
  jam: { ...type.display, fontSize: 32, color: '#C77DFF' },
  tm: { ...type.caption, fontSize: 9, color: colors.textFaint, marginTop: 4 },
  tagline: { ...type.caption, fontSize: 9, letterSpacing: 2.4, color: colors.textDim },

  greetRow: { flexDirection: 'row' },
  greetCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGlyph: { fontSize: 20, color: colors.textDim },
  greetName: { ...type.label, color: colors.text },
  greetSub: { ...type.caption, color: colors.textDim },

  tabs: { flexDirection: 'row', gap: spacing.sm },
  tabWrap: { flex: 1 },
  tab: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    gap: 2,
  },
  tabIdle: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabLabel: { ...type.label, color: '#FFFFFF' },
  tabSub: { ...type.caption, color: 'rgba(255,255,255,0.7)' },

  captureCard: {
    height: 186,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  captureBg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  captureInner: { flex: 1, padding: spacing.lg, justifyContent: 'space-between' },
  captureTitle: { ...type.title, fontSize: 18, lineHeight: 24, color: '#FFFFFF' },

  reticle: { alignSelf: 'center', width: 110, height: 90 },
  corner: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderColor: colors.vibe,
  },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 6 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 6 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 6 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 6 },

  scanPill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.vibe,
    backgroundColor: 'rgba(10,12,16,0.75)',
  },
  scanDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  scanText: { ...type.label, color: '#FFFFFF' },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  sectionTitle: { ...type.title, fontSize: 19, color: colors.text },
  sectionCount: { ...type.caption, color: colors.textFaint },

  row: { gap: spacing.sm, paddingVertical: spacing.xs },

  soundCard: {
    width: 104,
    alignItems: 'center',
    gap: 5,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    backgroundColor: colors.surfaceRaised,
  },
  soundName: { ...type.label, fontSize: 12, color: colors.text },
  soundRole: { ...type.caption, fontSize: 9, textTransform: 'capitalize' },

  exploreCard: {
    width: 104,
    alignItems: 'center',
    gap: 7,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  exploreName: { ...type.label, fontSize: 12, color: colors.text },
  rolePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  roleText: { ...type.caption, fontSize: 9 },
  exploreNote: { ...type.caption, color: colors.textFaint, lineHeight: 15 },

  aiRow: { flexDirection: 'row', gap: spacing.sm },
  aiCard: {
    flex: 1,
    gap: 5,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  aiGlyph: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiGlyphText: { fontSize: 16, color: '#FFFFFF' },
  aiTitle: { ...type.label, fontSize: 13, color: colors.text },
  aiSub: { ...type.caption, color: colors.textDim, lineHeight: 14 },

  jamList: { gap: spacing.sm },
  jamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  jamArt: {
    width: 46,
    height: 46,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jamArtGlyph: { fontSize: 20, color: '#FFFFFF' },
  jamMeta: { flex: 1, gap: 2 },
  jamName: { ...type.label, color: colors.text },
  jamSub: { ...type.caption, color: colors.textDim, textTransform: 'capitalize' },
  jamPlay: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jamPlayTri: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftWidth: 10,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.text,
  },
});
