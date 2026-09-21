import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaptureButton } from '@/components/CaptureButton';
import { LatencyBadge } from '@/components/LatencyBadge';
import { LayerList } from '@/components/LayerList';
import { LyricDisplay } from '@/components/LyricDisplay';
import { QuantizePanel } from '@/components/QuantizePanel';
import { RhythmGuide } from '@/components/RhythmGuide';
import { SoundObjectCard } from '@/components/SoundObjectCard';
import { TrackPlayer } from '@/components/TrackPlayer';
import { TransportBar } from '@/components/TransportBar';
import { VibeGrid } from '@/components/VibeGrid';
import { Waveform } from '@/components/Waveform';
import {
  describeStatus,
  getModelStatus,
  subscribeModelStatus,
  type ModelStatus,
} from '@/ai/modelLoader';
import { speakNow } from '@/audio/speech';
import { useSession } from '@/state/sessionStore';
import { colors, radius, spacing, type } from '@/theme';

/**
 * The jam surface — panels 4 through 8 of the product mockups, in the order
 * the demo walks them: voice, guide, arrange, layers, vibes, player.
 */
export function JamScreen({
  onBack,
  onFinish,
}: {
  onBack: () => void;
  /** Step 4 — opens the finished jam. Absent until there is one to open. */
  onFinish?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [showQuantize, setShowQuantize] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [modelStatus, setModelStatus] = useState<ModelStatus>(getModelStatus());

  useEffect(() => subscribeModelStatus(setModelStatus), []);

  const s = useSession();

  const hasPerformance = s.loops.some((l) => l.id === 'live' && l.events.length > 0);

  const handleVocalStart = useCallback(() => {
    s.beginCapture({ kind: 'vocal' });
  }, [s]);

  const modelTone =
    modelStatus.state === 'ready'
      ? colors.live
      : modelStatus.state === 'error'
        ? colors.warn
        : colors.textFaint;

  return (
    <View style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={onBack} accessibilityRole="button" style={styles.back}>
          <Text style={styles.backText}>‹ Capture</Text>
        </Pressable>
        <LatencyBadge compact />

        {/* Step 4. Shown only once there is an arrangement to open, so the
            control never promises a jam that does not exist yet. */}
        {onFinish && s.plan && (
          <Pressable
            onPress={onFinish}
            accessibilityRole="button"
            accessibilityLabel="Open your finished jam"
            style={styles.finish}
          >
            <Text style={styles.finishText}>Your Jam ›</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 150 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* --- pads (panel 3) --- */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cards}
        >
          {s.objects.map((o) => (
            <SoundObjectCard
              key={o.id}
              object={o}
              pcm={s.pcmBySlot.get(o.slot) ?? null}
              onTrigger={s.playObject}
              onLongPress={s.removeObject}
            />
          ))}
        </ScrollView>

        {/* --- voice (panel 4) --- */}
        <View style={styles.sectionPad}>
          <View style={styles.vocalRow}>
            <CaptureButton
              recording={s.recording?.kind === 'vocal'}
              label={s.vocalTake ? 'Re-sing' : 'Sing or hum'}
              hint="hold and sing"
              tint={colors.ai}
              onStart={handleVocalStart}
              onStop={s.finishCapture}
            />

            <View style={styles.vocalInfo}>
              {s.vocalTake ? (
                <>
                  <Text style={styles.vocalTitle}>Voice captured</Text>
                  <Waveform
                    pcm={s.pcmBySlot.get(s.vocalTake.slot) ?? null}
                    width={150}
                    height={26}
                    color={colors.ai}
                    bars={42}
                  />
                  <Text style={styles.vocalMeta}>
                    {s.vocalTake.duration.toFixed(1)}s · {s.vocalTake.notes.length} notes
                    {s.vocalTake.detectedKey ? ` · ${s.vocalTake.detectedKey}` : ''}
                  </Text>
                </>
              ) : (
                <Text style={styles.vocalMeta}>
                  Hum any phrase. Your voice stays the lead layer and sets the key for the
                  accompaniment.
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* --- rhythm guide (panel 5) --- */}
        <View style={styles.sectionPad}>
          <RhythmGuide plan={s.plan} objects={s.objects} playing={s.playing} />
        </View>

        {/* --- lyrics --- */}
        <View style={styles.sectionPad}>
          {s.lyrics ? (
            <LyricDisplay
              lyrics={s.lyrics}
              bars={s.bars}
              playing={s.playing}
              speakEnabled={s.guidanceOn}
              onSpeakLine={speakNow}
            />
          ) : null}

          <Pressable
            onPress={() => s.writeLyrics()}
            disabled={s.writingLyrics || !s.plan}
            accessibilityRole="button"
            style={[
              styles.lyricButton,
              (s.writingLyrics || !s.plan) && styles.lyricButtonDisabled,
              s.lyrics ? { marginTop: spacing.sm } : null,
            ]}
          >
            {s.writingLyrics ? (
              <ActivityIndicator color={colors.vibe} />
            ) : (
              <Text style={styles.lyricButtonText}>
                {s.lyrics ? 'Write new lyrics' : '✎ Write lyrics for this track'}
              </Text>
            )}
          </Pressable>
        </View>

        {/* --- arrange (panel 6 trigger) --- */}
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
              <Text style={styles.arrangeText}>Turn it into music</Text>
            )}
          </Pressable>

          <View style={styles.modelRow}>
            <View style={[styles.modelDot, { backgroundColor: modelTone }]} />
            <Text style={styles.modelText} numberOfLines={2}>
              {describeStatus(modelStatus)}
            </Text>
          </View>

          {s.lastPlanInfo && <Text style={styles.planInfo}>{s.lastPlanInfo}</Text>}
        </View>

        {/* --- layers (panel 6) --- */}
        {s.objects.length > 0 && (
          <View style={styles.sectionPad}>
            <LayerList
              objects={s.objects}
              pcmBySlot={s.pcmBySlot}
              vocalTake={s.vocalTake}
              accompaniment={s.plan?.accompaniment ?? []}
              onToggleObject={(id) => {
                const o = s.objects.find((x) => x.id === id);
                if (o) s.setObjectVolume(id, o.volume === 0 ? 1 : 0);
              }}
              onTriggerObject={s.playObject}
            />
          </View>
        )}

        {/* --- vibes (panel 7) --- */}
        <View style={styles.sectionPad}>
          <View style={styles.vibeCard}>
            <VibeGrid active={s.style} busy={s.arranging} onSelect={s.applyStyle} />
          </View>
        </View>

        {/* --- timing --- */}
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

        {/* --- save this jam --- */}
        {s.objects.length > 0 && (
          <View style={styles.sectionPad}>
            <Pressable
              onPress={() => {
                setSaveName(`Jam ${new Date().toLocaleDateString()}`);
                setSaving(true);
              }}
              disabled={s.savingSession}
              accessibilityRole="button"
              accessibilityLabel="Save this jam"
              style={styles.saveButton}
            >
              <Text style={styles.saveButtonText}>
                {s.savingSession ? 'Saving…' : '♥ Save this jam'}
              </Text>
            </Pressable>
          </View>
        )}

        {/* --- player (panel 8) --- */}
        {s.loops.length > 0 && (
          <View style={styles.sectionPad}>
            <TrackPlayer
              title="My Room Track"
              playing={s.playing}
              bpm={s.bpm}
              bars={s.bars}
              previewPcm={null}
              exporting={s.exporting}
              onTogglePlay={s.togglePlay}
              onSave={() => s.exportTrack()}
              onShare={() => s.shareTrack()}
              onDelete={s.clearTrack}
            />
          </View>
        )}
      </ScrollView>

      <Modal visible={saving} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Name this jam</Text>
            <TextInput
              value={saveName}
              onChangeText={setSaveName}
              placeholder="Morning Vibes"
              placeholderTextColor={colors.textFaint}
              style={styles.modalInput}
              maxLength={28}
              autoFocus
              onSubmitEditing={() => {
                void s.saveCurrentSession(saveName);
                setSaving(false);
              }}
              accessibilityLabel="Jam name"
            />
            <View style={styles.modalButtons}>
              <Pressable onPress={() => setSaving(false)} style={styles.modalCancel}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  void s.saveCurrentSession(saveName);
                  setSaving(false);
                }}
                style={styles.modalSave}
              >
                <Text style={styles.modalSaveText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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
  finish: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.6)',
    backgroundColor: 'rgba(30,20,50,0.85)',
  },
  finishText: { fontSize: 13, fontWeight: '700', color: '#DDD6FE' },
  backText: { ...type.label, color: colors.textDim },
  scroll: { gap: spacing.lg },
  cards: { gap: spacing.md, paddingHorizontal: spacing.lg },
  sectionPad: { paddingHorizontal: spacing.lg },

  arrange: {
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.vibe,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  arrangeDisabled: { backgroundColor: colors.surfaceRaised },
  lyricButton: {
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.vibe,
    backgroundColor: colors.vibeDim,
    alignItems: 'center',
    minHeight: 46,
    justifyContent: 'center',
  },
  lyricButtonDisabled: { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  lyricButtonText: { ...type.label, color: colors.vibe },
  arrangeText: { ...type.label, color: colors.bg },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  modelDot: { width: 6, height: 6, borderRadius: 3 },
  modelText: { ...type.caption, color: colors.textFaint, flex: 1 },
  planInfo: { ...type.caption, color: colors.textFaint, marginTop: 2 },

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

  vibeCard: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },

  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  disclosureText: { ...type.label, color: colors.textDim },
  disclosureBadge: { ...type.label, color: colors.live, fontVariant: ['tabular-nums'] },

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

  saveButton: {
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
    alignItems: 'center',
  },
  saveButtonText: { ...type.label, color: colors.accent },

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
  modalCancel: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalCancelText: { ...type.label, color: colors.textDim },
  modalSave: {
    flex: 2,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.vibe,
  },
  modalSaveText: { ...type.label, color: colors.bg },
});
