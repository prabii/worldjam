import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Logo } from '@/components/ui/Logo';
import { Glyph } from '@/components/ui/Glyph';
import { GradientButton } from '@/components/ui/GradientButton';
import { Knob } from '@/components/ui/Knob';
import { LayerSlider } from '@/components/ui/LayerSlider';
import { NeonCard } from '@/components/ui/NeonCard';
import { Waveform } from '@/components/Waveform';
import { useSession } from '@/state/sessionStore';
import { roleInfoFor } from '@/vision/objectRoles';
import { colors } from '@/theme';
import { gradients } from '@/theme/gradients';

interface Props {
  onBack: () => void;
  onKeepCreating: () => void;
  onAddSounds: () => void;
}

/**
 * Track Detail — the finished jam.
 *
 * Transport, the per-object layer mixer, and export. The layer sliders write
 * straight through to each object's volume, so moving one is audible on the
 * next loop rather than on save.
 */
export function TrackDetailScreen({ onBack, onKeepCreating, onAddSounds }: Props) {
  const insets = useSafeAreaInsets();
  const [waveWidth, setWaveWidth] = useState(0);
  const [soloed, setSoloed] = useState<string | null>(null);

  const objects = useSession((s) => s.objects);
  const pcmBySlot = useSession((s) => s.pcmBySlot);
  const loops = useSession((s) => s.loops);
  const playing = useSession((s) => s.playing);
  const bpm = useSession((s) => s.bpm);
  const plan = useSession((s) => s.plan);
  const lyrics = useSession((s) => s.lyrics);
  const exporting = useSession((s) => s.exporting);
  const togglePlay = useSession((s) => s.togglePlay);
  const setObjectVolume = useSession((s) => s.setObjectVolume);
  const removeObject = useSession((s) => s.removeObject);
  const exportTrack = useSession((s) => s.exportTrack);
  const shareTrack = useSession((s) => s.shareTrack);
  const saveCurrentSession = useSession((s) => s.saveCurrentSession);

  const bars = loops.find((l) => l.id === 'plan')?.bars ?? 4;
  const lengthSeconds = (bars * 4 * 60) / Math.max(1, bpm);

  // Elapsed readout. Driven by a timer rather than the audio clock: reading
  // the native frame counter every 100ms would cross the bridge constantly
  // for a number that only needs to look right.
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) {
      startedAt.current = null;
      setElapsed(0);
      return;
    }
    startedAt.current = Date.now();
    const id = setInterval(() => {
      if (startedAt.current == null) return;
      const secs = (Date.now() - startedAt.current) / 1000;
      setElapsed(lengthSeconds > 0 ? secs % lengthSeconds : secs);
    }, 100);
    return () => clearInterval(id);
  }, [playing, lengthSeconds]);

  const lead = objects[0];
  const role = lead ? roleInfoFor(lead.category) : null;
  const tint = lead?.color ?? '#A855F7';

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
        <Pressable
          onPress={() => void saveCurrentSession(lead?.label ?? 'My Jam')}
          style={styles.saveBtn}
          accessibilityRole="button"
          accessibilityLabel="Save jam"
        >
          <Glyph name="upload" size={16} color="#FFFFFF" />
          <Text style={styles.saveText}>Save</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ---- Title ---- */}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{lead ? `${lead.label} Jam` : 'Your Jam'}</Text>
          <Text style={styles.subtitle}>
            {role?.blurb ?? 'Everyday objects, turned into music.'}
          </Text>
          <View style={styles.tags}>
            {[plan?.style ?? 'jam', `${bpm} BPM`, `${objects.length} objects`].map((t) => (
              <View key={t} style={styles.tag}>
                <Text style={styles.tagText}>{t}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ---- Player ---- */}
        <NeonCard accent={tint + '55'} glow>
          <View style={styles.playerHead}>
            <Glyph name="waveform" size={18} color={tint} />
            <Text style={styles.playerTitle}>
              {lead ? `${lead.label} Beat 01` : 'Untitled'}
            </Text>
            <Text style={styles.playerTime}>
              {formatClock(elapsed)} / {formatClock(lengthSeconds)}
            </Text>
          </View>

          <View
            style={styles.waveWrap}
            onLayout={(e) => setWaveWidth(e.nativeEvent.layout.width)}
          >
            {waveWidth > 0 && (
              <Waveform
                pcm={lead ? (pcmBySlot.get(lead.slot) ?? null) : null}
                width={waveWidth}
                height={78}
                color={tint}
                mirrored
                progress={lengthSeconds > 0 ? elapsed / lengthSeconds : 0}
              />
            )}
          </View>

          <View style={styles.transport}>
            <TransportButton icon="shuffle" label="Shuffle" disabled />
            <TransportButton icon="prev" label="Previous" disabled />
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                togglePlay();
              }}
              accessibilityRole="button"
              accessibilityLabel={playing ? 'Pause' : 'Play'}
            >
              <LinearGradient
                colors={gradients.brandShort}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.playBig}
              >
                <Glyph name={playing ? 'pause' : 'play'} size={26} color="#FFFFFF" />
              </LinearGradient>
            </Pressable>
            <TransportButton icon="next" label="Next" disabled />
            <TransportButton icon="repeat" label="Repeat" active />
          </View>
        </NeonCard>

        {/* ---- Sound layers ---- */}
        <NeonCard accent="rgba(120,140,190,0.3)">
          <View style={styles.sectionHead}>
            <Glyph name="layers" size={20} color="#C4B5FD" />
            <Text style={styles.sectionTitle}>Sound Layers</Text>
            <Pressable
              onPress={onAddSounds}
              style={styles.addLayer}
              accessibilityRole="button"
              accessibilityLabel="Add a layer"
            >
              <Glyph name="plus" size={14} color={colors.text} />
              <Text style={styles.addLayerText}>Add Layer</Text>
            </Pressable>
          </View>

          <View style={styles.layerList}>
            {objects.length === 0 && (
              <Text style={styles.emptyText}>
                No layers yet — record an object to add one.
              </Text>
            )}
            {objects.map((o) => (
              <LayerSlider
                key={o.id}
                icon="waveform"
                label={o.label}
                value={o.volume}
                onChange={(v) => setObjectVolume(o.id, v)}
                accent={o.color}
                soloed={soloed === o.id}
                onSolo={() => setSoloed((s) => (s === o.id ? null : o.id))}
                onMenu={() => removeObject(o.id)}
              />
            ))}
          </View>
        </NeonCard>

        {/* ---- Sound settings ---- */}
        <NeonCard accent="rgba(56,189,248,0.3)">
          <View style={styles.sectionHead}>
            <Glyph name="knob" size={20} color="#38BDF8" />
            <Text style={styles.sectionTitle}>Sound Settings</Text>
          </View>
          <View style={styles.knobRow}>
            <Knob
              label="Tempo"
              value={(bpm - 60) / 120}
              onChange={(v) => useSession.setState({ bpm: Math.round(60 + v * 120) })}
              format={(v) => `${Math.round(60 + v * 120)}`}
              accent="#C084FC"
            />
            <Knob
              label="Master"
              value={useSession.getState().objects.length ? 0.8 : 0}
              onChange={() => {}}
              accent="#38BDF8"
            />
            <Knob label="Width" value={0.5} onChange={() => {}} accent="#34D399" />
            <Knob label="Tone" value={0.5} onChange={() => {}} accent="#EC4899" />
          </View>
        </NeonCard>

        {/* ---- Lyrics, when the AI wrote some ---- */}
        {lyrics && (
          <NeonCard accent="rgba(236,72,153,0.35)">
            <View style={styles.sectionHead}>
              <Glyph name="sparkle" size={20} color="#F472B6" />
              <Text style={styles.sectionTitle}>Lyrics</Text>
            </View>
            <Text style={styles.lyricText}>
              {lyrics.lines.map((l) => l.text).join('\n')}
            </Text>
          </NeonCard>
        )}

        {/* ---- Export ---- */}
        <NeonCard accent="rgba(168,85,247,0.4)">
          <View style={styles.sectionHead}>
            <Glyph name="export" size={20} color="#C4B5FD" />
            <View style={styles.sectionTitleWrap}>
              <Text style={styles.sectionTitle}>Export &amp; Share</Text>
              <Text style={styles.sectionSub}>Get your jam in the best quality.</Text>
            </View>
          </View>

          <View style={styles.exportRow}>
            <Pressable
              onPress={() => void exportTrack()}
              disabled={exporting || objects.length === 0}
              style={[styles.exportCard, styles.exportCardActive]}
              accessibilityRole="button"
              accessibilityLabel="Export as WAV"
            >
              <Glyph name="waveform" size={22} color="#FFFFFF" />
              <Text style={styles.exportLabel}>WAV</Text>
              <Text style={styles.exportSub}>High Quality</Text>
            </Pressable>

            <Pressable
              onPress={() => void shareTrack()}
              disabled={exporting || objects.length === 0}
              style={styles.exportCard}
              accessibilityRole="button"
              accessibilityLabel="Share jam"
            >
              <Glyph name="share" size={22} color="#C4B5FD" />
              <Text style={styles.exportLabel}>Share</Text>
              <Text style={styles.exportSub}>Send It</Text>
            </Pressable>
          </View>
        </NeonCard>

        <GradientButton
          label={exporting ? 'Rendering…' : 'Keep Creating'}
          trailing={exporting ? undefined : '→'}
          busy={exporting}
          onPress={onKeepCreating}
          gradient={gradients.brand}
        />

        <Text style={styles.motto}>&ldquo;Every sound tells a story.&rdquo;</Text>
      </ScrollView>
    </View>
  );
}

function TransportButton({
  icon,
  label,
  active,
  disabled,
  onPress,
}: {
  icon: 'shuffle' | 'prev' | 'next' | 'repeat';
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={disabled ? `${label}, not available yet` : label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
    >
      <Glyph
        name={icon}
        size={22}
        color={
          disabled
            ? 'rgba(200,214,240,0.3)'
            : active
              ? '#C4B5FD'
              : 'rgba(226,235,255,0.88)'
        }
      />
    </Pressable>
  );
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
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
    backgroundColor: 'rgba(28,33,48,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.6)',
    backgroundColor: 'rgba(24,28,48,0.9)',
  },
  saveText: { fontSize: 13.5, fontWeight: '700', color: '#FFFFFF' },

  scroll: { paddingHorizontal: 16, gap: 14 },

  titleBlock: { gap: 7 },
  title: { fontSize: 30, fontWeight: '800', color: colors.text, letterSpacing: -0.7 },
  subtitle: { fontSize: 14.5, color: colors.textDim },
  tags: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  tag: {
    paddingVertical: 6,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.35)',
  },
  tagText: { fontSize: 12, fontWeight: '600', color: colors.text },

  playerHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  playerTitle: { flex: 1, fontSize: 15.5, fontWeight: '700', color: colors.text },
  playerTime: { fontSize: 12.5, fontWeight: '600', color: colors.textDim },
  waveWrap: { marginVertical: 14 },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 4,
  },
  playBig: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  sectionTitleWrap: { flex: 1, gap: 2 },
  sectionTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text },
  sectionSub: { fontSize: 12.5, color: colors.textDim },
  addLayer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  addLayerText: { fontSize: 12.5, fontWeight: '600', color: colors.text },
  layerList: { gap: 13 },
  emptyText: { fontSize: 13, color: colors.textDim, lineHeight: 19 },

  knobRow: { flexDirection: 'row', justifyContent: 'space-around' },

  lyricText: { fontSize: 14.5, color: colors.text, lineHeight: 24 },

  exportRow: { flexDirection: 'row', gap: 10 },
  exportCard: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
    paddingVertical: 17,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.28)',
    backgroundColor: 'rgba(16,20,32,0.9)',
  },
  exportCardActive: {
    borderColor: 'rgba(168,85,247,0.8)',
    backgroundColor: 'rgba(40,26,68,0.92)',
  },
  exportLabel: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  exportSub: { fontSize: 11, color: colors.textDim },

  motto: {
    textAlign: 'center',
    fontSize: 13,
    color: colors.textFaint,
    fontStyle: 'italic',
    marginTop: 2,
  },
});
