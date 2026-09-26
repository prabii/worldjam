import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { WorldVision, type VisionDiagnostics } from '../../../modules/worldjam-vision/src';
import { colors } from '@/theme';

interface Props {
  visible: boolean;
  diagnostics: VisionDiagnostics | null;
  gemmaEnabled: boolean;
  onGemmaChange: (v: boolean) => void;
  onClose: () => void;
}

const fmt = (v: unknown, digits = 1): string => {
  if (v == null) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(digits);
  if (typeof v === 'boolean') return v ? 'YES' : 'NO';
  return String(v);
};

/** Developer-only. Every number here is measured on this device, live. */
export function VisionDiagnosticsPanel({ visible, diagnostics: d, gemmaEnabled, onGemmaChange, onClose }: Props) {
  const rows: Array<[string, unknown, number?]> = d
    ? [
        ['Model', d.model],
        ['Backend', d.backend],
        ['Execution', d.execution],
        ['Input', d.input],
        ['Inference p50 (ms)', d.inferenceMsP50],
        ['Inference p95 (ms)', d.inferenceMsP95],
        ['Preprocess p50 (ms)', d.preprocessMsP50],
        ['Postprocess p50 (ms)', d.postprocessMsP50],
        ['Tracking p50 (ms)', d.trackingMsP50],
        ['Total p50 (ms)', d.totalMsP50],
        ['Total p95 (ms)', d.totalMsP95],
        ['FPS (target)', `${fmt(d.fps)} (${fmt(d.targetFps)})`],
        ['Frames processed', d.framesProcessed],
        ['Dropped (busy)', d.framesDropped],
        ['Throttled', d.framesThrottled],
        ['Raw detections', d.rawDetections],
        ['Primary', d.primary],
        ['Confidence', d.confidence, 2],
        ['Area score', d.areaScore, 2],
        ['Center score', d.centerScore, 2],
        ['Priority score', d.priorityScore, 2],
        ['Object count', d.objectCount],
        ['Multiple', d.multiple],
        ['Direction', d.direction],
        ['Readout', d.readoutEnabled ? 'ON' : 'OFF'],
        ['TTS latency p50 (ms)', d.ttsLatencyMsP50],
        ['Init', d.backendNotes],
      ]
    : [];
  const fallbacks = (d?.fallbackReasons as string[] | undefined) ?? [];
  const candidates = (d?.candidates as Array<Record<string, unknown>> | undefined) ?? [];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Vision diagnostics</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close diagnostics" style={styles.close}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            {!d && <Text style={styles.dim}>Waiting for data…</Text>}
            {rows.map(([k, v, digits]) => (
              <View key={k} style={styles.row}>
                <Text style={styles.key}>{k}</Text>
                <Text style={styles.val}>{fmt(v, digits ?? 1)}</Text>
              </View>
            ))}
            {candidates.length > 0 && <Text style={styles.section}>Candidates (priority)</Text>}
            {candidates.map((c) => (
              <Text key={String(c.trackId)} style={styles.mono}>
                {String(c.label)} {String(c.trackId)} conf {fmt(c.confidence, 2)} area {fmt(c.areaScore, 2)} ctr{' '}
                {fmt(c.centerScore, 2)} → {fmt(c.priority, 2)}
              </Text>
            ))}
            {fallbacks.length > 0 && <Text style={styles.section}>Backend fallbacks</Text>}
            {fallbacks.map((f) => (
              <Text key={f} style={styles.mono}>
                {f}
              </Text>
            ))}
            <View style={[styles.row, { marginTop: 16 }]}>
              <Text style={styles.key}>Gemma phrasing (optional)</Text>
              <Switch value={gemmaEnabled} onValueChange={onGemmaChange} accessibilityLabel="Gemma phrasing" />
            </View>
            <Pressable onPress={() => WorldVision.resetDiagnostics()} accessibilityRole="button" style={styles.reset}>
              <Text style={styles.closeText}>Reset counters</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  card: {
    maxHeight: '80%',
    backgroundColor: '#12151C',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  close: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#232836' },
  closeText: { color: colors.text, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  key: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  val: { color: colors.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  section: { color: colors.vibe, fontWeight: '800', marginTop: 12, marginBottom: 4 },
  mono: { color: colors.textDim, fontSize: 11, fontFamily: 'monospace', marginBottom: 2 },
  dim: { color: colors.textDim },
  reset: { marginTop: 12, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#232836' },
});
