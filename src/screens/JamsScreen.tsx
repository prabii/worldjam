import React, { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { gradients } from '@/theme/gradients';
import { useSession } from '@/state/sessionStore';
import { colors, radius, spacing, type } from '@/theme';

interface Props {
  onBack: () => void;
  onOpenSession: (id: string) => void;
  onNewJam: () => void;
}

export function JamsScreen({ onBack, onOpenSession, onNewJam }: Props) {
  const insets = useSafeAreaInsets();
  const savedSessions = useSession((s) => s.savedSessions);
  const refreshSessions = useSession((s) => s.refreshSessions);
  const removeSession = useSession((s) => s.removeSession);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={onBack} accessibilityRole="button" style={styles.backBtn}>
          <Text style={styles.backChevron}>{'‹'}</Text>
          <Text style={styles.backLabel}>Home</Text>
        </Pressable>
        <Text style={styles.headerTitle}>My Jams</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {savedSessions.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Text style={styles.emptyGlyph}>♪</Text>
            </View>
            <Text style={styles.emptyTitle}>No jams yet</Text>
            <Text style={styles.emptySub}>
              Capture some sounds and create{'\n'}your first beat to see it here.
            </Text>
            <Pressable
              onPress={onNewJam}
              accessibilityRole="button"
              style={styles.emptyBtn}
            >
              <Text style={styles.emptyBtnText}>Start a jam</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.countLabel}>
              {savedSessions.length} jam{savedSessions.length === 1 ? '' : 's'}
            </Text>
            {savedSessions.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  onOpenSession(s.id);
                }}
                onLongPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                  removeSession(s.id);
                }}
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
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 72,
    gap: 2,
  },
  backChevron: { fontSize: 22, fontWeight: '300', color: colors.vibe, marginTop: -1 },
  backLabel: { ...type.body, color: colors.vibe },
  headerTitle: {
    ...type.title,
    fontSize: 18,
    color: colors.text,
    textAlign: 'center',
  },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md },

  countLabel: {
    ...type.caption,
    letterSpacing: 2,
    color: colors.textFaint,
    marginTop: spacing.sm,
  },

  jamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSolid,
  },
  jamArt: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jamArtGlyph: { fontSize: 22, color: '#FFFFFF' },
  jamMeta: { flex: 1, gap: 3 },
  jamName: { ...type.label, fontSize: 15, color: colors.text },
  jamSub: { ...type.caption, color: colors.textDim, textTransform: 'capitalize' },
  jamPlay: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jamPlayTri: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderLeftWidth: 11,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.text,
  },

  emptyCard: {
    alignItems: 'center',
    paddingVertical: spacing.xxl * 2,
    gap: spacing.md,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyGlyph: { fontSize: 28, color: colors.textDim },
  emptyTitle: { ...type.title, color: colors.text },
  emptySub: {
    ...type.body,
    color: colors.textDim,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyBtn: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.vibe,
  },
  emptyBtnText: { ...type.label, color: '#FFFFFF' },
});
