import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaptureButton } from '@/components/CaptureButton';
import { LatencyBadge } from '@/components/LatencyBadge';
import { SoundObjectCard } from '@/components/SoundObjectCard';
import { useSession } from '@/state/sessionStore';
import type { ObjectCategory } from '@/types';
import { colors, radius, spacing, type } from '@/theme';

/**
 * Suggested labels. Object *detection* is explicitly cosmetic per HLD v2 §2 —
 * "you do not need AI to know it is a mug to sample its sound" — so this is a
 * quick-pick list plus free text, not a classifier.
 */
const SUGGESTIONS: Array<{ label: string; category: ObjectCategory }> = [
  { label: 'Cup', category: 'cup' },
  { label: 'Table', category: 'table' },
  { label: 'Bottle', category: 'bottle' },
  { label: 'Keys', category: 'keys' },
  { label: 'Glass', category: 'glass' },
  { label: 'Box', category: 'box' },
  { label: 'Book', category: 'book' },
  { label: 'Phone', category: 'phone' },
];

export function CaptureScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [label, setLabel] = useState('Cup');
  const [category, setCategory] = useState<ObjectCategory>('cup');
  const [cameraOn, setCameraOn] = useState(true);

  const objects = useSession((s) => s.objects);
  const recording = useSession((s) => s.recording);
  const statusMessage = useSession((s) => s.statusMessage);
  const beginCapture = useSession((s) => s.beginCapture);
  const finishCapture = useSession((s) => s.finishCapture);
  const playObject = useSession((s) => s.playObject);
  const removeObject = useSession((s) => s.removeObject);

  const usedLabels = useMemo(
    () => new Set(objects.map((o) => o.label.toLowerCase())),
    [objects],
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
    beginCapture({
      kind: 'object',
      label: finalLabel,
      category,
      // Spread captures across the stereo field as they are added.
      x: 0.15 + ((objects.length * 0.23) % 0.7),
      y: 0.3 + ((objects.length * 0.17) % 0.4),
    });
  }, [beginCapture, category, label, objects.length, usedLabels]);

  const cameraDenied = permission != null && !permission.granted;

  return (
    <View style={styles.root}>
      {cameraOn && permission?.granted ? (
        <CameraView style={StyleSheet.absoluteFill} facing="back" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.noCamera]} />
      )}

      <View style={[StyleSheet.absoluteFill, styles.scrim]} pointerEvents="none" />

      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
        <View>
          <Text style={styles.title}>Capture</Text>
          <Text style={styles.subtitle}>
            {objects.length === 0
              ? 'Hold the button and hit the object'
              : `${objects.length} sound${objects.length === 1 ? '' : 's'} captured`}
          </Text>
        </View>
        <LatencyBadge compact />
      </View>

      {cameraDenied && (
        <Pressable onPress={requestPermission} style={styles.permission}>
          <Text style={styles.permissionText}>
            Camera off — tap to enable. Capture still works without it.
          </Text>
        </Pressable>
      )}

      <View style={styles.spacer} />

      {objects.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cards}
        >
          {objects.map((o) => (
            <SoundObjectCard
              key={o.id}
              object={o}
              beatPulse={0}
              onTrigger={playObject}
              onLongPress={removeObject}
            />
          ))}
        </ScrollView>
      )}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.lg }]}>
        {statusMessage && <Text style={styles.status}>{statusMessage}</Text>}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.suggestions}
        >
          {SUGGESTIONS.map((s) => (
            <Pressable
              key={s.label}
              onPress={() => {
                setLabel(s.label);
                setCategory(s.category);
              }}
              style={[styles.suggestion, label === s.label && styles.suggestionActive]}
            >
              <Text
                style={[styles.suggestionText, label === s.label && styles.suggestionTextActive]}
              >
                {s.label}
              </Text>
            </Pressable>
          ))}
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
            maxLength={16}
            accessibilityLabel="Object name"
          />

          <CaptureButton
            recording={recording?.kind === 'object'}
            label="Hold & hit"
            hint="tap the object while holding"
            onStart={handleStart}
            onStop={finishCapture}
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
  noCamera: { backgroundColor: '#0B0D12' },
  scrim: { backgroundColor: 'rgba(8,9,12,0.55)' },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { ...type.display, color: colors.text },
  subtitle: { ...type.body, color: colors.textDim },
  permission: {
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  permissionText: { ...type.caption, color: colors.textDim, fontWeight: '500' },
  spacer: { flex: 1 },
  cards: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  bottom: {
    gap: spacing.md,
    paddingTop: spacing.lg,
    backgroundColor: 'rgba(8,9,12,0.82)',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  status: {
    ...type.label,
    color: colors.live,
    textAlign: 'center',
  },
  suggestions: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  suggestion: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  suggestionActive: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  suggestionText: { ...type.caption, color: colors.textDim },
  suggestionTextActive: { color: colors.accent },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  input: {
    width: 90,
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
    width: 90,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    backgroundColor: colors.accent,
  },
  nextDisabled: { backgroundColor: colors.surfaceRaised },
  nextText: { ...type.label, color: colors.bg },
  nextTextDisabled: { color: colors.textFaint },
  cameraToggle: { alignSelf: 'center' },
  cameraToggleText: { ...type.caption, color: colors.textFaint },
});
