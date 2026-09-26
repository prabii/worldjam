import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getGemmaRuntime } from '@/ai/gemma';
import { colors } from '@/theme';
import { WorldCameraView } from '../components/WorldCameraView';
import { VisionDetectionOverlay } from '../components/VisionDetectionOverlay';
import { AudioReadoutToggle, RepeatReadoutButton } from '../components/ReadoutControls';
import { VisionDiagnosticsPanel } from '../components/VisionDiagnosticsPanel';
import { useWorldVision } from '../hooks/useWorldVision';

/**
 * Object Guide — audio-first object awareness.
 *
 * Live camera → on-device YOLO26n → one primary object → spoken once. The
 * speaker button repeats the latest description at any time; the toggle
 * silences automatic announcements without losing them.
 */
export function VisionScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [showDiag, setShowDiag] = useState(false);
  const [frameAspect, setFrameAspect] = useState(9 / 16);
  const onFrameAspect = useCallback((a: number) => setFrameAspect(a), []);

  const v = useWorldVision({
    active: true,
    gemmaRuntime: getGemmaRuntime,
    diagnosticsEnabled: showDiag,
  });

  const primary = v.state.primaryObject;
  const others = Math.max(0, v.state.objectCount - 1);
  const backendLabel =
    v.status.status === 'ready'
      ? `On-device · ${v.status.execution === 'HTP' ? 'NPU' : v.status.execution ?? ''}`
      : v.status.status === 'error'
        ? 'Detector unavailable'
        : 'Loading detector…';

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        <WorldCameraView active onFrameAspect={onFrameAspect} />
        <VisionDetectionOverlay objects={v.state.objects} frameAspect={frameAspect} labelMinTop={insets.top + 64} />
        <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back to home"
            style={styles.back}
          >
            <Text style={styles.backText}>‹ Home</Text>
          </Pressable>
          <Pressable
            onLongPress={() => setShowDiag(true)}
            accessibilityRole="text"
            accessibilityLabel={`Detector status: ${backendLabel}`}
            accessibilityHint="Long press to open developer diagnostics"
            style={styles.status}
          >
            <View
              style={[
                styles.dot,
                { backgroundColor: v.status.status === 'ready' ? colors.live : v.status.status === 'error' ? colors.accent : colors.textDim },
              ]}
            />
            <Text style={styles.statusText}>{backendLabel}</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.kicker}>WORLDJAM · OBJECT GUIDE</Text>
        <Text style={styles.current} accessibilityRole="header">
          {primary ? `Current object: ${primary.spokenLabel}` : 'Point the camera at an object'}
        </Text>
        <Text style={styles.sub}>
          {primary
            ? `${v.state.direction === 'left' ? 'On your left' : v.state.direction === 'right' ? 'On your right' : 'Ahead'} · ${
                others === 0 ? 'No other objects' : `${others} more object${others === 1 ? '' : 's'}`
              }`
            : v.status.status === 'error'
              ? v.status.error ?? 'Detector could not start.'
              : 'Nothing detected yet.'}
        </Text>
        {v.latest && (
          <Text style={styles.last} numberOfLines={2}>
            Last read-out: “{v.latest.text}”
          </Text>
        )}
        <RepeatReadoutButton onPress={v.repeat} />
        <AudioReadoutToggle value={v.readoutEnabled} onChange={v.setReadoutEnabled} />
      </View>

      <VisionDiagnosticsPanel
        visible={showDiag}
        diagnostics={v.diagnostics}
        gemmaEnabled={v.gemmaEnabled}
        onGemmaChange={v.setGemmaEnabled}
        onClose={() => setShowDiag(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  stage: { flex: 1, overflow: 'hidden' },
  top: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  back: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 24,
    backgroundColor: 'rgba(8,9,12,0.75)',
  },
  backText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(8,9,12,0.75)',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  panel: {
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    backgroundColor: '#0D0F14',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  kicker: { color: colors.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  current: { color: colors.text, fontSize: 24, fontWeight: '800' },
  sub: { color: colors.textDim, fontSize: 15, fontWeight: '600' },
  last: { color: colors.textDim, fontSize: 13, fontStyle: 'italic' },
});
