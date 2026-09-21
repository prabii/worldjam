import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BOTTOM_NAV_CLEARANCE } from '@/components/ui/BottomNav';
import * as Haptics from 'expo-haptics';
import { Logo } from '@/components/ui/Logo';
import { Glyph, type GlyphName } from '@/components/ui/Glyph';
import { GradientButton } from '@/components/ui/GradientButton';
import { Knob } from '@/components/ui/Knob';
import { NeonCard } from '@/components/ui/NeonCard';
import { buildBrief } from '@/ai/brief';
import { useSession } from '@/state/sessionStore';
import { colors } from '@/theme';
import { gradients } from '@/theme/gradients';
import type { Style } from '@/types';

interface Props {
  onBack: () => void;
  onRecord: () => void;
  /** Runs the arranger, then moves to the studio. */
  onGenerate: () => void;
}

/**
 * Mood chips.
 *
 * Eight moods mapping onto the six musical styles the engine knows: "Happy"
 * and "Energetic" both land on EDM because they ask the arranger for the same
 * thing, and pretending otherwise would mean two buttons that sound identical.
 */
const MOODS: Array<{ label: string; style: Style }> = [
  { label: 'Chill', style: 'chill' },
  { label: 'Energetic', style: 'edm' },
  { label: 'Dark', style: 'cinematic' },
  { label: 'Cinematic', style: 'cinematic' },
  { label: 'Happy', style: 'edm' },
  { label: 'Sad', style: 'lofi' },
  { label: 'Focus', style: 'lofi' },
  { label: 'Experimental', style: 'jazz' },
];

const SOURCES: Array<{ key: string; icon: GlyphName; label: string; enabled: boolean }> = [
  { key: 'record', icon: 'mic', label: 'Record', enabled: true },
  { key: 'upload', icon: 'upload', label: 'Upload', enabled: false },
  { key: 'browse', icon: 'music', label: 'Browse\nSounds', enabled: false },
  { key: 'ai', icon: 'sparkle', label: 'Generate\nwith AI', enabled: true },
];

/**
 * Create Your Jam — the guided path.
 *
 * Three numbered steps: get sounds in, pick a feel, fine-tune. It is the same
 * session state the studio edits, so a change here is audible immediately
 * rather than being applied on save.
 */
export function CreateJamScreen({ onBack, onRecord, onGenerate }: Props) {
  const insets = useSafeAreaInsets();

  const objects = useSession((s) => s.objects);
  const style = useSession((s) => s.style);
  const arranging = useSession((s) => s.arranging);
  const applyStyle = useSession((s) => s.applyStyle);
  const arrange = useSession((s) => s.arrange);
  const setReference = useSession((s) => s.setReference);

  const [mood, setMood] = useState<string>('Chill');
  const [reverb, setReverb] = useState(0.4);
  const [delay, setDelay] = useState(0.2);
  const [pitch, setPitch] = useState(0.5);
  const [direction, setDirection] = useState('');

  const pickMood = (m: (typeof MOODS)[number]) => {
    Haptics.selectionAsync().catch(() => {});
    setMood(m.label);
    void applyStyle(m.style);
  };

  const generate = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (direction.trim()) setReference(direction.trim());
    // The knobs describe the result rather than driving an effect chain; see
    // ai/brief.ts for why.
    const brief = buildBrief({ mood, reverb, space: delay, pitch, direction });
    await arrange(brief || undefined);
    onGenerate();
  };

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
        <View style={styles.iconBtn}>
          <Glyph name="sparkle" size={19} color="#C4B5FD" />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + BOTTOM_NAV_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Create Your Jam</Text>
          <Text style={styles.subtitle}>
            Turn everyday sounds into something extraordinary.
          </Text>
        </View>

        {/* ---- 1. Add sounds ---- */}
        <NeonCard accent="rgba(99,102,241,0.4)">
          <View style={styles.stepHead}>
            <Glyph name="equalizer" size={26} color="#818CF8" />
            <View style={styles.stepText}>
              <Text style={styles.stepTitle}>1. Add Sounds</Text>
              <Text style={styles.stepSub}>Record the objects around you.</Text>
            </View>
          </View>

          <View style={styles.sourceRow}>
            {SOURCES.map((s) => (
              <Pressable
                key={s.key}
                disabled={!s.enabled}
                onPress={() => (s.key === 'ai' ? void generate() : onRecord())}
                style={[styles.source, !s.enabled && styles.sourceDisabled]}
                accessibilityRole="button"
                accessibilityLabel={
                  s.enabled
                    ? s.label.replace('\n', ' ')
                    : `${s.label.replace('\n', ' ')}, not available yet`
                }
                accessibilityState={{ disabled: !s.enabled }}
              >
                <Glyph
                  name={s.icon}
                  size={24}
                  color={s.enabled ? '#C4B5FD' : 'rgba(200,214,240,0.35)'}
                />
                <Text style={[styles.sourceText, !s.enabled && styles.sourceTextDisabled]}>
                  {s.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.objectCount}>
            {objects.length === 0
              ? 'No sounds yet — record one to begin.'
              : `${objects.length} sound${objects.length === 1 ? '' : 's'} ready: ${objects
                  .map((o) => o.label)
                  .join(', ')}`}
          </Text>
        </NeonCard>

        {/* ---- 2. Set mood ---- */}
        <NeonCard accent="rgba(168,85,247,0.4)">
          <View style={styles.stepHead}>
            <Glyph name="star" size={24} color="#C084FC" />
            <View style={styles.stepText}>
              <Text style={styles.stepTitle}>2. Set Mood</Text>
              <Text style={styles.stepSub}>Choose a vibe for your jam.</Text>
            </View>
          </View>

          <View style={styles.moodGrid}>
            {MOODS.map((m) => {
              const active = m.label === mood;
              return (
                <Pressable
                  key={m.label}
                  onPress={() => pickMood(m)}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.label} mood`}
                  accessibilityState={{ selected: active }}
                >
                  {active ? (
                    <LinearGradient
                      colors={['#7C3AED', '#A855F7']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.moodChip}
                    >
                      <Text style={[styles.moodText, styles.moodTextActive]}>
                        {m.label}
                      </Text>
                    </LinearGradient>
                  ) : (
                    <View style={[styles.moodChip, styles.moodChipIdle]}>
                      <Text style={styles.moodText}>{m.label}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </NeonCard>

        {/* ---- 3. Advanced ---- */}
        <NeonCard accent="rgba(56,189,248,0.35)">
          <View style={styles.stepHead}>
            <Glyph name="filter" size={24} color="#38BDF8" />
            <View style={styles.stepText}>
              <Text style={styles.stepTitle}>3. Advanced Options</Text>
              <Text style={styles.stepSub}>These steer how the AI arranges it.</Text>
            </View>
          </View>

          <View style={styles.knobRow}>
            <Knob label="Reverb" value={reverb} onChange={setReverb} accent="#C084FC" />
            <Knob label="Space" value={delay} onChange={setDelay} accent="#38BDF8" />
            <Knob
              label="Pitch"
              value={pitch}
              onChange={setPitch}
              accent="#EC4899"
              // Centre is no shift, so the readout is signed semitones rather
              // than a percentage, which would read as "0% pitch".
              format={(v) => {
                const st = Math.round((v - 0.5) * 24);
                return st === 0 ? '0 st' : st > 0 ? `+${st} st` : `${st} st`;
              }}
            />
          </View>
        </NeonCard>

        {/* ---- Direction ---- */}
        <NeonCard accent="rgba(236,72,153,0.35)">
          <View style={styles.stepHead}>
            <Glyph name="sparkle" size={24} color="#F472B6" />
            <View style={styles.stepText}>
              <Text style={styles.stepTitle}>Tell the AI more</Text>
              <Text style={styles.stepSub}>
                An artist, a feeling, an instrument — anything.
              </Text>
            </View>
          </View>

          <TextInput
            value={direction}
            onChangeText={setDirection}
            placeholder="e.g. Charlie Puth meets a coffee shop — soft piano, tight snap"
            placeholderTextColor={colors.textFaint}
            style={styles.directionInput}
            multiline
            accessibilityLabel="Extra direction for the AI"
          />
        </NeonCard>

        <GradientButton
          label={arranging ? 'Composing…' : 'Generate with AI'}
          trailing={arranging ? undefined : '→'}
          busy={arranging}
          disabled={objects.length === 0}
          onPress={generate}
          gradient={gradients.brand}
          accessibilityLabel={
            objects.length === 0
              ? 'Generate with AI. Record at least one sound first.'
              : 'Generate with AI'
          }
        />

        <Text style={styles.motto}>Real Objects. Real Music.</Text>
      </ScrollView>
    </View>
  );
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

  scroll: { paddingHorizontal: 16, gap: 14 },

  titleBlock: { gap: 5, marginBottom: 2 },
  title: { fontSize: 32, fontWeight: '800', color: colors.text, letterSpacing: -0.8 },
  subtitle: { fontSize: 14.5, color: colors.textDim },

  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  stepText: { flex: 1, gap: 2 },
  stepTitle: { fontSize: 18, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },
  stepSub: { fontSize: 13, color: colors.textDim },

  sourceRow: { flexDirection: 'row', gap: 9 },
  source: {
    flex: 1,
    aspectRatio: 0.92,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.28)',
    backgroundColor: 'rgba(16,20,32,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 6,
  },
  sourceDisabled: { opacity: 0.45 },
  sourceText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  sourceTextDisabled: { color: colors.textFaint },
  objectCount: { marginTop: 12, fontSize: 12.5, color: colors.textDim, lineHeight: 18 },

  moodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  moodChip: { paddingVertical: 11, paddingHorizontal: 19, borderRadius: 999 },
  moodChipIdle: { borderWidth: 1, borderColor: 'rgba(120,140,190,0.3)' },
  moodText: { fontSize: 14, fontWeight: '600', color: colors.textDim },
  moodTextActive: { color: '#FFFFFF', fontWeight: '700' },

  knobRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 4 },

  directionInput: {
    minHeight: 60,
    fontSize: 14,
    color: colors.text,
    textAlignVertical: 'top',
    padding: 0,
  },

  motto: {
    textAlign: 'center',
    fontSize: 12.5,
    color: colors.textFaint,
    letterSpacing: 1.4,
    fontWeight: '500',
    marginTop: 4,
  },
});
