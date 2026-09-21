import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { DetectorCamera } from '@/components/DetectorCamera';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Logo } from '@/components/ui/Logo';
import { StepBar } from '@/components/ui/StepBar';
import { ToolRail, type RailItem } from '@/components/ui/ToolRail';
import { Glyph } from '@/components/ui/Glyph';
import { GradientButton } from '@/components/ui/GradientButton';
import { DetectionOverlay } from '@/components/DetectionOverlay';
import { LiveWaveform } from '@/components/LiveWaveform';
import { useSession } from '@/state/sessionStore';
import { speakNow } from '@/audio/speech';
import { colors, radius } from '@/theme';
import { gradients } from '@/theme/gradients';
import type { Detection } from '@/vision/detector';
import { roleInfoFor } from '@/vision/objectRoles';
import type { ObjectCategory } from '@/types';

interface Props {
  onBack: () => void;
  /** Advances to the studio once at least one object has been captured. */
  onAddToStudio: () => void;
  /** Opens the detail screen for a freshly captured object. */
  onOpenObject?: (id: string) => void;
}

/**
 * Step 1 — Scan.
 *
 * Point the camera at something, the detector names it and says what it will
 * play, then hold to record its real sound. The detection label is a
 * suggestion: the captured audio is what actually decides the role, so an
 * object the model has never seen still works.
 */
export function ScanScreen({ onBack, onAddToStudio, onOpenObject }: Props) {
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [detections, setDetections] = useState<Detection[]>([]);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [torch, setTorch] = useState(false);
  const [aiMode, setAiMode] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [selected, setSelected] = useState<Detection | null>(null);

  const objects = useSession((s) => s.objects);
  const recording = useSession((s) => s.recording);
  const beginCapture = useSession((s) => s.beginCapture);
  const finishCapture = useSession((s) => s.finishCapture);
  const renameObject = useSession((s) => s.renameObject);
  const guidanceOn = useSession((s) => s.guidanceOn);

  const isRecording = recording?.kind === 'object';

  // Recording timer — the "00:03" readout on the capture panel.
  useEffect(() => {
    if (!isRecording) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 100);
    return () => clearInterval(id);
  }, [isRecording]);

  // Announce a new detection for hands-free and blind use. Only the strongest
  // one, and only when it changes, or the speech queue never drains.
  const spokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!guidanceOn || isRecording) return;
    const top = detections[0];
    if (!top || top.category === spokenRef.current) return;
    spokenRef.current = top.category;
    speakNow(`${top.displayName} ahead. ${top.role.display}. Hold to record it.`);
  }, [detections, guidanceOn, isRecording]);

  const startCapture = useCallback(
    (det: Detection | null) => {
      const category: ObjectCategory = det?.category ?? 'unknown';
      const ok = beginCapture({
        kind: 'object',
        category,
        label: det?.displayName ?? 'Object',
        position: det
          ? { x: det.box.x + det.box.width / 2, y: det.box.y + det.box.height / 2 }
          : { x: 0.5, y: 0.5 },
      } as never);
      if (!ok) return;
      setSelected(det);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      if (guidanceOn) speakNow('Recording. Strike the object now.');
    },
    [beginCapture, guidanceOn],
  );

  const stopCapture = useCallback(async () => {
    await finishCapture();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (selected) {
      // Name it after what the camera saw, so the studio shows "Cup" rather
      // than "Object 1" — the label the user was just reading on screen.
      const latest = useSession.getState().objects.at(-1);
      if (latest) renameObject(latest.id, selected.displayName);
    }
    if (guidanceOn) speakNow('Captured.');
  }, [finishCapture, renameObject, selected, guidanceOn]);

  const rail: RailItem[] = useMemo(
    () => [
      { key: 'scan', icon: 'cube', label: 'Scan', active: aiMode },
      { key: 'flash', icon: 'flash', label: 'Flash', active: torch },
      { key: 'flip', icon: 'flip', label: 'Flip' },
      { key: 'gallery', icon: 'gallery', label: 'Gallery', disabled: true },
    ],
    [aiMode, torch],
  );

  const onRail = (key: string) => {
    if (key === 'scan') setAiMode((v) => !v);
    else if (key === 'flash') setTorch((v) => !v);
    else if (key === 'flip') setFacing((f) => (f === 'back' ? 'front' : 'back'));
  };

  const onStage = (e: LayoutChangeEvent) =>
    setStage({
      width: e.nativeEvent.layout.width,
      height: e.nativeEvent.layout.height,
    });

  return (
    <View style={[styles.root, { paddingTop: insets.top + 6 }]}>
      {/* ---- Header ---- */}
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Glyph name="back" size={22} color="#FFFFFF" />
        </Pressable>

        <View style={styles.headerCenter}>
          <Logo size="medium" tagline="studio" glyph={false} />
        </View>

        <Pressable
          onPress={() => setAiMode((v) => !v)}
          style={[styles.aiToggle, aiMode && styles.aiToggleOn]}
          accessibilityRole="switch"
          accessibilityLabel="AI Mode"
          accessibilityState={{ checked: aiMode }}
        >
          <Glyph name="sparkle" size={16} color={aiMode ? '#E9D5FF' : colors.textDim} />
          <Text style={[styles.aiText, !aiMode && { color: colors.textDim }]}>AI Mode</Text>
          <View style={[styles.switchTrack, aiMode && styles.switchTrackOn]}>
            {aiMode ? (
              <LinearGradient
                colors={gradients.brandShort}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <View style={[styles.switchKnob, aiMode && styles.switchKnobOn]} />
          </View>
        </Pressable>
      </View>

      <StepBar current={1} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ---- Viewfinder ---- */}
        <View style={styles.viewfinder} onLayout={onStage}>
          <DetectorCamera
            facing={facing}
            torch={torch}
            // Inference pauses while recording: the capture needs the CPU, and
            // labels cannot change usefully while the phone is held against an
            // object anyway.
            detecting={aiMode && !isRecording}
            onDetections={setDetections}
          />

          {/* Tap anywhere on the feed to capture whatever is under the finger. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPressIn={() => !isRecording && startCapture(detections[0] ?? null)}
            onPressOut={() => isRecording && void stopCapture()}
            accessibilityRole="button"
            accessibilityLabel="Hold anywhere to record the sound in front of you"
          />

          {aiMode && (
            <DetectionOverlay
              detections={detections}
              width={stage.width}
              height={stage.height}
              selectedId={selected?.id ?? null}
              onSelect={(d) => setSelected(d)}
            />
          )}

          <View style={styles.railWrap} pointerEvents="box-none">
            <ToolRail items={rail} onSelect={onRail} />
          </View>

          {/* Script flourish from the artwork. */}
          <View style={styles.flourishWrap} pointerEvents="none">
            <Text style={styles.flourish}>
              Real{'\n'}Objects{'\n'}Real{'\n'}Music
            </Text>
          </View>

          <View style={styles.hintWrap} pointerEvents="none">
            <View style={styles.hint}>
              <Glyph name="target" size={16} color="#FFFFFF" />
              <Text style={styles.hintText}>
                {isRecording
                  ? 'Strike the object now'
                  : detections.length > 0
                    ? `Hold to record the ${detections[0].displayName.toLowerCase()}`
                    : 'Point at something and hold to record it'}
              </Text>
            </View>
          </View>
        </View>

        {/* ---- Capture panel ---- */}
        <View style={styles.captureRow}>
          <View style={styles.wavePanel}>
            <LiveWaveform active={isRecording} />
            <View style={styles.waveFooter}>
              <View style={styles.waveStatus}>
                <View style={[styles.dot, isRecording && styles.dotLive]} />
                <Text style={styles.waveText}>
                  {isRecording ? 'Capturing Sound…' : 'Hold to capture'}
                </Text>
              </View>
              <Text style={styles.waveTime}>{formatClock(elapsed)}</Text>
            </View>
          </View>

          <View style={styles.stopWrap}>
            <Pressable
              onPressIn={() => !isRecording && startCapture(detections[0] ?? null)}
              onPressOut={() => isRecording && void stopCapture()}
              accessibilityRole="button"
              accessibilityLabel={isRecording ? 'Stop recording' : 'Hold to record'}
            >
              <RecordOrb recording={isRecording} />
            </Pressable>
            <Text style={styles.stopLabel}>{isRecording ? 'Stop' : 'Hold'}</Text>
          </View>
        </View>

        {/* ---- Detected / captured objects ---- */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>
            {objects.length > 0 ? 'Your Objects' : 'Detected Objects'}
          </Text>
          <Pressable
            style={styles.addManual}
            onPress={() => startCapture(null)}
            accessibilityRole="button"
            accessibilityLabel="Add an object manually"
          >
            <Text style={styles.addManualText}>Add Manually</Text>
            <Glyph name="plus" size={14} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {objects.length === 0 && detections.length === 0 && (
            <View style={styles.emptyChip}>
              <Text style={styles.emptyChipText}>
                Nothing captured yet — hold the button and tap something.
              </Text>
            </View>
          )}

          {/* Captured objects first: these are real, with real audio. */}
          {objects.map((o) => (
            <Pressable
              key={o.id}
              style={[styles.chip, { borderColor: o.color }]}
              onPress={() => onOpenObject?.(o.id)}
              accessibilityRole="button"
              accessibilityLabel={`${o.label}, ${roleInfoFor(o.category).display}. Open details.`}
            >
              <View style={[styles.chipArt, { backgroundColor: o.color + '22' }]}>
                <Glyph name="waveform" size={26} color={o.color} />
              </View>
              <Text style={styles.chipTitle}>{o.label}</Text>
              <Text style={styles.chipRole}>{roleInfoFor(o.category).display}</Text>
            </Pressable>
          ))}

          {/* Live detections that have not been captured yet, shown dimmer. */}
          {detections.map((d: Detection) => (
            <Pressable
              key={d.id}
              style={[styles.chip, styles.chipGhost, { borderColor: d.role.color + '55' }]}
              onPress={() => setSelected(d)}
              accessibilityRole="button"
              accessibilityLabel={`${d.displayName} detected, not captured. ${d.role.display}.`}
            >
              <View style={[styles.chipArt, { backgroundColor: d.role.color + '18' }]}>
                <Glyph name="scan" size={24} color={d.role.color} />
              </View>
              <Text style={[styles.chipTitle, styles.chipTitleGhost]}>{d.displayName}</Text>
              <Text style={styles.chipRole}>{d.role.display}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <GradientButton
          label="Add to Studio"
          trailing="→"
          onPress={onAddToStudio}
          disabled={objects.length === 0}
          style={styles.cta}
          accessibilityLabel={
            objects.length === 0
              ? 'Add to Studio. Record at least one object first.'
              : `Add to Studio with ${objects.length} object${objects.length === 1 ? '' : 's'}`
          }
        />
      </ScrollView>
    </View>
  );
}

/** The gradient record/stop orb. Pulses while recording. */
function RecordOrb({ recording }: { recording: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!recording) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [recording, pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <LinearGradient
        colors={recording ? ['#F43F5E', '#A855F7'] : gradients.brand}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={orbStyles.orb}
      >
        <View style={recording ? orbStyles.square : orbStyles.circle} />
      </LinearGradient>
    </Animated.View>
  );
}

const orbStyles = StyleSheet.create({
  orb: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: 'center',
    justifyContent: 'center',
  },
  square: { width: 26, height: 26, borderRadius: 6, backgroundColor: '#FFFFFF' },
  circle: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFFFFF' },
});

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
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(28,33,48,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  aiToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(24,20,42,0.9)',
  },
  aiToggleOn: { borderColor: 'rgba(168,85,247,0.6)' },
  aiText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  switchTrack: {
    width: 34,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(120,140,190,0.3)',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  switchTrackOn: {},
  switchKnob: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    marginLeft: 2,
  },
  switchKnobOn: { marginLeft: 16 },

  scroll: { paddingHorizontal: 16, gap: 16 },

  viewfinder: {
    height: 420,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.28)',
    backgroundColor: '#0B0E16',
  },
  railWrap: { position: 'absolute', left: 12, top: 16 },
  flourishWrap: { position: 'absolute', right: 14, top: 150 },
  flourish: {
    fontSize: 21,
    lineHeight: 26,
    color: 'rgba(255,255,255,0.92)',
    fontStyle: 'italic',
    textAlign: 'center',
    fontWeight: '500',
  },
  hintWrap: { position: 'absolute', left: 0, right: 0, bottom: 16, alignItems: 'center' },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: 'rgba(10,13,22,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  hintText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },

  captureRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  wavePanel: {
    flex: 1,
    height: 118,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.45)',
    backgroundColor: 'rgba(12,15,26,0.92)',
    padding: 12,
    justifyContent: 'space-between',
  },
  waveFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  waveStatus: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: 'rgba(120,140,190,0.5)' },
  dotLive: { backgroundColor: '#EC4899' },
  waveText: { fontSize: 13, fontWeight: '600', color: colors.text },
  waveTime: { fontSize: 13, fontWeight: '700', color: colors.textDim },
  stopWrap: { alignItems: 'center', gap: 6 },
  stopLabel: { fontSize: 13, fontWeight: '600', color: colors.text },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 19, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
  addManual: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  addManualText: { fontSize: 13, fontWeight: '600', color: colors.text },

  chipRow: { gap: 10, paddingVertical: 2, paddingRight: 8 },
  chip: {
    width: 116,
    padding: 10,
    borderRadius: 18,
    borderWidth: 1.5,
    backgroundColor: 'rgba(14,17,28,0.92)',
    alignItems: 'center',
    gap: 4,
  },
  chipGhost: { opacity: 0.72 },
  chipArt: {
    width: 92,
    height: 68,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  chipTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  chipTitleGhost: { color: 'rgba(244,245,247,0.8)' },
  chipRole: { fontSize: 12, fontWeight: '500', color: colors.textDim },
  emptyChip: {
    width: 250,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
  },
  emptyChipText: { fontSize: 13, color: colors.textDim, lineHeight: 19 },

  cta: { marginTop: 4 },
});
