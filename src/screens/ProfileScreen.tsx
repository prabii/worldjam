import React, { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Logo } from '@/components/ui/Logo';
import { Glyph, type GlyphName } from '@/components/ui/Glyph';
import { BOTTOM_NAV_CLEARANCE } from '@/components/ui/BottomNav';
import { NeonCard } from '@/components/ui/NeonCard';
import { useSession } from '@/state/sessionStore';
import { getModelStatus, type ModelStatus } from '@/ai/modelLoader';
import { measureLatency } from '@/audio/engine';
import { colors } from '@/theme';
import { gradients } from '@/theme/gradients';

interface Props {
  onBack: () => void;
  onOpenJams: () => void;
}

/**
 * Profile.
 *
 * Everything here is measured or counted, never invented. A profile screen is
 * where a demo is most tempting to fill with plausible numbers — streaks,
 * followers, "127 jams created" — and every one of those would be a lie the
 * moment someone looked closely. What this shows instead is the state of the
 * thing the user actually owns: their sounds, their saved jams, the model on
 * their device, and the latency they are getting.
 */
export function ProfileScreen({ onBack, onOpenJams }: Props) {
  const insets = useSafeAreaInsets();

  const objects = useSession((s) => s.objects);
  const savedSessions = useSession((s) => s.savedSessions);
  const refreshSessions = useSession((s) => s.refreshSessions);
  const guidanceOn = useSession((s) => s.guidanceOn);
  const setGuidance = useSession((s) => s.setGuidance);

  const [model, setModel] = React.useState<ModelStatus>(() => getModelStatus());
  const [latency, setLatency] = React.useState<number | null>(null);

  useEffect(() => {
    void refreshSessions();
    // The model loads in the background, so its state is polled briefly rather
    // than read once on mount.
    const id = setInterval(() => setModel(getModelStatus()), 1500);
    return () => clearInterval(id);
  }, [refreshSessions]);

  const totalSeconds = useMemo(
    () => savedSessions.reduce((a, s) => a + s.durationSeconds, 0),
    [savedSessions],
  );

  const modelLine =
    model.state === 'ready'
      ? `${fileName(model.path)} · ${(model.sizeMb / 1024).toFixed(1)} GB`
      : model.state === 'loading'
        ? `Loading ${fileName(model.path)}…`
        : model.state === 'searching'
          ? 'Looking for a model…'
          : model.state === 'error'
            ? model.message
            : 'No model on this device';

  const modelTone =
    model.state === 'ready'
      ? colors.live
      : model.state === 'error'
        ? colors.warn
        : colors.textFaint;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 6 }]}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Glyph name="back" size={22} color="#FFFFFF" />
        </Pressable>
        <View style={styles.headerCenter}>
          <Logo size="small" tagline="studio" glyph={false} />
        </View>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + BOTTOM_NAV_CLEARANCE },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ---- Identity ---- */}
        <View style={styles.identity}>
          <LinearGradient
            colors={gradients.brand}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatar}
          >
            <Glyph name="user" size={30} color="#FFFFFF" />
          </LinearGradient>
          <View style={styles.identityText}>
            <Text style={styles.name}>Creator</Text>
            <Text style={styles.sub}>Everything you make stays on this phone.</Text>
          </View>
        </View>

        {/* ---- Real counts ---- */}
        <View style={styles.statRow}>
          <Stat icon="waveform" tint="#C084FC" value={`${objects.length}`} label="Sounds" />
          <Stat icon="music" tint="#60A5FA" value={`${savedSessions.length}`} label="Saved Jams" />
          <Stat
            icon="clock"
            tint="#34D399"
            value={formatTotal(totalSeconds)}
            label="Recorded"
          />
        </View>

        {/* ---- On-device AI ---- */}
        <NeonCard accent="rgba(168,85,247,0.4)">
          <View style={styles.rowHead}>
            <Glyph name="sparkle" size={20} color="#C4B5FD" />
            <Text style={styles.cardTitle}>On-device AI</Text>
            <View style={[styles.dot, { backgroundColor: modelTone }]} />
          </View>
          <Text style={styles.cardBody}>{modelLine}</Text>
          <Text style={styles.cardNote}>
            The model runs on this phone. Nothing you record is uploaded.
          </Text>
        </NeonCard>

        {/* ---- Audio ---- */}
        <NeonCard accent="rgba(56,189,248,0.35)">
          <View style={styles.rowHead}>
            <Glyph name="volume" size={20} color="#38BDF8" />
            <Text style={styles.cardTitle}>Audio latency</Text>
          </View>
          <Text style={styles.cardBody}>
            {latency == null
              ? 'Not measured yet'
              : `${latency.toFixed(1)} ms from tap to sound`}
          </Text>
          <Pressable
            onPress={() => {
              // Dispatch plus stream latency is what a player actually feels;
              // either number alone understates it.
              const r = measureLatency();
              setLatency(r.dispatchMs + Math.max(0, r.streamLatencyMs));
            }}
            style={styles.action}
            accessibilityRole="button"
            accessibilityLabel="Measure audio latency"
          >
            <Text style={styles.actionText}>Measure</Text>
          </Pressable>
        </NeonCard>

        {/* ---- Accessibility ---- */}
        <NeonCard accent="rgba(52,211,153,0.35)">
          <View style={styles.rowHead}>
            <Glyph name="mic" size={20} color="#34D399" />
            <View style={styles.cardTitleWrap}>
              <Text style={styles.cardTitle}>Spoken guidance</Text>
              <Text style={styles.cardNote}>
                Describes what is around you and confirms each capture aloud.
              </Text>
            </View>
            <Switch
              value={guidanceOn}
              onValueChange={setGuidance}
              trackColor={{ false: 'rgba(120,140,190,0.3)', true: 'rgba(52,211,153,0.6)' }}
              thumbColor="#FFFFFF"
              accessibilityLabel="Spoken guidance"
            />
          </View>
        </NeonCard>

        {/* ---- Library shortcut ---- */}
        <Pressable
          onPress={onOpenJams}
          accessibilityRole="button"
          accessibilityLabel="Open my jams"
        >
          <NeonCard accent="rgba(120,140,190,0.3)">
            <View style={styles.rowHead}>
              <Glyph name="library" size={20} color="#C4B5FD" />
              <View style={styles.cardTitleWrap}>
                <Text style={styles.cardTitle}>My Jams</Text>
                <Text style={styles.cardNote}>
                  {savedSessions.length === 0
                    ? 'Nothing saved yet'
                    : `${savedSessions.length} saved`}
                </Text>
              </View>
              <Glyph name="chevronRight" size={18} color={colors.textDim} />
            </View>
          </NeonCard>
        </Pressable>

        <Text style={styles.footer}>WorldJam · Team PRXFR</Text>
      </ScrollView>
    </View>
  );
}

function Stat({
  icon,
  tint,
  value,
  label,
}: {
  icon: GlyphName;
  tint: string;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.stat}>
      <View style={[styles.statIcon, { backgroundColor: tint + '22' }]}>
        <Glyph name={icon} size={18} color={tint} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function fileName(path: string | null): string {
  if (!path) return 'Model';
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? 'Model';
}

function formatTotal(seconds: number): string {
  if (seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 10,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { paddingHorizontal: 16, gap: 14 },

  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 2 },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityText: { flex: 1, gap: 4 },
  name: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.6 },
  sub: { fontSize: 13.5, color: colors.textDim, lineHeight: 19 },

  statRow: { flexDirection: 'row', gap: 10 },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 15,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.24)',
    backgroundColor: 'rgba(12,15,26,0.9)',
  },
  statIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: { fontSize: 20, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 11.5, color: colors.textDim, fontWeight: '500' },

  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  cardTitleWrap: { flex: 1, gap: 2 },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.text },
  cardBody: { marginTop: 10, fontSize: 14, color: colors.text },
  cardNote: { marginTop: 4, fontSize: 12.5, color: colors.textDim, lineHeight: 18 },
  dot: { width: 9, height: 9, borderRadius: 5 },

  action: {
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.6)',
  },
  actionText: { fontSize: 13, fontWeight: '700', color: '#7DD3FC' },

  footer: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.textFaint,
    letterSpacing: 1.2,
    marginTop: 6,
  },
});
