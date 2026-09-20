import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ARObjectLabel } from '@/components/ARObjectLabel';
import { CaptureButton } from '@/components/CaptureButton';
import { LatencyBadge } from '@/components/LatencyBadge';
import { ObjectIcon } from '@/components/ObjectIcon';
import { Waveform } from '@/components/Waveform';
import { useArTracking } from '@/hooks/useArTracking';
import { describeScene } from '@/audio/guidance';
import { speakNow } from '@/audio/speech';
import { useSession } from '@/state/sessionStore';
import type { ObjectCategory } from '@/types';
import { colors, radius, spacing, type } from '@/theme';

/**
 * Quick-pick object types, matching the objects shown in the mockups.
 *
 * Object *detection* is explicitly cosmetic per HLD v2 §2 — "you do not need
 * AI to know it is a mug to sample its sound" — so this is a picker plus free
 * text, not a classifier. It costs nothing and never misidentifies anything.
 */
const SUGGESTIONS: Array<{ label: string; category: ObjectCategory }> = [
  { label: 'Mug', category: 'cup' },
  { label: 'Table', category: 'table' },
  { label: 'Keys', category: 'keys' },
  { label: 'Bottle', category: 'bottle' },
  { label: 'Laptop', category: 'laptop' },
  { label: 'Plant', category: 'plant' },
  { label: 'Glass', category: 'glass' },
  { label: 'Clap', category: 'clap' },
];

export function CaptureScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [label, setLabel] = useState('Mug');
  const [category, setCategory] = useState<ObjectCategory>('cup');
  const [cameraOn, setCameraOn] = useState(true);
  const [stage, setStage] = useState({ width: 0, height: 0 });

  // Where the next capture anchors. Set by tapping the camera view, so
  // objects land where the user pointed rather than in a preset grid.
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
  const guidanceOn = useSession((s) => s.guidanceOn);
  const setGuidance = useSession((s) => s.setGuidance);

  const usedLabels = useMemo(
    () => new Set(objects.map((o) => o.label.toLowerCase())),
    [objects],
  );

  // AR runs only while the camera is showing; there is nothing to anchor to
  // otherwise, and an idle ARCore session costs battery and CPU.
  const ar = useArTracking(cameraOn && !!permission?.granted, stage.width, stage.height);

  const onStageLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setStage({ width, height });
  }, []);

  const handleStagePress = useCallback(
    (e: { nativeEvent: { locationX: number; locationY: number } }) => {
      if (stage.width === 0) return;
      const x = e.nativeEvent.locationX / stage.width;
      const y = e.nativeEvent.locationY / stage.height;
      nextSpot.current = { x, y };
      setMarker({ x, y });
    },
    [stage],
  );

  const handleStart = useCallback(() => {
    const trimmed = label.trim() || 'Object';

    // Duplicate labels would make the AI's object references ambiguous, so
    // disambiguate rather than reject the capture.
    let finalLabel = trimmed;
    let n = 2;
    while (usedLabels.has(finalLabel.toLowerCase())) {
      finalLabel = `${trimmed} ${n++}`;
    }

    // Fall back to a spread position when nothing was tapped.
    const spot = nextSpot.current ?? {
      x: 0.2 + ((objects.length * 0.27) % 0.6),
      y: 0.25 + ((objects.length * 0.19) % 0.45),
    };

    beginCapture({ kind: 'object', label: finalLabel, category, x: spot.x, y: spot.y });
  }, [beginCapture, category, label, objects.length, usedLabels]);

  const handleFinish = useCallback(async () => {
    const spot = nextSpot.current;
    const before = new Set(useSession.getState().objects.map((o) => o.id));

    await finishCapture();

    // Anchor the newly captured object to the real-world point that was
    // tapped, so it stays on the physical object as the phone moves.
    if (spot && ar.supported && ar.tracking && stage.width > 0) {
      const added = useSession
        .getState()
        .objects.find((o) => !before.has(o.id));
      if (added) {
        ar.createAnchor(added.id, spot.x * stage.width, spot.y * stage.height);
      }
    }

    nextSpot.current = null;
    setMarker(null);
  }, [ar, finishCapture, stage]);

  const isRecording = recording?.kind === 'object';
  const cameraDenied = permission != null && !permission.granted;

  return (
    <View style={styles.root}>
      {/* --- camera stage with AR anchors --- */}
      <Pressable style={styles.stage} onPress={handleStagePress} onLayout={onStageLayout}>
        {cameraOn && permission?.granted ? (
          <CameraView style={StyleSheet.absoluteFill} facing="back" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.noCamera]} />
        )}

        {/* Only a light scrim: the mockups let the room show through. */}
        <View style={[StyleSheet.absoluteFill, styles.scrim]} pointerEvents="none" />

        {stage.width > 0 &&
          objects.map((o) => {
            // When ARCore is tracking this object, its screen position comes
            // from the world anchor rather than the stored 2D spot, so the
            // label stays on the physical object.
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
              />
            );
          })}

        {marker && stage.width > 0 && (
          <View
            pointerEvents="none"
            style={[
              styles.marker,
              {
                left: marker.x * stage.width - 26,
                top: marker.y * stage.height - 26,
              },
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

      {/* --- AR + guidance status --- */}
      <View style={styles.badgeRow} pointerEvents="box-none">
        <View style={styles.arBadge}>
          <View
            style={[
              styles.arDot,
              {
                backgroundColor: ar.tracking
                  ? colors.live
                  : ar.supported
                    ? colors.warn
                    : colors.textFaint,
              },
            ]}
          />
          <Text style={styles.arText}>
            {ar.tracking
              ? 'AR locked'
              : ar.supported
                ? 'Move phone to scan'
                : '2D mode'}
          </Text>
        </View>

        <Pressable
          onPress={() => setGuidance(!guidanceOn)}
          accessibilityRole="switch"
          accessibilityState={{ checked: guidanceOn }}
          accessibilityLabel="Voice guidance"
          style={[styles.arBadge, guidanceOn && styles.arBadgeOn]}
        >
          <Text style={[styles.arText, guidanceOn && { color: colors.vibe }]}>
            {guidanceOn ? '🔊 Voice on' : '🔈 Voice off'}
          </Text>
        </Pressable>
      </View>

      {/* --- status line --- */}
      <View style={styles.statusWrap} pointerEvents="none">
        <View style={styles.statusPill}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isRecording ? colors.accent : colors.live },
            ]}
          />
          <Text style={styles.statusText}>
            {isRecording
              ? 'Recording real sound…'
              : statusMessage ??
                (objects.length === 0
                  ? 'Tap where the object is, then hold & hit it'
                  : `${objects.length} instrument${objects.length === 1 ? '' : 's'} ready`)}
          </Text>
        </View>
      </View>

      {cameraDenied && (
        <Pressable onPress={requestPermission} style={styles.permission}>
          <Text style={styles.permissionText}>
            Camera off — tap to enable. Capture still works without it.
          </Text>
        </Pressable>
      )}

      {/* --- bottom sheet --- */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.picker}
        >
          {SUGGESTIONS.map((s) => {
            const active = label === s.label;
            return (
              <Pressable
                key={s.label}
                onPress={() => {
                  setLabel(s.label);
                  setCategory(s.category);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.pick, active && styles.pickActive]}
              >
                <ObjectIcon
                  category={s.category}
                  color={active ? colors.vibe : colors.textDim}
                  size={20}
                />
                <Text style={[styles.pickText, active && styles.pickTextActive]}>
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.controls}>
          <TextInput
            value={label}
            onChangeText={(t) => {
              setLabel(t);
              setCategory('unknown');
            }}
            placeholder="Name it"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            maxLength={14}
            accessibilityLabel="Object name"
          />

          <CaptureButton
            recording={isRecording}
            label="Hold & hit"
            hint={marker ? 'placed — now hit it' : 'tap the view first'}
            onStart={handleStart}
            onStop={handleFinish}
          />

          <Pressable
            onPress={onDone}
            disabled={objects.length === 0}
            accessibilityRole="button"
            style={[styles.next, objects.length === 0 && styles.nextDisabled]}
          >
            <Text style={[styles.nextText, objects.length === 0 && styles.nextTextDisabled]}>
              Jam →
            </Text>
          </Pressable>
        </View>

        {/* Captured strip — panel 2's "Captured!" confirmation. */}
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
                <ObjectIcon category={o.category} color={o.color} size={16} />
                <Waveform
                  pcm={pcmBySlot.get(o.slot) ?? null}
                  width={52}
                  height={18}
                  color={o.color}
                  bars={16}
                />
              </Pressable>
            ))}
          </ScrollView>
        )}

        {guidanceOn && (
          <Pressable
            onPress={() => {
              // Screen-space positions stand in for world coordinates when AR
              // is not tracking: direction is still broadly right, which is
              // what the description needs.
              const positions = new Map(
                objects.map((o) => {
                  const a = ar.anchors.get(o.id);
                  return [
                    o.id,
                    a
                      ? { x: a.screenX / Math.max(1, stage.width) * 4 - 2, y: 0, z: -a.distance }
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
            accessibilityLabel="Describe what is around me"
            style={styles.describeButton}
          >
            <Text style={styles.describeText}>What's around me?</Text>
          </Pressable>
        )}

        <Pressable onPress={() => setCameraOn((v) => !v)} style={styles.cameraToggle}>
          <Text style={styles.cameraToggleText}>
            {cameraOn ? 'Hide camera' : 'Show camera'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  stage: { ...StyleSheet.absoluteFillObject },
  noCamera: { backgroundColor: '#0B0D12' },
  scrim: { backgroundColor: 'rgba(8,9,12,0.25)' },

  marker: { position: 'absolute', width: 52, height: 52 },
  markerRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.vibe,
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
  arBadge: {
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
  arBadgeOn: { borderColor: colors.vibe, backgroundColor: colors.vibeDim },
  arDot: { width: 6, height: 6, borderRadius: 3 },
  arText: { ...type.caption, fontSize: 10, color: colors.textDim },
  statusWrap: { alignItems: 'center', marginTop: spacing.md },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(10,12,16,0.82)',
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: '90%',
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { ...type.caption, color: colors.text, fontWeight: '600' },

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

  sheet: {
    marginTop: 'auto',
    gap: spacing.md,
    paddingTop: spacing.lg,
    backgroundColor: 'rgba(8,9,12,0.92)',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  picker: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  pick: {
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 62,
  },
  pickActive: { borderColor: colors.vibe, backgroundColor: colors.vibeDim },
  pickText: { ...type.caption, fontSize: 10, color: colors.textDim },
  pickTextActive: { color: colors.vibe },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  input: {
    width: 88,
    ...type.body,
    color: colors.text,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  next: {
    width: 88,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    backgroundColor: colors.vibe,
  },
  nextDisabled: { backgroundColor: colors.surfaceRaised },
  nextText: { ...type.label, color: colors.bg },
  nextTextDisabled: { color: colors.textFaint },

  strip: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  stripItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.surfaceRaised,
  },

  describeButton: {
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.vibe,
    backgroundColor: colors.vibeDim,
  },
  describeText: { ...type.label, color: colors.vibe },
  cameraToggle: { alignSelf: 'center' },
  cameraToggleText: { ...type.caption, color: colors.textFaint },
});
