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
import { TuneCard } from '@/components/TuneCard';
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
/**
 * Genres shown as one-tap chips. The label is what gets sent, so each one
 * must match a keyword in src/audio/genres.ts — that is where its
 * instruments and tempo come from.
 */
const GENRE_CHIPS = [
  { label: 'Mass beat', emoji: '🥁', color: '#FF9F0A' },
  { label: 'Indian classical', emoji: '🪕', color: '#FFD60A' },
  { label: 'Bollywood', emoji: '🎬', color: '#BF5AF2' },
  { label: 'Bhangra', emoji: '💃', color: '#FF375F' },
  { label: 'Carnatic', emoji: '🎻', color: '#64D2FF' },
  { label: 'Hip hop', emoji: '🎤', color: '#30D158' },
  { label: 'Pop', emoji: '✨', color: '#0A84FF' },
  { label: 'Phonk', emoji: '🔥', color: '#FF453A' },
  { label: 'Trap', emoji: '💎', color: '#5E5CE6' },
  { label: 'Lofi', emoji: '☕', color: '#AC8E68' },
  { label: 'EDM', emoji: '⚡', color: '#66D4CF' },
  { label: 'Afrobeats', emoji: '🌍', color: '#FFCC00' },
  { label: 'Jazz', emoji: '🎷', color: '#D0A0FF' },
  { label: 'Cinematic', emoji: '🎞️', color: '#8E8E93' },
];

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
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 150 }]}
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

        {/* --- your tune: voice, instrument, and a song built on it --- */}
        {s.vocalTake && (
          <View style={styles.sectionPad}>
            <TuneCard />
          </View>
        )}

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
            <Text style={styles.promptTitle}>Pick a genre or describe your beat</Text>
            <Text style={styles.promptHint}>
              Tap a genre to generate instantly, or type anything — your words go
              straight to the music model, built around your own sounds.
            </Text>

            {/* One tap per genre: fills the prompt and generates. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.genreRow}
            >
              {GENRE_CHIPS.map((g) => {
                const on = prompt.trim().toLowerCase() === g.label.toLowerCase();
                return (
                  <Pressable
                    key={g.label}
                    onPress={() => {
                      setPrompt(g.label);
                      if (s.objects.length > 0 && !s.arranging) void s.arrange(g.label);
                    }}
                    disabled={s.arranging}
                    style={[
                      styles.genreChip,
                      { borderColor: on ? g.color : colors.border },
                      on && { backgroundColor: `${g.color}26` },
                    ]}
                  >
                    <Text style={styles.genreEmoji}>{g.emoji}</Text>
                    <Text style={[styles.genreText, on && { color: g.color }]}>{g.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder="e.g. mass beat for a festival, sad Bollywood pop, dark phonk…"
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
            {s.plan?.genre && (
              <Text style={styles.promptResult}>
                Genre: {s.plan.genre} · {s.bpm} BPM
              </Text>
            )}
            {s.textureInfo && (
              // The exact text sent to the music model, so it is visible that
              // the description reached it.
              <Text style={styles.musicPrompt} numberOfLines={3}>
                🎵 {s.textureInfo}
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

        {/*
          Turning the loop into a song.

          The loop is eight bars going round; this builds the two-minute
          version with an opening, two choruses and an ending, and asks the
          music model for a different bed under each section. The arrangement
          plays within a second or two and the beds fade in as they generate,
          so the wait is audible progress rather than a blank screen.
        */}
        {s.plan && (
          <View style={styles.sectionPad}>
            <Pressable
              onPress={() => (s.songMode ? s.exitSongMode() : void s.makeSong())}
              disabled={s.songProgress != null}
              style={[styles.songBtn, s.songProgress != null && styles.songBtnBusy]}
            >
              <Text style={styles.songBtnText}>
                {s.songProgress != null
                  ? `${s.songStage ?? 'Working…'} ${Math.round((s.songProgress ?? 0) * 100)}%`
                  : s.songMode
                    ? '← Back to the loop'
                    : '♫  Make it a Song  ·  ~2 min'}
              </Text>
              {s.songProgress != null && (
                <View style={styles.songBar}>
                  <View
                    style={[styles.songBarFill, { width: `${Math.round((s.songProgress ?? 0) * 100)}%` }]}
                  />
                </View>
              )}
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
  songBtn: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.ai,
    backgroundColor: 'rgba(191,90,242,0.12)',
    alignItems: 'center',
    gap: spacing.sm,
  },
  songBtnBusy: { opacity: 0.8, borderColor: colors.border },
  songBtnText: { ...type.label, fontSize: 15, color: colors.ai, textAlign: 'center' },
  songBar: {
    height: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  songBarFill: { height: 3, backgroundColor: colors.ai },

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
  genreRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  genreChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    backgroundColor: colors.surfaceSolid,
  },
  genreEmoji: { fontSize: 15 },
  genreText: { ...type.label, fontSize: 13, color: colors.text },
  musicPrompt: { ...type.caption, fontSize: 11, color: colors.ai, lineHeight: 15 },
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
