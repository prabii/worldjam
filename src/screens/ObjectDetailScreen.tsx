import React, { useMemo, useState } from 'react';
import {
  Image,
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
import { Glyph } from '@/components/ui/Glyph';
import { GradientButton } from '@/components/ui/GradientButton';
import { SegmentTabs, type SegmentTab } from '@/components/ui/SegmentTabs';
import { TempoSlider } from '@/components/ui/TempoSlider';
import { LayerSlider } from '@/components/ui/LayerSlider';
import { Waveform } from '@/components/Waveform';
import { ArrangeTimeline } from '@/components/ArrangeTimeline';
import { useSession } from '@/state/sessionStore';
import { roleInfoFor } from '@/vision/objectRoles';
import { colors } from '@/theme';
import { gradients } from '@/theme/gradients';
import type { Style } from '@/types';

interface Props {
  objectId: string;
  onBack: () => void;
  /** Runs the arranger and moves to the studio. */
  onGenerate: () => void;
  onAddObject: () => void;
}

/**
 * The six vibes, with the artwork from the design.
 *
 * Each tile is the real image rather than a flat gradient: a sunset, a neon
 * triangle, a cassette. The picture is what makes the choice readable at a
 * glance — six coloured rectangles all read as "a button", and the user has to
 * fall back on the label every time.
 */
const STYLES: Array<{ key: Style; label: string; art: number }> = [
  { key: 'lofi', label: 'Lo-fi', art: require('../../assets/styles/lofi.png') },
  { key: 'edm', label: 'EDM', art: require('../../assets/styles/edm.png') },
  { key: 'cinematic', label: 'Ambient', art: require('../../assets/styles/ambient.png') },
  { key: 'chill', label: 'Hip Hop', art: require('../../assets/styles/hiphop.png') },
  { key: 'rock', label: 'Acoustic', art: require('../../assets/styles/acoustic.png') },
  { key: 'jazz', label: 'Cinematic', art: require('../../assets/styles/cinematic.png') },
];

const TABS: SegmentTab[] = [
  { key: 'compose', icon: 'music', label: 'Compose', sub: 'Create Music' },
  { key: 'arrange', icon: 'grid', label: 'Arrange', sub: 'Build Your Jam' },
  { key: 'mix', icon: 'target', label: 'Mix', sub: 'Blend Sounds' },
];

/**
 * Step 2 — the object's own screen.
 *
 * Shows what was actually captured, lets the user set the vibe and tempo, and
 * hands the whole session to the arranger. The direction box is what turns
 * this from a preset picker into something that can be pushed toward a
 * specific sound.
 */
export function ObjectDetailScreen({ objectId, onBack, onGenerate, onAddObject }: Props) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState('compose');
  // Waveform needs an explicit width, so the row measures itself.
  const [waveWidth, setWaveWidth] = useState(0);
  const [direction, setDirection] = useState('');

  const objects = useSession((s) => s.objects);
  const pcmBySlot = useSession((s) => s.pcmBySlot);
  const bpm = useSession((s) => s.bpm);
  const style = useSession((s) => s.style);
  const arranging = useSession((s) => s.arranging);
  const loops = useSession((s) => s.loops);
  const setObjectVolume = useSession((s) => s.setObjectVolume);
  const playObject = useSession((s) => s.playObject);
  const removeObject = useSession((s) => s.removeObject);
  const renameObject = useSession((s) => s.renameObject);
  const applyStyle = useSession((s) => s.applyStyle);
  const setReference = useSession((s) => s.setReference);
  const arrange = useSession((s) => s.arrange);

  const loop = loops.find((l) => l.id === 'plan') ?? null;
  const object = objects.find((o) => o.id === objectId) ?? objects[0];
  const others = objects.filter((o) => o.id !== object?.id);

  const role = object ? roleInfoFor(object.category) : null;
  const pcm = object ? pcmBySlot.get(object.slot) : undefined;

  const traits = useMemo(() => {
    if (!object || !role) return [];
    // Traits come from the lookup table, but the measured features override
    // them where they disagree — the recording is the truth about the object.
    const f = object.features;
    if (!f) return role.traits;
    const measured: string[] = [];
    measured.push(f.brightness > 2600 ? 'Bright' : f.brightness > 1200 ? 'Warm' : 'Dark');
    measured.push(f.decay < 0.18 ? 'Percussive' : f.decay < 0.6 ? 'Resonant' : 'Sustained');
    measured.push(f.tonality > 0.55 ? 'Pitched' : 'Noisy');
    return [role.traits[0], ...measured];
  }, [object, role]);

  if (!object || !role) {
    return (
      <View style={[styles.root, styles.empty, { paddingTop: insets.top + 40 }]}>
        <Glyph name="waveform" size={40} color={colors.textFaint} />
        <Text style={styles.emptyText}>No object captured yet.</Text>
        <Pressable onPress={onBack} style={styles.emptyBtn}>
          <Text style={styles.emptyBtnText}>Back to scanning</Text>
        </Pressable>
      </View>
    );
  }

  const handleGenerate = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (direction.trim()) setReference(direction.trim());
    await arrange(direction.trim() || undefined);
    onGenerate();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 6 }]}>
      {/* ---- Header ---- */}
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
          <Logo size="medium" tagline="studio" glyph={false} />
        </View>

        <Pressable
          onPress={() => removeObject(object.id)}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${object.label}`}
        >
          <Glyph name="trash" size={19} color={colors.danger} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + BOTTOM_NAV_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ---- Object identity ---- */}
        <View style={styles.identity}>
          <View style={[styles.art, { borderColor: object.color }]}>
            <LinearGradient
              colors={[object.color + '3A', 'rgba(10,13,22,0.95)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Glyph name="waveform" size={44} color={object.color} />
            <View style={styles.artBadge}>
              <Text style={styles.artBadgeText} numberOfLines={1}>
                {object.label}
              </Text>
            </View>
          </View>

          <View style={styles.identityText}>
            <Text style={styles.kicker}>Your Object</Text>
            <TextInput
              value={object.label}
              onChangeText={(t) => renameObject(object.id, t)}
              style={styles.title}
              accessibilityLabel="Object name"
              selectTextOnFocus
            />

            <View style={styles.traits}>
              {traits.map((t) => (
                <View key={t} style={styles.trait}>
                  <Text style={styles.traitText}>{t}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.blurb}>{role.blurb}</Text>
          </View>
        </View>

        <SegmentTabs tabs={TABS} active={tab} onSelect={setTab} />

        {tab === 'arrange' ? (
          <View style={styles.tabPanel}>
            <View style={styles.sectionTitleWrap}>
              <Text style={styles.sectionTitle}>Arrange</Text>
              <Text style={styles.sectionSub}>
                {loop
                  ? 'Every block is a beat the arrangement plays.'
                  : 'Generate a jam and the timeline fills in.'}
              </Text>
            </View>
            <ArrangeTimeline
              objects={objects}
              loop={loop}
              bpm={bpm}
              playheadBeat={null}
              onSelectObject={() => {}}
              onAddObject={onAddObject}
            />
          </View>
        ) : tab === 'mix' ? (
          <View style={styles.tabPanel}>
            <View style={styles.sectionTitleWrap}>
              <Text style={styles.sectionTitle}>Mix</Text>
              <Text style={styles.sectionSub}>Set how loud each object sits.</Text>
            </View>
            {objects.length === 0 ? (
              <Text style={styles.sectionSub}>Nothing recorded yet.</Text>
            ) : (
              objects.map((o) => (
                <LayerSlider
                  key={o.id}
                  icon="waveform"
                  label={o.label}
                  value={o.volume}
                  onChange={(v) => setObjectVolume(o.id, v)}
                  accent={o.color}
                />
              ))
            )}
          </View>
        ) : (
          <>
        {/* ---- Generated sound ---- */}
        <View style={styles.sectionHead}>
          <View style={styles.sectionTitleWrap}>
            <Text style={styles.sectionTitle}>Captured Sound</Text>
            <Text style={styles.sectionSub}>Here&apos;s how your object sounds</Text>
          </View>
        </View>

        <View style={styles.player}>
          <Pressable
            onPress={() => playObject(object.id)}
            style={[styles.playBtn, { borderColor: object.color }]}
            accessibilityRole="button"
            accessibilityLabel={`Play ${object.label}`}
          >
            <Glyph name="play" size={22} color="#FFFFFF" />
          </Pressable>

          <View
            style={styles.playerWave}
            onLayout={(e) => setWaveWidth(e.nativeEvent.layout.width)}
          >
            {waveWidth > 0 && (
              <Waveform
                pcm={pcm ?? null}
                width={waveWidth}
                height={52}
                color={object.color}
                mirrored
              />
            )}
          </View>

          <Text style={styles.playerTime}>
            {object.features ? `${object.features.duration.toFixed(1)}s` : '—'}
          </Text>
        </View>

        {/* ---- Music style ---- */}
        <View style={styles.sectionTitleWrap}>
          <Text style={styles.sectionTitle}>Music Style</Text>
          <Text style={styles.sectionSub}>Choose a vibe for your jam</Text>
        </View>

        <View style={styles.styleGrid}>
          {STYLES.map((s) => {
            const active = s.key === style;
            return (
              <Pressable
                key={s.label}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  void applyStyle(s.key);
                }}
                style={[styles.styleCard, active && styles.styleCardActive]}
                accessibilityRole="button"
                accessibilityLabel={`${s.label} style`}
                accessibilityState={{ selected: active }}
              >
                <Image source={s.art} style={styles.styleArt} resizeMode="cover" />
                <Text style={[styles.styleLabel, active && styles.styleLabelActive]}>
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* ---- Tempo ---- */}
        <View style={styles.tempoHead}>
          <Text style={styles.sectionTitle}>Tempo</Text>
          <Text style={styles.bpmReadout}>BPM {bpm}</Text>
        </View>
        <TempoSlider bpm={bpm} onChange={(v) => useSession.setState({ bpm: v })} />

        {/* ---- Direction for the AI ---- */}
        <View style={styles.sectionTitleWrap}>
          <Text style={styles.sectionTitle}>Tell the AI what you want</Text>
          <Text style={styles.sectionSub}>
            Name an artist, a feeling, or an instrument — it shapes the whole song
          </Text>
        </View>

        <View style={styles.directionBox}>
          <TextInput
            value={direction}
            onChangeText={setDirection}
            placeholder="e.g. like Charlie Puth — warm piano, tight drums"
            placeholderTextColor={colors.textFaint}
            style={styles.directionInput}
            multiline
            accessibilityLabel="Direction for the AI"
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.suggestRow}
        >
          {DIRECTION_SUGGESTIONS.map((s) => (
            <Pressable
              key={s}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setDirection((d) => (d.trim() ? `${d.trim()}, ${s}` : s));
              }}
              style={styles.suggestChip}
              accessibilityRole="button"
              accessibilityLabel={`Add direction: ${s}`}
            >
              <Glyph name="sparkle" size={13} color="#C4B5FD" />
              <Text style={styles.suggestText}>{s}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* ---- Additional objects ---- */}
        <View style={styles.sectionTitleWrap}>
          <Text style={styles.sectionTitle}>
            Additional Objects <Text style={styles.optional}>(Optional)</Text>
          </Text>
          <Text style={styles.sectionSub}>Add more objects to layer new sounds</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          <Pressable
            onPress={onAddObject}
            style={styles.addCard}
            accessibilityRole="button"
            accessibilityLabel="Record another object"
          >
            <Glyph name="plus" size={26} color="#C4B5FD" />
            <Text style={styles.addText}>Add Object</Text>
          </Pressable>

          {others.map((o) => (
            <View key={o.id} style={[styles.objCard, { borderColor: o.color + '77' }]}>
              <Pressable
                onPress={() => removeObject(o.id)}
                style={styles.objRemove}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${o.label}`}
              >
                <Glyph name="close" size={13} color="#FFFFFF" />
              </Pressable>
              <View style={[styles.objArt, { backgroundColor: o.color + '22' }]}>
                <Glyph name="waveform" size={24} color={o.color} />
              </View>
              <Text style={styles.objLabel} numberOfLines={1}>
                {o.label}
              </Text>
            </View>
          ))}
        </ScrollView>

          </>
        )}

        <GradientButton
          label={arranging ? 'Composing…' : 'Generate My Jam'}
          trailing={arranging ? undefined : '→'}
          busy={arranging}
          onPress={handleGenerate}
          gradient={gradients.brand}
          style={styles.cta}
        />
      </ScrollView>
    </View>
  );
}

/** Starting points, so the box is never a blank page. */
const DIRECTION_SUGGESTIONS = [
  'warm piano',
  'tight drums',
  'make it emotional',
  'more space',
  'add a bassline',
  'like a radio single',
  'slow and dreamy',
  'punchy and danceable',
];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 14 },
  emptyText: { fontSize: 15, color: colors.textDim, fontWeight: '600' },
  emptyBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.6)',
  },
  emptyBtnText: { color: '#E9D5FF', fontWeight: '700' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 10,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(28,33,48,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },

  scroll: { paddingHorizontal: 16, gap: 18 },

  identity: { flexDirection: 'row', gap: 14 },
  art: {
    width: 148,
    height: 168,
    borderRadius: 20,
    borderWidth: 1.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  artBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: 'rgba(8,10,18,0.86)',
  },
  artBadgeText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  identityText: { flex: 1, gap: 7 },
  kicker: { fontSize: 15, fontWeight: '500', color: colors.textDim },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.7,
    padding: 0,
    margin: 0,
  },
  traits: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  trait: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.35)',
  },
  traitText: { fontSize: 12, fontWeight: '600', color: colors.text },
  blurb: { fontSize: 14, color: colors.textDim, lineHeight: 20 },

  tabPanel: { gap: 14 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitleWrap: { gap: 3 },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
  sectionSub: { fontSize: 13, color: colors.textDim },
  optional: { fontSize: 14, fontWeight: '500', color: colors.textFaint },

  player: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.28)',
    backgroundColor: 'rgba(12,15,26,0.9)',
  },
  playBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerWave: { flex: 1 },
  playerTime: { fontSize: 13, fontWeight: '700', color: colors.textDim },

  styleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  styleCard: {
    width: '31.5%',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(120,140,190,0.25)',
    backgroundColor: 'rgba(12,15,26,0.9)',
    padding: 8,
    gap: 7,
    alignItems: 'center',
  },
  styleCardActive: { borderColor: '#A855F7', backgroundColor: 'rgba(30,20,50,0.95)' },
  styleArt: { width: '100%', height: 66, borderRadius: 11 },
  styleLabel: { fontSize: 13, fontWeight: '600', color: colors.textDim },
  styleLabelActive: { color: colors.text, fontWeight: '700' },

  tempoHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bpmReadout: { fontSize: 15, fontWeight: '700', color: colors.text },

  directionBox: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.4)',
    backgroundColor: 'rgba(16,14,30,0.9)',
    padding: 12,
  },
  directionInput: {
    minHeight: 58,
    fontSize: 14,
    color: colors.text,
    textAlignVertical: 'top',
    padding: 0,
  },
  suggestRow: { gap: 8, paddingRight: 8 },
  suggestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.35)',
    backgroundColor: 'rgba(24,20,42,0.85)',
  },
  suggestText: { fontSize: 12.5, fontWeight: '600', color: '#DDD6FE' },

  chipRow: { gap: 10, paddingRight: 8 },
  addCard: {
    width: 104,
    height: 104,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(168,85,247,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  addText: { fontSize: 12.5, fontWeight: '600', color: '#C4B5FD' },
  objCard: {
    width: 104,
    height: 104,
    borderRadius: 16,
    borderWidth: 1.5,
    backgroundColor: 'rgba(12,15,26,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: 8,
  },
  objRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    zIndex: 2,
  },
  objArt: {
    width: 52,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  objLabel: { fontSize: 12.5, fontWeight: '600', color: colors.text },

  cta: { marginTop: 6 },
});
