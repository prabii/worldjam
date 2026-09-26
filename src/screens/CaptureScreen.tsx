import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ARObjectLabel } from '@/components/ARObjectLabel';
import { LatencyBadge } from '@/components/LatencyBadge';
import { Waveform } from '@/components/Waveform';
import { useArTracking } from '@/hooks/useArTracking';
import { describeScene } from '@/audio/guidance';
import { speakNow } from '@/audio/speech';
import { useSession } from '@/state/sessionStore';
import { colors, radius, spacing, type } from '@/theme';
import { WorldCameraView } from '@/vision/components/WorldCameraView';
import { VisionDetectionOverlay } from '@/vision/components/VisionDetectionOverlay';
import { MultiObjectNotice } from '@/vision/components/MultiObjectNotice';
import { useCaptureTarget } from '@/vision/hooks/useCaptureTarget';
import { coverMap } from '@/vision/geometry';
import { multipleObjectsMessage, namingFor, noticeKey } from '@/vision/captureNaming';

/**
 * Capture screen — panels 1 and 2 of the product mockups.
 *
 * Record-first: point at a thing, hold to record, strike it, then name it.
 * There is deliberately no list of preset object types, because offering
 * "Mug / Laptop / Keys" before any audio exists reads as though the app ships
 * with those instruments — the opposite of the product's promise that every
 * sound is one you recorded.
 *
 * On-device detection (modules/worldjam-vision, capture mode) finds the object
 * closest to the camera -- or the one the user taps -- and names the capture
 * after it; the naming popup opens pre-filled so the name can be kept or edited.
 */
export function CaptureScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const { hasPermission, requestPermission } = useCameraPermission();
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [frameAspect, setFrameAspect] = useState(9 / 16);

  /**
   * Set after a capture (or from the edit button), while the user names it.
   * `detected` is the name vision suggested, shown so the user knows its source.
   */
  const [naming, setNaming] = useState<{ id: string; detected: string | null; rename: boolean } | null>(null);
  const [nameDraft, setNameDraft] = useState('');

  // Closest-object detection for naming captures.
  const vision = useCaptureTarget(true);
  const captureNaming = useRef(namingFor(null));

  // Where the next capture anchors — set by tapping the camera view.
  const nextSpot = useRef<{ x: number; y: number } | null>(null);
  const [marker, setMarker] = useState<{ x: number; y: number } | null>(null);

  const objects = useSession((s) => s.objects);
  const pcmBySlot = useSession((s) => s.pcmBySlot);
  const recording = useSession((s) => s.recording);
  const statusMessage = useSession((s) => s.statusMessage);
  const beginCapture = useSession((s) => s.beginCapture);
  const finishCapture = useSession((s) => s.finishCapture);
  const playObject = useSession((s) => s.playObject);
  const removeObject = useSession((s) => s.removeObject);
  const moveObject = useSession((s) => s.moveObject);
  const renameObject = useSession((s) => s.renameObject);
  const guidanceOn = useSession((s) => s.guidanceOn);
  const setGuidance = useSession((s) => s.setGuidance);

  const ar = useArTracking(hasPermission, stage.width, stage.height);

  const isRecording = recording?.kind === 'object';

  // Recording timer, as in panel 2.
  useEffect(() => {
    if (!isRecording) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - started) / 1000), 100);
    return () => clearInterval(id);
  }, [isRecording]);

  const onStageLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setStage({ width, height });
  }, []);

  const handleStagePress = useCallback(
    (e: { nativeEvent: { locationX: number; locationY: number } }) => {
      if (stage.width === 0 || isRecording) return;
      const x = e.nativeEvent.locationX / stage.width;
      const y = e.nativeEvent.locationY / stage.height;
      nextSpot.current = { x, y };
      setMarker({ x, y });
      // The tapped object becomes the one the next capture is named after.
      const f = coverMap(stage.width, stage.height, frameAspect).pointToFrame(x, y);
      vision.focus(f.x, f.y);
      Haptics.selectionAsync().catch(() => {});
    },
    [stage, isRecording, frameAspect, vision],
  );

  const handleRecordStart = useCallback(() => {
    // Auto-position when nothing was tapped, so recording never blocks on a
    // placement step the user did not know about.
    //
    // The golden-angle spiral spreads successive captures evenly instead of
    // clustering them. An earlier version reused nextSpot.current without
    // clearing it, so every auto-placed object landed on the same point and
    // the labels stacked.
    //
    // Frozen now: once the hand strikes the object it may hide it from the
    // camera, so the name and position come from the moment recording began.
    const target = vision.snapshot();
    const naming = namingFor(target);
    captureNaming.current = naming;

    const n = objects.length;
    const golden = 2.399963; // radians
    const radius = 0.13 + 0.055 * Math.sqrt(n);
    const detectedSpot =
      target?.bbox && stage.width > 0
        ? coverMap(stage.width, stage.height, frameAspect).pointToView(
            target.bbox.x + target.bbox.width / 2,
            target.bbox.y + target.bbox.height / 2,
          )
        : null;
    const spot = nextSpot.current ??
      detectedSpot ?? {
        x: 0.5 + Math.cos(n * golden) * radius,
        y: 0.42 + Math.sin(n * golden) * radius * 0.8,
      };
    nextSpot.current = spot;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    beginCapture({
      kind: 'object',
      // The detected object's name, or 'Object' so the store names it from
      // its sound. Either way the user can keep or edit it afterwards.
      label: naming.label,
      category: naming.category,
      x: spot.x,
      y: spot.y,
    });
  }, [beginCapture, objects.length, vision, stage, frameAspect]);

  const handleRecordStop = useCallback(async () => {
    const spot = nextSpot.current;
    const before = new Set(useSession.getState().objects.map((o) => o.id));

    await finishCapture();

    const added = useSession.getState().objects.find((o) => !before.has(o.id));
    if (added) {
      if (spot && ar.supported && ar.tracking && stage.width > 0) {
        ar.createAnchor(added.id, spot.x * stage.width, spot.y * stage.height);
      }
      // Pre-filled with the detected (or sound-derived) name: Save keeps it,
      // editing renames it.
      const n = captureNaming.current;
      setNameDraft(added.label);
      setNaming({ id: added.id, detected: n.fromDetection ? added.label : null, rename: false });
    }

    nextSpot.current = null;
    setMarker(null);
    vision.clearFocus();
  }, [ar, finishCapture, stage, vision]);

  const commitName = useCallback(() => {
    if (!naming) return;
    const name = nameDraft.trim();
    const current = useSession.getState().objects.find((o) => o.id === naming.id)?.label;
    if (name && name !== current) renameObject(naming.id, name);
    setNaming(null);
    setNameDraft('');
  }, [naming, nameDraft, renameObject]);

  /** Edit button on a captured sound: rename it any time. */
  const openRename = useCallback((id: string, label: string) => {
    setNameDraft(label);
    setNaming({ id, detected: null, rename: true });
  }, []);

  // Several objects in view: a 3 s notice, spoken only when voice guidance is
  // on -- and never while recording, where it would end up in the sample.
  const notice = multipleObjectsMessage(vision.target);
  const key = isRecording || naming ? null : noticeKey(vision.target);
  const spokenKey = useRef<string | null>(null);
  useEffect(() => {
    if (!key || !notice || key === spokenKey.current) return;
    spokenKey.current = key;
    if (guidanceOn) speakNow(notice);
  }, [key, notice, guidanceOn]);

  const lastObject = objects[objects.length - 1];
  const cameraDenied = !hasPermission;
  const target = vision.target;

  return (
    <View style={styles.root}>
      {/* --- camera stage --- */}
      <Pressable style={styles.stage} onPress={handleStagePress} onLayout={onStageLayout}>
        {hasPermission ? (
          <WorldCameraView active onFrameAspect={setFrameAspect} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.noCamera]} />
        )}

        {hasPermission && (
          <VisionDetectionOverlay
            objects={vision.objects}
            frameAspect={frameAspect}
            highlightTrackId={target?.trackId ?? null}
            highlightTag={target?.method === 'tap' ? 'selected' : 'closest'}
            labelMinTop={insets.top + 120}
          />
        )}

        {stage.width > 0 &&
          objects.map((o) => {
            const tracked = ar.anchors.get(o.id);
            if (tracked && !tracked.visible) return null;

            const positioned = tracked
              ? {
                  ...o,
                  position: {
                    x: tracked.screenX / stage.width,
                    y: tracked.screenY / stage.height,
                  },
                }
              : o;

            return (
              <ARObjectLabel
                key={o.id}
                object={positioned}
                pcm={pcmBySlot.get(o.slot) ?? null}
                containerWidth={stage.width}
                containerHeight={stage.height}
                onTrigger={playObject}
                onLongPress={removeObject}
                // A tracked anchor is pinned to the real object; only free
                // labels can be dragged.
                onMove={tracked ? undefined : moveObject}
              />
            );
          })}

        {marker && stage.width > 0 && !isRecording && (
          <View
            pointerEvents="none"
            style={[
              styles.marker,
              { left: marker.x * stage.width - 30, top: marker.y * stage.height - 30 },
            ]}
          >
            <View style={styles.markerRing} />
          </View>
        )}
      </Pressable>

      {/* --- top bar --- */}
      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        <View style={styles.brand}>
          <View style={styles.brandBars}>
            {[10, 16, 12, 18].map((h, i) => (
              <View key={i} style={[styles.brandBar, { height: h }]} />
            ))}
          </View>
          <Text style={styles.brandText}>WorldJam</Text>
        </View>
        <LatencyBadge compact />
      </View>

      {/* --- AR + voice badges --- */}
      <View style={styles.badgeRow} pointerEvents="box-none">
        <View style={styles.badge}>
          <View
            style={[
              styles.badgeDot,
              {
                backgroundColor: ar.tracking
                  ? colors.live
                  : ar.supported
                    ? colors.warn
                    : colors.textFaint,
              },
            ]}
          />
          <Text style={styles.badgeText}>
            {ar.tracking
              ? 'AR locked'
              : ar.supported
                ? 'Move to scan'
                : 'Tap-to-place'}
          </Text>
        </View>

        <Pressable
          onPress={() => setGuidance(!guidanceOn)}
          accessibilityRole="switch"
          accessibilityState={{ checked: guidanceOn }}
          accessibilityLabel="Voice guidance"
          style={[styles.badge, guidanceOn && styles.badgeOn]}
        >
          <Text style={[styles.badgeText, guidanceOn && { color: colors.vibe }]}>
            {guidanceOn ? 'Voice on' : 'Voice off'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.noticeRow} pointerEvents="none">
        <MultiObjectNotice message={notice} noticeKey={key} />
      </View>

      {cameraDenied && (
        <Pressable onPress={requestPermission} style={styles.permission}>
          <Text style={styles.permissionText}>
            Camera off — tap to enable. Recording still works without it.
          </Text>
        </Pressable>
      )}

      <View style={styles.spacer} />

      {/* --- recording panel (mockup panel 2) --- */}
      <View style={[styles.recordPanel, { paddingBottom: insets.bottom + spacing.lg }]}>
        {isRecording ? (
          <>
            <LiveWaveform />
            <Text style={styles.timer}>{elapsed.toFixed(1)}s</Text>
            <Text style={styles.recordHint}>Recording real sound…</Text>
          </>
        ) : lastObject ? (
          <Pressable
            onPress={() => playObject(lastObject.id)}
            accessibilityRole="button"
            accessibilityLabel={`Play ${lastObject.label}`}
            style={styles.capturedCard}
          >
            <Text style={styles.capturedTitle}>Captured!</Text>
            <View style={styles.capturedRow}>
              <Waveform
                pcm={pcmBySlot.get(lastObject.slot) ?? null}
                width={180}
                height={32}
                color={lastObject.color}
                bars={44}
              />
              <View style={styles.playSmall}>
                <View style={styles.playSmallIcon} />
              </View>
            </View>
            <View style={styles.capturedFooter}>
              <Text style={[styles.capturedSub, { flex: 1 }]}>
                Real sound from your {lastObject.label.toLowerCase()}
              </Text>
              <Pressable
                onPress={() => openRename(lastObject.id, lastObject.label)}
                accessibilityRole="button"
                accessibilityLabel={`Rename ${lastObject.label}`}
                hitSlop={10}
                style={styles.editChip}
              >
                <Text style={styles.editChipText}>✎ Edit name</Text>
              </Pressable>
            </View>
          </Pressable>
        ) : (
          <Text style={styles.recordHint}>
            {target?.spokenLabel
              ? `${target.method === 'tap' ? 'Selected' : 'Closest'}: ${target.spokenLabel} — hold & hit it`
              : marker
                ? 'Placed — now hold to record'
                : 'Point at an object, or tap it'}
          </Text>
        )}
        {!isRecording && lastObject && target?.spokenLabel && (
          <Text style={styles.recordHint}>
            Next: {target.spokenLabel} ({target.method === 'tap' ? 'selected' : 'closest'})
          </Text>
        )}

        <Pressable
          onPressIn={handleRecordStart}
          onPressOut={handleRecordStop}
          accessibilityRole="button"
          accessibilityLabel="Hold to record the object's sound"
          style={[styles.recordButton, isRecording && styles.recordButtonActive]}
        >
          <View style={[styles.recordInner, isRecording && styles.recordInnerActive]} />
        </Pressable>

        <Text style={styles.recordLabel}>
          {isRecording ? 'Hit the object now' : 'Hold & hit'}
        </Text>

        {statusMessage && <Text style={styles.status}>{statusMessage}</Text>}

        {objects.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
          >
            {objects.map((o) => (
              <Pressable
                key={o.id}
                onPress={() => playObject(o.id)}
                onLongPress={() => removeObject(o.id)}
                accessibilityRole="button"
                accessibilityLabel={`Play ${o.label}`}
                style={[styles.stripItem, { borderColor: o.color }]}
              >
                <View style={styles.stripHead}>
                  <Text style={[styles.stripName, { color: o.color }]} numberOfLines={1}>
                    {o.label}
                  </Text>
                  <Pressable
                    onPress={() => openRename(o.id, o.label)}
                    accessibilityRole="button"
                    accessibilityLabel={`Rename ${o.label}`}
                    hitSlop={8}
                  >
                    <Text style={[styles.stripEdit, { color: o.color }]}>✎</Text>
                  </Pressable>
                </View>
                <Waveform
                  pcm={pcmBySlot.get(o.slot) ?? null}
                  width={56}
                  height={16}
                  color={o.color}
                  bars={18}
                />
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View style={styles.actionRow}>
          {guidanceOn && (
            <Pressable
              onPress={() => {
                const positions = new Map(
                  objects.map((o) => {
                    const a = ar.anchors.get(o.id);
                    return [
                      o.id,
                      a
                        ? {
                            x: (a.screenX / Math.max(1, stage.width)) * 4 - 2,
                            y: 0,
                            z: -a.distance,
                          }
                        : { x: o.position.x * 4 - 2, y: 0, z: -1.5 },
                    ] as const;
                  }),
                );
                speakNow(
                  describeScene(
                    objects,
                    positions as Map<string, { x: number; y: number; z: number }>,
                    ar.pose ?? { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
                  ),
                );
              }}
              accessibilityRole="button"
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryText}>What&apos;s around me?</Text>
            </Pressable>
          )}

          <Pressable
            onPress={onDone}
            disabled={objects.length === 0}
            accessibilityRole="button"
            style={[styles.next, objects.length === 0 && styles.nextDisabled]}
          >
            <Text style={[styles.nextText, objects.length === 0 && styles.nextTextDisabled]}>
              {objects.length === 0
                ? 'Record a sound first'
                : `${objects.length} instrument${objects.length === 1 ? '' : 's'} ready →`}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* --- name it, after the sound exists --- */}
      <Modal visible={naming != null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {naming?.rename
                ? 'Rename this sound'
                : naming?.detected
                  ? `Detected: ${naming.detected}`
                  : 'What did you just hit?'}
            </Text>
            <Text style={styles.modalSub}>
              {naming?.detected
                ? 'Named from the camera. Keep it, or edit it if that is not what you hit.'
                : 'Name it so the AI can call it out in the rhythm.'}
            </Text>
            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder="Mug, table, keys…"
              placeholderTextColor={colors.textFaint}
              style={styles.modalInput}
              maxLength={16}
              autoFocus
              onSubmitEditing={commitName}
              accessibilityLabel="Object name"
            />
            <View style={styles.modalButtons}>
              <Pressable
                onPress={() => setNaming(null)}
                accessibilityRole="button"
                accessibilityLabel={naming?.rename ? 'Cancel rename' : 'Keep the current name'}
                style={styles.modalSkip}
              >
                <Text style={styles.modalSkipText}>{naming?.rename ? 'Cancel' : 'Skip'}</Text>
              </Pressable>
              <Pressable
                onPress={commitName}
                accessibilityRole="button"
                accessibilityLabel="Save name"
                style={styles.modalSave}
              >
                <Text style={styles.modalSaveText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * Animated bars during recording.
 *
 * Deliberately not driven by real mic levels: reading the input buffer from JS
 * while the native engine is capturing would mean pulling audio across the
 * bridge 30 times a second, competing with the very capture it is visualising.
 * This is an activity indicator and is honest about being one.
 */
function LiveWaveform() {
  const bars = useRef(Array.from({ length: 28 }, () => new Animated.Value(0.2))).current;

  useEffect(() => {
    const anims = bars.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, {
            toValue: 0.4 + Math.random() * 0.6,
            duration: 180 + (i % 5) * 40,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(v, {
            toValue: 0.15 + Math.random() * 0.2,
            duration: 180 + (i % 7) * 40,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [bars]);

  return (
    <View style={styles.liveWave}>
      {bars.map((v, i) => (
        <Animated.View
          key={i}
          style={[
            styles.liveBar,
            { height: v.interpolate({ inputRange: [0, 1], outputRange: [3, 36] }) },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  stage: { ...StyleSheet.absoluteFillObject },
  noCamera: { backgroundColor: '#0B0D12' },

  marker: { position: 'absolute', width: 60, height: 60 },
  markerRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: colors.accent,
    borderStyle: 'dashed',
  },

  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  brandBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 18 },
  brandBar: { width: 3, borderRadius: 2, backgroundColor: colors.vibe },
  brandText: { ...type.title, color: colors.text },

  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(10,12,16,0.82)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeOn: { borderColor: colors.vibe, backgroundColor: colors.vibeDim },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { ...type.caption, fontSize: 10, color: colors.textDim },

  permission: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  permissionText: { ...type.caption, color: colors.textDim, fontWeight: '500' },

  spacer: { flex: 1 },

  recordPanel: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    backgroundColor: 'rgba(8,9,12,0.88)',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  liveWave: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 40,
  },
  liveBar: { width: 3, borderRadius: 2, backgroundColor: colors.accent },
  timer: { ...type.label, color: colors.accent, fontVariant: ['tabular-nums'] },
  recordHint: { ...type.caption, color: colors.textDim },

  capturedCard: {
    width: '100%',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 6,
  },
  capturedTitle: { ...type.label, color: colors.live },
  capturedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  capturedSub: { ...type.caption, color: colors.textFaint },
  playSmall: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playSmallIcon: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftWidth: 10,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.bg,
  },

  recordButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 3,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  recordButtonActive: { borderColor: colors.accent },
  recordInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.accent },
  recordInnerActive: { width: 28, height: 28, borderRadius: 6 },
  recordLabel: { ...type.label, color: colors.text },
  status: { ...type.caption, color: colors.live, textAlign: 'center' },

  strip: { gap: spacing.sm, paddingVertical: spacing.xs },
  stripItem: {
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.surfaceRaised,
    minWidth: 70,
  },
  stripName: { ...type.caption, fontSize: 10, flexShrink: 1 },
  stripHead: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 96 },
  stripEdit: { fontSize: 13, fontWeight: '800', paddingHorizontal: 2 },
  capturedFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  editChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.vibe,
  },
  editChipText: { ...type.caption, color: colors.vibe, fontWeight: '800' },
  noticeRow: { marginTop: spacing.sm, alignItems: 'center' },

  actionRow: { width: '100%', gap: spacing.sm },
  secondaryButton: {
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.vibe,
    backgroundColor: colors.vibeDim,
  },
  secondaryText: { ...type.label, color: colors.vibe },
  next: {
    width: '100%',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    backgroundColor: colors.vibe,
  },
  nextDisabled: { backgroundColor: colors.surfaceRaised },
  nextText: { ...type.label, color: colors.bg },
  nextTextDisabled: { color: colors.textFaint },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSolid,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  modalTitle: { ...type.title, color: colors.text },
  modalSub: { ...type.caption, color: colors.textDim, fontWeight: '500' },
  modalInput: {
    ...type.body,
    color: colors.text,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bg,
  },
  modalButtons: { flexDirection: 'row', gap: spacing.md },
  modalSkip: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalSkipText: { ...type.label, color: colors.textDim },
  modalSave: {
    flex: 2,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.vibe,
  },
  modalSaveText: { ...type.label, color: colors.bg },
});
