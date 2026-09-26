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
import { BeatGridPanel } from '@/components/BeatGridPanel';
import { FrequencyVisualizer } from '@/components/FrequencyVisualizer';
import { gridHitCount } from '@/audio/beatGrid';
import { TrackPlayer } from '@/components/TrackPlayer';
import { TransportBar } from '@/components/TransportBar';
import { Waveform } from '@/components/Waveform';
import {
  getModelStatus,
  initModel,
  subscribeModelStatus,
  type ModelStatus,
} from '@/ai/modelLoader';
import { GemmaCard } from '@/components/GemmaCard';
import { GradientButton } from '@/components/ui/GradientButton';
import { gradients } from '@/theme/gradients';
import { toast } from '@/state/toastStore';
import { speakNow } from '@/audio/speech';
import { useSession } from '@/state/sessionStore';
import { colors, radius, spacing, type } from '@/theme';

/**
 * The jam surface — panels 4 through 8 of the product mockups, in the order
 * the demo walks them: voice, guide, arrange, layers, vibes, player.
 */
export function JamScreen({ onBack, onCapture }: { onBack: () => void; onCapture: () => void }) {
  const insets = useSafeAreaInsets();
  const [showQuantize, setShowQuantize] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [modelStatus, setModelStatus] = useState<ModelStatus>(getModelStatus());

  useEffect(() => subscribeModelStatus(setModelStatus), []);

  const s = useSession();

  const hasPerformance = s.loops.some((l) => l.id === 'live' && l.events.length > 0);

  const handleVocalStart = useCallback(() => {
    s.beginCapture({ kind: 'vocal' });
  }, [s]);

  return (
    <View style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={onBack} accessibilityRole="button" style={styles.back}>
          <Text style={styles.backChevron}>{'‹'}</Text>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.screenTitle}>Studio</Text>
        <LatencyBadge compact />
      </View>

      {/* Frequency visualizer — shows when playing */}
      {s.playing && (
        <View style={styles.vizWrap}>
          <FrequencyVisualizer playing={s.playing} barCount={40} height={36} color={colors.vibe} />
        </View>
      )}

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 150 + NAV_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
      >
        {/* --- the step grid: one row per captured sound, the user's own beat --- */}
        <View style={styles.sectionPad}>
          <BeatGridPanel
            grid={s.grid}
            objects={s.objects}
            playing={s.playing}
            recording={s.gridRecording}
            aiMode={s.aiMode}
            arranging={s.arranging}
            plan={s.plan}
            bpm={s.bpm}
            modelReady={modelStatus.state === 'ready'}
            onToggleStep={s.toggleGridStep}
            onPlaySound={s.playObject}
            onSetSteps={s.setGridSteps}
            onToggleRecord={s.toggleGridRecord}
            onClear={s.clearGrid}
            onSetAiMode={(on) => void s.setAiMode(on)}
            onReproduce={() => void s.arrange()}
            onAddSound={onCapture}
          />
        </View>

        {/* --- the director's desk: Gemma + arrange (panel 6 trigger) --- */}
        <View style={styles.sectionPad}>
          <GemmaCard
            status={modelStatus}
            plan={s.plan}
            bpm={s.bpm}
            lastPlanInfo={s.lastPlanInfo}
            arranging={s.arranging}
            canArrange={s.objects.length > 0}
            onArrange={() => void s.arrange()}
            texture={{
              on: s.textureOn,
              status: s.textureStatus,
              info: s.textureInfo,
              onToggle: s.setTextureOn,
              onRegenerate: s.regenerateTexture,
            }}
            onLoadModel={() => {
              toast('Looking for Gemma…', 'progress');
              void initModel().then(() => {
                const st = getModelStatus();
                if (st.state === 'ready') toast('Gemma is ready to arrange', 'ai');
                else if (st.state === 'absent') toast('Model file not found on this phone', 'error');
                else if (st.state === 'error') toast(`Gemma failed: ${st.message}`, 'error');
              });
            }}
          />
        </View>

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

        {/* --- rhythm guide (panel 5): for plans made without a grid beat --- */}
        {gridHitCount(s.grid) === 0 && s.plan && (
          <View style={styles.sectionPad}>
            <RhythmGuide plan={s.plan} objects={s.objects} playing={s.playing} />
          </View>
        )}

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

        {/* --- prompt-based beat generator --- */}
        <View style={styles.sectionPad}>
          <View style={styles.promptCard}>
            <Text style={styles.promptTitle}>Describe your beat</Text>
            <Text style={styles.promptHint}>
              Tell the AI what vibe you want — it'll arrange your sounds to match.
            </Text>
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder="e.g. lo-fi chill with heavy bass, fast EDM drop..."
              placeholderTextColor={colors.textFaint}
              style={styles.promptInput}
              multiline
              maxLength={200}
              editable={!s.arranging}
              accessibilityLabel="Beat description"
            />
            <View style={styles.promptActions}>
              <Pressable
                onPress={() => {
                  const instruction = prompt.trim();
                  if (instruction) {
                    void s.arrange(instruction);
                  } else {
                    void s.arrange();
                  }
                }}
                disabled={s.arranging || s.objects.length === 0}
                style={[
                  styles.promptGenBtn,
                  (s.arranging || s.objects.length === 0) && styles.promptGenBtnDisabled,
                ]}
              >
                {s.arranging ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.promptGenText}>
                    {prompt.trim() ? '✦ Generate' : '✦ Auto Arrange'}
                  </Text>
                )}
              </Pressable>
              {prompt.trim().length > 0 && (
                <Pressable
                  onPress={() => setPrompt('')}
                  style={styles.promptClearBtn}
                >
                  <Text style={styles.promptClearText}>Clear</Text>
                </Pressable>
              )}
            </View>
            {s.lastPlanInfo && (
              <Text style={styles.promptResult} numberOfLines={2}>
                Last: {s.lastPlanInfo}
              </Text>
            )}
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
            <GradientButton
              label="Save this jam"
              trailing="♥"
              busy={s.savingSession}
              busyLabel="Saving…"
              gradient={gradients.capture}
              shape="rounded"
              onPress={() => {
                setSaveName(`Jam ${new Date().toLocaleDateString()}`);
                setSaving(true);
              }}
              accessibilityLabel="Save this jam"
            />
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

      <View style={[styles.transportWrap, { paddingBottom: insets.bottom + NAV_CLEARANCE }]}>
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

/** The bottom nav (bar + raised capture button) overlays this screen; keep the transport above it. */
const NAV_CLEARANCE = 90;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingRight: spacing.md,
    gap: 2,
  },
  backChevron: { fontSize: 22, fontWeight: '300', color: colors.vibe, marginTop: -1 },
  backText: { ...type.body, color: colors.vibe },
  screenTitle: { ...type.title, color: colors.text, flex: 1, textAlign: 'center' },
  vizWrap: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  scroll: { gap: spacing.lg },
  sectionPad: { paddingHorizontal: spacing.lg },

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

  vocalRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSolid,
    borderWidth: 1,
    borderColor: colors.border,
  },
  vocalInfo: { flex: 1, gap: 4 },
  vocalTitle: { ...type.label, color: colors.text },
  vocalMeta: { ...type.caption, color: colors.textDim, fontWeight: '500' },

  promptCard: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSolid,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  promptTitle: { ...type.label, fontSize: 15, color: colors.text },
  promptHint: { ...type.caption, color: colors.textDim, lineHeight: 16 },
  promptInput: {
    ...type.body,
    color: colors.text,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 56,
    textAlignVertical: 'top',
  },
  promptActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  promptGenBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.ai,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  promptGenBtnDisabled: {
    backgroundColor: colors.surfaceRaised,
  },
  promptGenText: { ...type.label, color: '#FFFFFF', fontSize: 14 },
  promptClearBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptClearText: { ...type.label, color: colors.textDim },
  promptResult: {
    ...type.caption,
    color: colors.ai,
    lineHeight: 16,
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
    backgroundColor: 'rgba(0,0,0,0.92)',
  },


  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceSolid,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.lg,
  },
  modalTitle: { ...type.title, fontSize: 18, color: colors.text },
  modalInput: {
    ...type.body,
    color: colors.text,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  modalButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  modalCancel: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  modalCancelText: { ...type.label, color: colors.textDim },
  modalSave: {
    flex: 2,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.vibe,
  },
  modalSaveText: { ...type.label, color: '#FFFFFF' },
});
