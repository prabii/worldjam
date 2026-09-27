import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Peaks } from '../components/cards';
import { ConfirmDelete } from '../components/ConfirmDelete';
import { Icon } from '../components/Icon';
import { Karaoke } from '../components/Karaoke';
import { toast } from '../components/Toasts';
import { Button, Chip, Field, IconButton, Screen, Segmented, Sheet } from '../components/ui';
import { STYLE_CHOICES } from '../ai/context';
import { suggestPatterns, type GuideSuggestion } from '../ai/guide';
import { roleForCapture } from '../ai/kb/rules';
import type { StudioSession, StudioSource } from '../contracts/library';
import type { LayerRole } from '../contracts/musicPlan';
import type { QuantizeSettings } from '../audio/performance';
import { useNav } from '../nav/store';
import { capturePeaks } from '../services/media';
import { stop as stopPlayer, toggle, usePlayer } from '../services/player';
import { useVoicePrompt } from '../services/speech';
import {
  MAX_PADS, STAGE_LABEL, cancelJob, clearTake, editPreview, enhanceTake, generate, newSession, openSession, pauseTake, playTake,
  plannerCaptures, previewSuggestion, produce, removeSource, renderTake, rerender, saveTrack, setAiTiming, setBpm, setDuration,
  setMetronome, setMode, setPad, setPadLayout, setProductionAmount, setPrompt, setQuantize, setRole, setStyle, startRecording,
  stopRecording, stopTake, tapTempo, triggerPad, usePadHits, useStudio, useSuggestionAsTake, useSuggestionInAi,
} from '../services/studio';
import { color, font, formatDuration, radius, roleColor, space } from '../theme';

const ROLES: LayerRole[] = ['kick', 'snare', 'hat', 'percussion', 'bass', 'chords', 'pad', 'lead', 'vocal', 'texture', 'fx'];

export function StudioScreen({ bottomInset }: { bottomInset: number }) {
  const session = useStudio((s) => s.session);
  const loading = useStudio((s) => s.loading);
  const mode = useStudio((s) => s.mode);
  const { push } = useNav();

  useEffect(() => {
    if (!useStudio.getState().session) void openSession();
  }, []);

  const hasSources = (session?.sources.length ?? 0) > 0;
  const addSounds = () => session && push({ name: 'sourcePicker', sessionId: session.id });

  return (
    <View style={{ flex: 1 }}>
      <Screen scroll bottomInset={bottomInset + 40}>
        <View style={styles.top}>
          <View style={{ flex: 1 }}>
            <Text style={font.title}>Studio</Text>
            <Text style={font.caption}>{session ? `${session.sources.length} sound${session.sources.length === 1 ? '' : 's'} · ${session.bpm} BPM` : loading ? 'Opening…' : ''}</Text>
          </View>
          <IconButton icon="add" label="Add sounds" onPress={addSounds} />
          <IconButton icon="repeat" label="New session" onPress={() => void newSession().then(() => toast('New session', 'success'))} />
        </View>

        {session && hasSources ? (
          <SoundBoard session={session} onAdd={addSounds} />
        ) : (
          <View style={styles.emptyBox}>
            <Text style={font.heading}>Build your soundboard</Text>
            <Text style={font.body}>Pick captures from My Jams or record a new one. Each sound becomes a pad.</Text>
            <Button label="Add sounds" kind="primary" icon="add" onPress={addSounds} style={{ marginTop: space.md }} />
          </View>
        )}

        {hasSources && (
          <>
            <View style={{ marginTop: space.lg }}>
              <Segmented
                options={[{ value: 'AI', label: 'AI Studio', icon: 'ai' }, { value: 'MANUAL', label: 'Manual', icon: 'pads' }]}
                value={mode}
                onChange={(m) => setMode(m)}
              />
            </View>
            {mode === 'MANUAL' ? <ManualPanel /> : <AiPanel />}
          </>
        )}
        <PreviewPanel />
      </Screen>
      <AiGuide enabled={hasSources} bottomInset={bottomInset} />
    </View>
  );
}

// ---------------------------------------------------------------- Soundboard (grid)

function SoundBoard({ session, onAdd }: { session: StudioSession; onAdd: () => void }) {
  const captures = useStudio((s) => s.captures);
  const looping = useStudio((s) => s.loopingPads);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const layout = session.padLayout ?? 'auto';
  const n = session.sources.length;
  const cols = layout === '8x8' ? 8 : layout === '4x4' ? 4 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const perPage = layout === '8x8' ? 64 : layout === '4x4' ? 16 : Math.max(n + 1, cols * Math.ceil((n + 1) / cols));
  const pages = Math.max(1, Math.ceil(Math.min(MAX_PADS, Math.max(n + 1, perPage)) / perPage));
  const width = Math.min(Dimensions.get('window').width, 480) - space.lg * 2;
  const gap = cols >= 8 ? 4 : space.sm;
  const size = Math.floor((width - gap * (cols - 1)) / cols);
  const byPad = new Map(session.sources.map((s) => [s.padIndex, s]));
  const slots = Array.from({ length: Math.min(perPage, MAX_PADS - page * perPage) }, (_, i) => page * perPage + i);
  const firstFree = Array.from({ length: MAX_PADS }, (_, i) => i).find((i) => !byPad.has(i));
  const pad = editing != null ? byPad.get(editing) ?? null : null;

  useEffect(() => {
    if (page >= pages) setPage(0);
  }, [page, pages]);

  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.rowBetween}>
        <Text style={font.label}>Soundboard · tap to play, hold to edit</Text>
        <View style={styles.row}>
          {(['auto', '4x4', '8x8'] as const).map((l) => (
            <Chip key={l} label={l === 'auto' ? 'Auto' : l === '4x4' ? '4×4' : '8×8'} selected={layout === l} onPress={() => { setPadLayout(l); setPage(0); }} />
          ))}
        </View>
      </View>
      <View style={[styles.grid, { gap }]}>
        {slots.map((i) => {
          const src = byPad.get(i);
          if (!src) {
            const canAdd = i === firstFree;
            return (
              <Pressable
                key={`e${i}`}
                onPress={canAdd ? onAdd : undefined}
                accessibilityLabel={canAdd ? 'Add a sound' : `Empty pad ${i + 1}`}
                style={[styles.padEmpty, { width: size, height: size }]}
              >
                {canAdd && <Icon name="add" size={cols >= 8 ? 16 : 22} color={color.textMuted} />}
              </Pressable>
            );
          }
          const cap = captures[src.captureId];
          const role = (src.role as string | null) ?? (cap ? roleForCapture(cap) : 'texture');
          return <Pad key={src.padIndex} src={src} name={cap?.name ?? 'Sound'} role={role} size={size} compact={cols >= 8} looping={looping.includes(src.padIndex)} onEdit={() => setEditing(src.padIndex)} />;
        })}
      </View>
      {pages > 1 && (
        <View style={[styles.row, { justifyContent: 'center' }]}>
          {Array.from({ length: pages }, (_, p) => (
            <Chip key={p} label={`Page ${p + 1}`} selected={p === page} onPress={() => setPage(p)} />
          ))}
        </View>
      )}
      <PadSheet src={pad} onClose={() => setEditing(null)} />
    </View>
  );
}

function Pad({ src, name, role, size, compact, looping, onEdit }: { src: StudioSource; name: string; role: string; size: number; compact: boolean; looping: boolean; onEdit: () => void }) {
  const hit = usePadHits((h) => h[src.padIndex] ?? 0);
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!hit) return;
    glow.setValue(1);
    Animated.timing(glow, { toValue: 0, duration: 260, useNativeDriver: false }).start();
  }, [hit, glow]);
  const tint = roleColor[role] ?? color.cyan;
  const bg = glow.interpolate({ inputRange: [0, 1], outputRange: [color.surface, tint] });
  return (
    <Pressable onPressIn={() => triggerPad(src.padIndex)} onLongPress={onEdit} delayLongPress={450} accessibilityRole="button" accessibilityLabel={`Pad ${name}, ${role}. Hold to edit`}>
      <Animated.View style={[styles.pad, { width: size, height: size, borderColor: tint, backgroundColor: looping ? color.elevated : bg, opacity: src.settings.muted ? 0.35 : 1, padding: compact ? 3 : space.sm }]}>
        <Text numberOfLines={compact ? 1 : 2} style={[styles.padName, compact && { fontSize: 9 }]}>{name}</Text>
        {!compact && <Text style={font.caption}>{role}{src.settings.loop ? ' · loop' : ''}</Text>}
      </Animated.View>
    </Pressable>
  );
}

function PadSheet({ src, onClose }: { src: StudioSource | null; onClose: () => void }) {
  const captures = useStudio((s) => s.captures);
  const [confirm, setConfirm] = useState<StudioSource | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const cap = src ? captures[src.captureId] : null;
  const dur = cap?.durationMs ?? 0;

  useEffect(() => {
    if (!cap) return;
    let live = true;
    capturePeaks(cap, 64).then((p) => live && setPeaks(p));
    return () => {
      live = false;
    };
  }, [cap]);

  const st = src?.settings;
  const trimEnd = st ? st.trimEndMs ?? dur : 0;
  const step = Math.max(20, Math.round(dur / 40));

  return (
    <>
      <Sheet visible={!!src} onClose={onClose} title={cap?.name ?? 'Pad'}>
        {src && st && (
          <View style={{ gap: space.md }}>
            <Text style={font.label}>Role in the track</Text>
            <View style={styles.wrap}>
              <Chip label="Auto" selected={!src.role} onPress={() => setRole(src.captureId, null)} />
              {ROLES.map((r) => (
                <Chip key={r} label={r} selected={src.role === r} onPress={() => setRole(src.captureId, r)} />
              ))}
            </View>
            <Stepper label="Gain" value={`${st.gainDb} dB`} onMinus={() => void setPad(src.padIndex, { gainDb: Math.max(-30, st.gainDb - 2) })} onPlus={() => void setPad(src.padIndex, { gainDb: Math.min(6, st.gainDb + 2) })} />
            <Stepper label="Pan" value={st.pan === 0 ? 'Centre' : st.pan < 0 ? `L ${Math.round(-st.pan * 100)}` : `R ${Math.round(st.pan * 100)}`} onMinus={() => void setPad(src.padIndex, { pan: Math.max(-1, +(st.pan - 0.2).toFixed(1)) })} onPlus={() => void setPad(src.padIndex, { pan: Math.min(1, +(st.pan + 0.2).toFixed(1)) })} />
            <Stepper label="Pitch" value={`${st.pitchSemitones > 0 ? '+' : ''}${st.pitchSemitones} st`} onMinus={() => void setPad(src.padIndex, { pitchSemitones: Math.max(-12, st.pitchSemitones - 1) })} onPlus={() => void setPad(src.padIndex, { pitchSemitones: Math.min(12, st.pitchSemitones + 1) })} />
            {dur > 0 && (
              <View style={{ gap: space.sm }}>
                <Text style={font.label}>Trim · {formatDuration(st.trimStartMs)} – {formatDuration(trimEnd)}</Text>
                <View style={styles.trimBox}>
                  <Peaks peaks={peaks} height={36} />
                  <View pointerEvents="none" style={[styles.trimShade, { left: 0, width: `${(st.trimStartMs / dur) * 100}%` }]} />
                  <View pointerEvents="none" style={[styles.trimShade, { right: 0, width: `${((dur - trimEnd) / dur) * 100}%` }]} />
                </View>
                <Stepper label="Start" value={formatDuration(st.trimStartMs)} onMinus={() => void setPad(src.padIndex, { trimStartMs: Math.max(0, st.trimStartMs - step) })} onPlus={() => void setPad(src.padIndex, { trimStartMs: Math.min(trimEnd - 50, st.trimStartMs + step) })} />
                <Stepper label="End" value={formatDuration(trimEnd)} onMinus={() => void setPad(src.padIndex, { trimEndMs: Math.max(st.trimStartMs + 50, trimEnd - step) })} onPlus={() => void setPad(src.padIndex, { trimEndMs: Math.min(dur, trimEnd + step) >= dur ? null : trimEnd + step })} />
              </View>
            )}
            <View style={styles.wrap}>
              <Chip label="Loop" selected={st.loop} onPress={() => void setPad(src.padIndex, { loop: !st.loop })} />
              <Chip label="Mute" selected={st.muted} onPress={() => void setPad(src.padIndex, { muted: !st.muted })} />
              <Chip label="Play" onPress={() => triggerPad(src.padIndex)} />
            </View>
            <Button label="Remove from session" icon="close" onPress={async () => { const id = src.captureId; onClose(); await removeSource(id); toast('Removed from session'); }} />
            <Button label="Delete from My Jams" kind="danger" icon="delete" onPress={() => { const s = src; onClose(); setTimeout(() => setConfirm(s), 250); }} />
          </View>
        )}
      </Sheet>
      <ConfirmDelete
        visible={!!confirm}
        what={confirm ? `“${captures[confirm.captureId]?.name ?? 'sound'}”` : 'sound'}
        detail="Removes it from this session and deletes it from My Jams. Tracks already made with it keep their audio."
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            if (confirm) await removeSource(confirm.captureId, { deleteFromLibrary: true });
            toast('Deleted', 'success');
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not delete', 'error');
          } finally {
            setConfirm(null);
          }
        }}
      />
    </>
  );
}

function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <View style={styles.row}>
      <Text style={[font.label, { width: 56 }]}>{label}</Text>
      <Pressable onPress={onMinus} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={`${label} down`}>
        <Text style={styles.stepTxt}>−</Text>
      </Pressable>
      <Text style={[font.heading, { flex: 1, textAlign: 'center' }]}>{value}</Text>
      <Pressable onPress={onPlus} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={`${label} up`}>
        <Text style={styles.stepTxt}>+</Text>
      </Pressable>
    </View>
  );
}

/** Grid / strength / swing — shared by Manual (the take) and AI (the arrangement). */
function TimingControls({ value, onChange, styleFeel }: { value: QuantizeSettings; onChange: (q: Partial<QuantizeSettings>) => void; styleFeel?: boolean }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text style={font.label}>Timing & quantize</Text>
      <View style={styles.wrap}>
        {([0, 1, 2, 4] as const).map((g) => (
          <Chip key={g} label={g === 0 ? (styleFeel ? 'Style feel' : 'Off') : g === 1 ? '1/4' : g === 2 ? '1/8' : '1/16'} selected={value.grid === g} onPress={() => onChange({ grid: g })} />
        ))}
      </View>
      <View style={styles.wrap}>
        {[0.5, 0.85, 1].map((v) => (
          <Chip key={`s${v}`} label={`Strength ${Math.round(v * 100)}%`} selected={value.strength === v} onPress={() => onChange({ strength: v })} />
        ))}
      </View>
      <View style={styles.wrap}>
        {[0, 0.3, 0.6].map((v) => (
          <Chip key={`w${v}`} label={v === 0 ? 'No swing' : `Swing ${Math.round(v * 100)}%`} selected={value.swing === v} onPress={() => onChange({ swing: v })} />
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- Manual

function ManualPanel() {
  const session = useStudio((s) => s.session)!;
  const recording = useStudio((s) => s.recording);
  const take = useStudio((s) => s.take);
  const takeState = useStudio((s) => s.takeState);
  const quantize = useStudio((s) => s.quantize);
  const metronome = useStudio((s) => s.metronome);
  const job = useStudio((s) => s.job);
  const [enhance, setEnhance] = useState('');

  return (
    <View style={{ gap: space.lg, marginTop: space.lg }}>
      <View style={styles.row}>
        <Button label="Tap tempo" icon="tap" onPress={() => { const b = tapTempo(); if (b) toast(`${b} BPM`); }} />
        <Pressable onPress={() => setBpm(session.bpm - 2)} style={styles.stepBtn} accessibilityLabel="Slower"><Text style={styles.stepTxt}>−</Text></Pressable>
        <Text style={[font.heading, { minWidth: 72, textAlign: 'center' }]}>{session.bpm} BPM</Text>
        <Pressable onPress={() => setBpm(session.bpm + 2)} style={styles.stepBtn} accessibilityLabel="Faster"><Text style={styles.stepTxt}>+</Text></Pressable>
      </View>
      <Chip label={metronome ? 'Click on while recording' : 'Click off'} selected={metronome} onPress={() => setMetronome(!metronome)} />

      <View style={styles.transport}>
        {recording ? (
          <Button label="Stop" kind="danger" icon="stop" onPress={stopRecording} style={{ flex: 1 }} />
        ) : (
          <Button label={take ? 'Record again' : 'Record'} kind="primary" icon="record" onPress={() => { stopTake(); startRecording(); }} style={{ flex: 1 }} />
        )}
        <IconButton icon={takeState === 'playing' ? 'pause' : 'play'} label={takeState === 'playing' ? 'Pause take' : takeState === 'paused' ? 'Resume take' : 'Play take'} disabled={!take || recording} onPress={() => (takeState === 'playing' ? pauseTake() : playTake())} />
        <IconButton icon="stop" label="Stop take" disabled={!take || takeState === 'idle'} onPress={stopTake} />
        <IconButton icon="delete" label="Delete take" disabled={!take || recording} onPress={() => { clearTake(); toast('Take deleted'); }} />
      </View>
      {recording && <Text style={[font.label, { color: color.pink }]}>● Recording — play the pads above</Text>}
      {take && !recording && (
        <Text style={font.label}>
          Take {formatDuration(take.lengthMs)} · {take.events.length} hits · timing {Math.round(take.accuracy * 100)}%{takeState === 'paused' ? ' · paused' : takeState === 'playing' ? ' · playing' : ''}
        </Text>
      )}

      <TimingControls value={quantize} onChange={setQuantize} />

      <Button label="Render take" kind="primary" icon="waveform" disabled={!take || recording || !!job} onPress={() => void renderTake()} />
      <Field label="Enhance with AI (optional)" value={enhance} onChangeText={setEnhance} placeholder="e.g. make it phonk with a heavy 808" />
      <Button label="Enhance with AI" icon="ai" disabled={!take || recording || !!job} onPress={() => void enhanceTake(enhance.trim() || 'Turn this into a full track')} />
      <JobBar />
    </View>
  );
}

// ---------------------------------------------------------------- AI

function AiPanel() {
  const prompt = useStudio((s) => s.prompt);
  const style = useStudio((s) => s.style);
  const durationSec = useStudio((s) => s.durationSec);
  const job = useStudio((s) => s.job);
  const error = useStudio((s) => s.error);
  const aiTiming = useStudio((s) => s.aiTiming);
  const voice = useVoicePrompt((t) => setPrompt(t));

  return (
    <View style={{ gap: space.lg, marginTop: space.lg }}>
      <View style={styles.promptBox}>
        <TextInput
          value={voice.state === 'listening' && voice.partial ? voice.partial : prompt}
          onChangeText={setPrompt}
          placeholder="Describe your beat… e.g. mass beat for a festival night"
          placeholderTextColor={color.textMuted}
          multiline
          style={styles.promptInput}
          accessibilityLabel="Prompt"
        />
        {voice.available && (
          <IconButton icon={voice.state === 'listening' ? 'stop' : 'mic'} label={voice.state === 'listening' ? 'Stop listening' : 'Speak prompt'} onPress={() => (voice.state === 'listening' ? voice.stop() : void voice.start())} />
        )}
      </View>
      <Text style={font.label}>Genre</Text>
      <View style={styles.wrap}>
        <Chip label="Auto" selected={!style} onPress={() => setStyle(null)} />
        {STYLE_CHOICES.map((s) => (
          <Chip key={s.id} label={s.label} selected={style === s.id} onPress={() => setStyle(s.id)} />
        ))}
      </View>
      <Segmented
        options={[{ value: '30', label: '30 s' }, { value: '45', label: '45 s' }, { value: '60', label: '60 s' }, { value: '90', label: 'Song 90 s' }]}
        value={String(durationSec) as '30' | '45' | '60' | '90'}
        onChange={(v) => setDuration(Number(v))}
      />
      <TimingControls value={aiTiming} onChange={setAiTiming} styleFeel />
      <Button label="Generate track" kind="primary" icon="ai" disabled={!!job} onPress={() => void generate()} />
      <JobBar />
      {error && !job ? <Text style={[font.label, { color: color.error }]}>{error}</Text> : null}
    </View>
  );
}

function JobBar() {
  const job = useStudio((s) => s.job);
  if (!job) return null;
  return (
    <View style={styles.job}>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={font.label}>{STAGE_LABEL[job.stage]}… {Math.round(job.progress * 100)}%</Text>
        <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.max(4, job.progress * 100)}%` }]} /></View>
      </View>
      <Button label="Cancel" icon="close" onPress={cancelJob} />
    </View>
  );
}

// ---------------------------------------------------------------- Preview + save

function PreviewPanel() {
  const preview = useStudio((s) => s.preview);
  const job = useStudio((s) => s.job);
  const lyrics = useStudio((s) => s.lyrics);
  const lyricId = useStudio((s) => s.lyricId);
  const amount = useStudio((s) => s.productionAmount);
  const session = useStudio((s) => s.session);
  const { push, setTab } = useNav();
  const id = preview ? `preview:${preview.uri}` : '';
  const state = usePlayer((s) => (s.activeId === id ? s.state : 'idle'));
  const positionMs = usePlayer((s) => (s.activeId === id ? s.positionMs : 0));
  const progress = usePlayer((s) => (s.activeId === id && s.durationMs ? s.positionMs / s.durationMs : 0));
  const [edit, setEdit] = useState('');
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);

  useEffect(() => () => void stopPlayer(), []);
  if (!preview) return null;

  return (
    <View style={styles.preview}>
      <Text style={font.heading}>{preview.plan.title || 'Your track'}</Text>
      <Text style={font.caption}>
        {preview.plan.style} · {preview.plan.tempoBpm} BPM · {preview.plan.key} {preview.plan.scale} · {formatDuration(preview.durationMs)} · {preview.source}
        {preview.produced ? ' · ACE-Step produced' : ''}
      </Text>
      <View style={styles.playerRow}>
        <Pressable onPress={() => void toggle(id, preview.uri)} style={styles.playBig} accessibilityRole="button" accessibilityLabel={state === 'playing' ? 'Pause' : state === 'paused' ? 'Resume' : 'Play'}>
          <Icon name={state === 'playing' ? 'pause' : 'play'} size={28} color={color.bg} />
        </Pressable>
        <View style={{ flex: 1, gap: space.sm }}>
          <Peaks peaks={preview.peaks} progress={progress} height={48} tint={color.cyan} />
          <View style={styles.rowBetween}>
            <Text style={font.mono}>{formatDuration(positionMs)} / {formatDuration(preview.durationMs)}</Text>
            <IconButton icon="stop" label="Stop" disabled={state === 'idle'} onPress={() => void stopPlayer()} />
          </View>
        </View>
      </View>
      {preview.notes.length > 0 && <Text style={font.caption}>{preview.notes.slice(0, 3).join(' · ')}</Text>}

      {lyrics && <Karaoke lyrics={lyrics} plan={preview.plan} durationMs={preview.durationMs} positionMs={positionMs} playing={state === 'playing'} />}

      <Field label="Change it" value={edit} onChangeText={setEdit} placeholder="e.g. more bass, slower, remove the hats" />
      <View style={styles.row}>
        <Button label="Apply" icon="edit" disabled={!edit.trim() || !!job} onPress={() => { void editPreview(edit.trim()); setEdit(''); }} style={{ flex: 1 }} />
        <Button label="Regenerate" icon="repeat" disabled={!!job} onPress={() => void (preview.mode === 'AI' ? generate() : rerender())} style={{ flex: 1 }} />
      </View>
      <View style={{ gap: space.sm }}>
        <Text style={font.label}>AI producer (ACE-Step 1.5) · blend {Math.round(amount * 100)}%</Text>
        <View style={styles.wrap}>
          {[0.3, 0.5, 0.7, 0.9].map((v) => (
            <Chip key={v} label={`${Math.round(v * 100)}%`} selected={Math.abs(amount - v) < 0.01} onPress={() => setProductionAmount(v)} />
          ))}
        </View>
        <Button label={preview.produced ? 'Produced — regenerate to produce again' : 'Produce with ACE-Step'} icon="ai" disabled={!!job || preview.produced} onPress={() => void produce()} />
      </View>
      <View style={styles.row}>
        <Button label={lyrics ? 'Edit lyrics' : 'Lyrics'} icon="lyrics" onPress={() => push({ name: 'lyricsEditor', id: lyricId ?? undefined, captureIds: session?.sources.map((s) => s.captureId) ?? [] })} style={{ flex: 1 }} />
        <Button label="Save track" kind="primary" icon="save" disabled={!!job} onPress={() => { setName(preview.plan.title || 'My track'); setSaving(true); }} style={{ flex: 1 }} />
      </View>
      <Button label="Discard preview" kind="danger" icon="delete" disabled={!!job} onPress={() => setDiscard(true)} />

      <Sheet visible={saving} onClose={() => setSaving(false)} title="Save to My Jams">
        <View style={{ gap: space.md }}>
          <Field label="Name" value={name} onChangeText={setName} maxLength={60} />
          <Field label="Description" value={desc} onChangeText={setDesc} multiline maxLength={240} />
          <Text style={font.caption}>Sounds: {session?.sources.map((s) => useStudio.getState().captures[s.captureId]?.name).filter(Boolean).join(', ')}</Text>
          {lyrics && <Text style={font.caption}>Lyrics: {lyrics.title}{lyricId ? '' : ' (saved with the track)'}</Text>}
          <Button
            label="Save"
            kind="primary"
            icon="save"
            busy={busy}
            onPress={async () => {
              setBusy(true);
              try {
                await stopPlayer();
                const t = await saveTrack(name.trim() || 'My track', desc.trim(), lyricId);
                setSaving(false);
                toast('Saved to My Jams', 'success');
                setTab('jams');
                push({ name: 'trackDetail', id: t.id });
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Could not save', 'error');
              } finally {
                setBusy(false);
              }
            }}
          />
        </View>
      </Sheet>
      <ConfirmDelete
        visible={discard}
        what="this preview"
        detail="The unsaved render is removed. Your sounds, take and saved tracks stay."
        onCancel={() => setDiscard(false)}
        onConfirm={async () => {
          await stopPlayer();
          useStudio.setState({ preview: null });
          setDiscard(false);
          toast('Preview discarded');
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------- AI Guide (floating, draggable, tuckable)

const GUIDE = 56;

function AiGuide({ enabled, bottomInset }: { enabled: boolean; bottomInset: number }) {
  const { width, height } = Dimensions.get('window');
  const start = { x: width - GUIDE - 12, y: height - bottomInset - GUIDE - 150 };
  const pos = useRef(new Animated.ValueXY(start)).current;
  const last = useRef(start);
  const [tucked, setTucked] = useState(false);
  const [open, setOpen] = useState(false);
  const session = useStudio((s) => s.session);
  const suggestions = useMemo<GuideSuggestion[]>(() => (open ? suggestPatterns(plannerCaptures(), 5) : []), [open, session]);

  const snap = (x: number, y: number, tuck: boolean) => {
    const left = x + GUIDE / 2 < width / 2;
    const nx = tuck ? (left ? -GUIDE * 0.7 : width - GUIDE * 0.3) : left ? 12 : width - GUIDE - 12;
    const ny = Math.max(80, Math.min(height - bottomInset - GUIDE - 20, y));
    last.current = { x: nx, y: ny };
    setTucked(tuck);
    Animated.spring(pos, { toValue: { x: nx, y: ny }, useNativeDriver: false, friction: 7 }).start();
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 6,
        onPanResponderMove: (_, g) => pos.setValue({ x: last.current.x + g.dx, y: last.current.y + g.dy }),
        onPanResponderRelease: (_, g) => {
          const x = last.current.x + g.dx;
          const y = last.current.y + g.dy;
          // Pushed past an edge it tucks away; pulled back out it returns.
          snap(x, y, x < -GUIDE * 0.2 || x > width - GUIDE * 0.8);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, height],
  );

  return (
    <>
      <Animated.View {...responder.panHandlers} style={[styles.guide, { transform: pos.getTranslateTransform(), opacity: enabled ? 1 : 0.35 }]}>
        <Pressable
          onPress={() => {
            if (tucked) return snap(last.current.x, last.current.y, false);
            if (!enabled) return toast('Add sounds first — the guide suggests patterns for them');
            setOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={enabled ? 'AI Guide: starter patterns' : 'AI Guide (add sounds to enable)'}
          style={styles.guideBtn}
        >
          <Icon name="ai" size={26} color={color.bg} />
        </Pressable>
      </Animated.View>
      <Sheet visible={open} onClose={() => setOpen(false)} title="AI Guide · try these patterns">
        <View style={{ gap: space.md }}>
          {suggestions.length === 0 && <Text style={font.body}>Add a few sounds to get pattern ideas.</Text>}
          {suggestions.map((s) => (
            <View key={s.id} style={styles.suggestion}>
              <Text style={font.heading}>{s.title}</Text>
              <Text style={font.caption}>{s.style} · {s.tempoBpm} BPM</Text>
              <Text style={font.body}>{s.description}</Text>
              <View style={styles.row}>
                <Button label="Preview" icon="play" onPress={() => previewSuggestion(s)} style={{ flex: 1 }} />
                <Button label="Manual" icon="pads" onPress={() => { useSuggestionAsTake(s); setOpen(false); toast('Loaded as a take — press play'); }} style={{ flex: 1 }} />
                <Button label="AI" icon="ai" onPress={() => { useSuggestionInAi(s); setOpen(false); toast('Prompt ready — tap Generate'); }} style={{ flex: 1 }} />
              </View>
            </View>
          ))}
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  pad: { borderRadius: radius.card, borderWidth: 2, justifyContent: 'space-between' },
  padEmpty: { borderRadius: radius.card, borderWidth: 1, borderStyle: 'dashed', borderColor: color.line, alignItems: 'center', justifyContent: 'center' },
  padName: { color: color.text, fontSize: 13, fontWeight: '600' },
  stepBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: color.elevated, alignItems: 'center', justifyContent: 'center' },
  stepTxt: { color: color.text, fontSize: 22, fontWeight: '600' },
  trimBox: { position: 'relative', borderRadius: radius.card, overflow: 'hidden', backgroundColor: color.bg, padding: 4 },
  trimShade: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(11,13,18,0.75)' },
  transport: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  emptyBox: { marginTop: space.sm, padding: space.lg, gap: space.sm, borderRadius: radius.panel, backgroundColor: color.surface },
  promptBox: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, padding: space.md, borderRadius: radius.panel, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  promptInput: { flex: 1, minHeight: 72, color: color.text, fontSize: 16, textAlignVertical: 'top' },
  job: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.card, backgroundColor: color.surface },
  bar: { height: 6, borderRadius: 3, backgroundColor: color.line, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: color.cyan },
  preview: { marginTop: space.xl, padding: space.lg, gap: space.md, borderRadius: radius.panel, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  playBig: { width: 64, height: 64, borderRadius: 32, backgroundColor: color.text, alignItems: 'center', justifyContent: 'center' },
  guide: { position: 'absolute', left: 0, top: 0, zIndex: 50, elevation: 12 },
  guideBtn: { width: GUIDE, height: GUIDE, borderRadius: GUIDE / 2, backgroundColor: color.violet, alignItems: 'center', justifyContent: 'center' },
  suggestion: { padding: space.md, gap: space.sm, borderRadius: radius.card, backgroundColor: color.bg },
});
