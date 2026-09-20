import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaptureButton } from '@/components/CaptureButton';
import { LatencyBadge } from '@/components/LatencyBadge';
import { QuantizePanel } from '@/components/QuantizePanel';
import { RhythmGuide } from '@/components/RhythmGuide';
import { SoundObjectCard } from '@/components/SoundObjectCard';
import { StyleStrip } from '@/components/StyleStrip';
import { TransportBar } from '@/components/TransportBar';
import { useSession } from '@/state/sessionStore';
import { colors, radius, spacing, type } from '@/theme';

export function JamScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [showQuantize, setShowQuantize] = useState(false);

  const s = useSession();

  const hasPerformance = s.loops.some((l) => l.id === 'live' && l.events.length > 0);

  const handleVocalStart = useCallback(() => {
    s.beginCapture({ kind: 'vocal' });
  }, [s]);

  return (
    <View style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={onBack} accessibilityRole="button" style={styles.back}>
          <Text style={styles.backText}>‹ Capture</Text>
        </Pressable>
        <LatencyBadge compact />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 140 }]}
        showsVerticalScrollIndicator={false}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cards}
        >
          {s.objects.map((o) => (
            <SoundObjectCard
              key={o.id}
              object={o}
              beatPulse={0}
              onTrigger={s.playObject}
              onLongPress={s.removeObject}
            />
          ))}
        </ScrollView>

        <View style={styles.section}>
          <RhythmGuide plan={s.plan} objects={s.objects} playing={s.playing} />
        </View>

        <View style={styles.section}>
          <StyleStrip active={s.style} disabled={s.arranging} onSelect={s.applyStyle} />
        </View>

        <View style={styles.sectionPad}>
          <Pressable
            onPress={() => s.arrange()}
            disabled={s.arranging || s.objects.length === 0}
            accessibilityRole="button"
            style={[
              styles.arrange,
              (s.arranging || s.objects.length === 0) && styles.arrangeDisabled,
            ]}
          >
            {s.arranging ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Text style={styles.arrangeText}>Arrange with Gemma</Text>
            )}
          </Pressable>

          {s.lastPlanInfo && <Text style={styles.planInfo}>{s.lastPlanInfo}</Text>}
        </View>

        <View style={styles.sectionPad}>
          <View style={styles.vocalRow}>
            <CaptureButton
              recording={s.recording?.kind === 'vocal'}
              label={s.vocalTake ? 'Re-sing' : 'Hum a melody'}
              hint="hold and sing"
              tint={colors.ai}
              onStart={handleVocalStart}
              onStop={s.finishCapture}
            />

            <View style={styles.vocalInfo}>
              {s.vocalTake ? (
                <>
                  <Text style={styles.vocalTitle}>Voice captured</Text>
                  <Text style={styles.vocalMeta}>
                    {s.vocalTake.duration.toFixed(1)}s · {s.vocalTake.notes.length} notes
                    {s.vocalTake.detectedKey ? ` · ${s.vocalTake.detectedKey}` : ''}
                  </Text>
                  <Text style={styles.vocalNote}>
                    Your raw voice is preserved — the AI only reads its timing and pitch.
                  </Text>
                </>
              ) : (
                <Text style={styles.vocalMeta}>
                  Hum any phrase. It becomes the lead layer and sets the key for the
                  accompaniment.
                </Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.sectionPad}>
          <Pressable
            onPress={() => setShowQuantize((v) => !v)}
            accessibilityRole="button"
            style={styles.disclosure}
          >
            <Text style={styles.disclosureText}>
              {showQuantize ? '▾' : '▸'} Timing & quantize
            </Text>
            {s.accuracyBefore != null && !showQuantize && (
              <Text style={styles.disclosureBadge}>
                {Math.round((s.accuracyAfter ?? s.accuracyBefore) * 100)}%
              </Text>
            )}
          </Pressable>

          {showQuantize && (
            <View style={{ marginTop: spacing.md }}>
              <QuantizePanel
                opts={s.quantizeOpts}
                accuracyBefore={s.accuracyBefore}
                accuracyAfter={s.accuracyAfter}
                hasPerformance={hasPerformance}
                onChange={s.setQuantize}
                onApply={s.applyQuantize}
              />
            </View>
          )}
        </View>

        {s.loops.length > 0 && (
          <View style={styles.sectionPad}>
            <Text style={styles.sectionHeader}>LAYERS</Text>
            {s.loops.map((l) => (
              <Pressable
                key={l.id}
                onPress={() => s.toggleLoopMute(l.id)}
                accessibilityRole="button"
                style={styles.layerRow}
              >
                <View style={[styles.layerDot, !l.muted && styles.layerDotOn]} />
                <Text style={[styles.layerName, l.muted && styles.layerMuted]}>{l.name}</Text>
                <Text style={styles.layerCount}>{l.events.length} hits</Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={[styles.transportWrap, { paddingBottom: insets.bottom + spacing.md }]}>
        {s.statusMessage && <Text style={styles.status}>{s.statusMessage}</Text>}
        <TransportBar
          playing={s.playing}
          armed={s.armed}
          bpm={s.bpm}
          bars={s.bars}
          onTogglePlay={s.togglePlay}
          onToggleArm={s.toggleArm}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  back: { paddingVertical: spacing.sm, paddingRight: spacing.md },
  backText: { ...type.label, color: colors.textDim },
  scroll: { gap: spacing.lg },
  cards: { gap: spacing.md, paddingHorizontal: spacing.lg },
  section: { paddingHorizontal: 0 },
  sectionPad: { paddingHorizontal: spacing.lg },
  sectionHeader: { ...type.caption, color: colors.textFaint, marginBottom: spacing.sm },
  arrange: {
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.ai,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  arrangeDisabled: { backgroundColor: colors.surfaceRaised },
  arrangeText: { ...type.label, color: colors.bg },
  planInfo: {
    ...type.caption,
    color: colors.textFaint,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  vocalRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  vocalInfo: { flex: 1, gap: 4 },
  vocalTitle: { ...type.label, color: colors.text },
  vocalMeta: { ...type.caption, color: colors.textDim, fontWeight: '500' },
  vocalNote: { ...type.caption, color: colors.textFaint, fontWeight: '500' },
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  disclosureText: { ...type.label, color: colors.textDim },
  disclosureBadge: { ...type.label, color: colors.live, fontVariant: ['tabular-nums'] },
  layerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  layerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  layerDotOn: { backgroundColor: colors.live },
  layerName: { ...type.body, color: colors.text, flex: 1 },
  layerMuted: { color: colors.textFaint },
  layerCount: { ...type.caption, color: colors.textFaint },
  transportWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
    backgroundColor: 'rgba(8,9,12,0.94)',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  status: { ...type.caption, color: colors.textDim, textAlign: 'center' },
});
