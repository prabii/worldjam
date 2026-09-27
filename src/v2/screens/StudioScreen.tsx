import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Peaks } from '../components/cards';
import { ConfirmDelete } from '../components/ConfirmDelete';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toasts';
import { Button, Chip, Field, IconButton, Screen, Segmented, Sheet } from '../components/ui';
import { STYLE_CHOICES } from '../ai/context';
import { suggestPatterns, type GuideSuggestion } from '../ai/guide';
import { lyricsToText } from '../ai/lyricsV2';
import { roleForCapture } from '../ai/kb/rules';
import type { LayerRole } from '../contracts/musicPlan';
import type { StudioSource } from '../contracts/library';
import { useNav } from '../nav/store';
import { stop as stopPlayer, toggle, usePlayer } from '../services/player';
import { useVoicePrompt } from '../services/speech';
import {
  STAGE_LABEL, cancelJob, clearTake, editPreview, enhanceTake, generate, newSession, openSession, pauseTake, playTake,
  plannerCaptures, previewSuggestion, produce, removeSource, renderTake, rerender, saveTrack, setBpm, setDuration,
  setMetronome, setMode, setPad, setPrompt, setQuantize, setRole, setStyle, startRecording, stopRecording, stopTake,
  tapTempo, triggerPad, useStudio, useSuggestionAsTake, useSuggestionInAi,
} from '../services/studio';
import { color, font, formatDuration, radius, roleColor, space } from '../theme';

const ROLES: LayerRole[] = ['kick', 'snare', 'hat', 'percussion', 'bass', 'chords', 'pad', 'lead', 'vocal', 'texture', 'fx'];
const RING: Record<string, number> = { kick: 0, snare: 0, hat: 0, percussion: 0, bass: 1, chords: 2, pad: 2, lead: 3, vocal: 3, texture: 4, fx: 4 };

export function StudioScreen({ bottomInset }: { bottomInset: number }) {
  const session = useStudio((s) => s.session);
  const loading = useStudio((s) => s.loading);
  const mode = useStudio((s) => s.mode);
  const { push } = useNav();

  useEffect(() => {
    if (!useStudio.getState().session) void openSession();
  }, []);

  const hasSources = (session?.sources.length ?? 0) > 0;

  return (
    <View style={{ flex: 1 }}>
      <Screen scroll bottomInset={bottomInset + 40}>
        <View style={styles.top}>
          <View style={{ flex: 1 }}>
            <Text style={font.title}>Studio</Text>
            <Text style={font.caption}>{session ? `${session.sources.length} sound${session.sources.length === 1 ? '' : 's'} · ${session.bpm} BPM` : loading ? 'Opening…' : ''}</Text>
          </View>
          <IconButton icon="add" label="Add sounds" onPress={() => session && push({ name: 'sourcePicker', sessionId: session.id })} />
          <IconButton icon="repeat" label="New session" onPress={() => void newSession().then(() => toast('New session', 'success'))} />
        </View>

        <Orbit />

        <View style={{ marginTop: space.lg }}>
          <Segmented
            options={[{ value: 'AI', label: 'AI Studio', icon: 'ai' }, { value: 'MANUAL', label: 'Manual', icon: 'pads' }]}
            value={mode}
            onChange={(m) => setMode(m)}
          />
        </View>

        {!hasSources ? (
          <View style={styles.emptyBox}>
            <Text style={font.heading}>Add sounds to start</Text>
            <Text style={font.body}>Pick captures from My Jams or record a new one. Each sound becomes a planet and a pad.</Text>
            <Button label="Add sounds" kind="primary" icon="add" onPress={() => session && push({ name: 'sourcePicker', sessionId: session.id })} style={{ marginTop: space.md }} />
          </View>
        ) : mode === 'MANUAL' ? (
          <ManualPanel />
        ) : (
          <AiPanel />
        )}
        <PreviewPanel />
      </Screen>
      <AiGuide enabled={hasSources} bottomInset={bottomInset} />
    </View>
  );
}

// ---------------------------------------------------------------- Orbit

function Orbit() {
  const session = useStudio((s) => s.session);
  const captures = useStudio((s) => s.captures);
  const [sel, setSel] = useState<StudioSource | null>(null);
  const [confirm, setConfirm] = useState(false);
  const size = Math.min(Dimensions.get('window').width - space.lg * 2, 340);
  const c = size / 2;

  const planets = useMemo(() => {
    const src = session?.sources ?? [];
    const byRing: Record<number, StudioSource[]> = {};
    for (const s of src) {
      const cap = captures[s.captureId];
      const role = (s.role as LayerRole | null) ?? (cap ? roleForCapture(cap) : 'texture');
      const ring = RING[role] ?? 4;
      (byRing[ring] ??= []).push(s);
    }
    const out: Array<{ s: StudioSource; x: number; y: number; role: string; name: string }> = [];
    for (const [ringStr, list] of Object.entries(byRing)) {
      const ring = Number(ringStr);
      const r = 36 + ring * ((c - 44) / 4);
      list.forEach((s, i) => {
        const a = (i / list.length) * Math.PI * 2 + ring * 0.7 - Math.PI / 2;
        const cap = captures[s.captureId];
        out.push({ s, x: c + r * Math.cos(a), y: c + r * Math.sin(a), role: (s.role as string) ?? (cap ? roleForCapture(cap) : 'texture'), name: cap?.name ?? '?' });
      });
    }
    return out;
  }, [session, captures, c]);

  return (
    <View style={[styles.orbit, { width: size, height: size }]}>
      {[0, 1, 2, 3, 4].map((ring) => {
        const r = 36 + ring * ((c - 44) / 4);
        return <View key={ring} style={[styles.ring, { width: r * 2, height: r * 2, borderRadius: r, left: c - r, top: c - r }]} />;
      })}
      <View style={[styles.core, { left: c - 22, top: c - 22 }]}>
        <Icon name="orbit" size={22} color={color.bg} />
      </View>
      {planets.map((p) => (
        <Pressable
          key={p.s.captureId}
          onPress={() => triggerPad(p.s.padIndex)}
          onLongPress={() => setSel(p.s)}
          accessibilityLabel={`${p.name}, ${p.role}. Tap to play, hold for options`}
          style={[styles.planet, { left: p.x - 20, top: p.y - 20, borderColor: roleColor[p.role] ?? color.cyan, opacity: p.s.settings.muted ? 0.35 : 1 }]}
        >
          <Text numberOfLines={1} style={styles.planetText}>{p.name.slice(0, 3)}</Text>
        </Pressable>
      ))}
      <Sheet visible={!!sel} onClose={() => setSel(null)} title={sel ? captures[sel.captureId]?.name ?? 'Sound' : ''}>
        {sel && (
          <View style={{ gap: space.md }}>
            <Text style={font.label}>Role on the orbit</Text>
            <View style={styles.wrap}>
              <Chip label="Auto" selected={!sel.role} onPress={() => { setRole(sel.captureId, null); setSel({ ...sel, role: null }); }} />
              {ROLES.map((r) => (
                <Chip key={r} label={r} selected={sel.role === r} onPress={() => { setRole(sel.captureId, r); setSel({ ...sel, role: r }); }} />
              ))}
            </View>
            <Button label="Remove from session" icon="close" onPress={async () => { await removeSource(sel.captureId); setSel(null); toast('Removed from session'); }} />
            <Button label="Delete from library" kind="danger" icon="delete" onPress={() => setConfirm(true)} />
          </View>
        )}
      </Sheet>
      <ConfirmDelete
        visible={confirm}
        what={sel ? `“${captures[sel.captureId]?.name ?? 'sound'}”` : 'sound'}
        detail="Removes it from this session and deletes it from My Jams."
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          if (sel) await removeSource(sel.captureId, { deleteFromLibrary: true });
          setConfirm(false);
          setSel(null);
          toast('Deleted', 'success');
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------- Manual

function ManualPanel() {
  const session = useStudio((s) => s.session)!;
  const captures = useStudio((s) => s.captures);
  const recording = useStudio((s) => s.recording);
  const take = useStudio((s) => s.take);
  const takeState = useStudio((s) => s.takeState);
  const quantize = useStudio((s) => s.quantize);
  const metronome = useStudio((s) => s.metronome);
  const looping = useStudio((s) => s.loopingPads);
  const job = useStudio((s) => s.job);
  const [padSheet, setPadSheet] = useState<StudioSource | null>(null);
  const [enhance, setEnhance] = useState('');
  const cols = session.sources.length > 9 ? 4 : 3;
  const w = (Math.min(Dimensions.get('window').width, 420) - space.lg * 2 - space.sm * (cols - 1)) / cols;
  const pad = padSheet ? session.sources.find((s) => s.padIndex === padSheet.padIndex) ?? padSheet : null;

  return (
    <View style={{ gap: space.lg, marginTop: space.lg }}>
      <View style={styles.row}>
        <IconButton icon="tap" label="Tap tempo" onPress={() => { const b = tapTempo(); if (b) toast(`${b} BPM`); }} />
        <IconButton icon="back" label="Slower" onPress={() => setBpm(session.bpm - 2)} />
        <Text style={[font.heading, { minWidth: 70, textAlign: 'center' }]}>{session.bpm} BPM</Text>
        <IconButton icon="send" label="Faster" onPress={() => setBpm(session.bpm + 2)} />
        <Chip label={metronome ? 'Click on' : 'Click off'} selected={metronome} onPress={() => setMetronome(!metronome)} />
      </View>

      <View style={styles.grid}>
        {session.sources.map((s) => {
          const cap = captures[s.captureId];
          const role = (s.role as string) ?? (cap ? roleForCapture(cap) : 'texture');
          const on = looping.includes(s.padIndex);
          return (
            <Pressable
              key={s.padIndex}
              onPressIn={() => triggerPad(s.padIndex)}
              onLongPress={() => setPadSheet(s)}
              delayLongPress={450}
              accessibilityLabel={`Pad ${cap?.name ?? ''}`}
              style={({ pressed }) => [styles.pad, { width: w, height: w, borderColor: roleColor[role] ?? color.line, opacity: s.settings.muted ? 0.35 : 1 }, (pressed || on) && styles.padOn]}
            >
              <Text numberOfLines={2} style={styles.padName}>{cap?.name ?? 'Sound'}</Text>
              <Text style={font.caption}>{role}{s.settings.loop ? ' · loop' : ''}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.transport}>
        {recording ? (
          <Button label="Stop" kind="danger" icon="stop" onPress={stopRecording} style={{ flex: 1 }} />
        ) : (
          <Button label={take ? 'Record again' : 'Record'} kind="primary" icon="record" onPress={() => { stopTake(); startRecording(); }} style={{ flex: 1 }} />
        )}
        <IconButton icon={takeState === 'playing' ? 'pause' : 'play'} label={takeState === 'playing' ? 'Pause take' : takeState === 'paused' ? 'Resume take' : 'Play take'} disabled={!take || recording} onPress={() => (takeState === 'playing' ? pauseTake() : playTake())} />
        <IconButton icon="stop" label="Stop take" disabled={!take || takeState === 'idle'} onPress={stopTake} />
        <IconButton icon="delete" label="Clear take" disabled={!take || recording} onPress={() => { clearTake(); toast('Take cleared'); }} />
      </View>
      {recording && <Text style={[font.label, { color: color.pink }]}>● Recording — play the pads</Text>}
      {take && !recording && (
        <Text style={font.label}>Take {formatDuration(take.lengthMs)} · {take.events.length} hits · timing {Math.round(take.accuracy * 100)}%</Text>
      )}

      <View style={{ gap: space.sm }}>
        <Text style={font.label}>Quantize</Text>
        <View style={styles.wrap}>
          {([0, 1, 2, 4] as const).map((g) => (
            <Chip key={g} label={g === 0 ? 'Off' : g === 1 ? '1/4' : g === 2 ? '1/8' : '1/16'} selected={quantize.grid === g} onPress={() => setQuantize({ grid: g })} />
          ))}
          {[0.5, 0.85, 1].map((v) => (
            <Chip key={`s${v}`} label={`Strength ${Math.round(v * 100)}%`} selected={quantize.strength === v} onPress={() => setQuantize({ strength: v })} />
          ))}
          {[0, 0.3, 0.6].map((v) => (
            <Chip key={`w${v}`} label={v === 0 ? 'No swing' : `Swing ${Math.round(v * 100)}%`} selected={quantize.swing === v} onPress={() => setQuantize({ swing: v })} />
          ))}
        </View>
      </View>

      <Button label="Render take" kind="primary" icon="waveform" disabled={!take || recording || !!job} onPress={() => void renderTake()} />
      <Field label="Enhance with AI (optional)" value={enhance} onChangeText={setEnhance} placeholder="e.g. make it lo-fi with a bass line" />
      <Button label="Enhance with AI" icon="ai" disabled={!take || recording || !!job} onPress={() => void enhanceTake(enhance.trim() || 'Turn this into a full track')} />
      <JobBar />

      <Sheet visible={!!pad} onClose={() => setPadSheet(null)} title={pad ? captures[pad.captureId]?.name ?? 'Pad' : ''}>
        {pad && (
          <View style={{ gap: space.md }}>
            <Stepper label="Gain" value={`${pad.settings.gainDb} dB`} onMinus={() => setPad(pad.padIndex, { gainDb: Math.max(-30, pad.settings.gainDb - 2) })} onPlus={() => setPad(pad.padIndex, { gainDb: Math.min(6, pad.settings.gainDb + 2) })} />
            <Stepper label="Pan" value={pad.settings.pan.toFixed(1)} onMinus={() => setPad(pad.padIndex, { pan: Math.max(-1, +(pad.settings.pan - 0.2).toFixed(1)) })} onPlus={() => setPad(pad.padIndex, { pan: Math.min(1, +(pad.settings.pan + 0.2).toFixed(1)) })} />
            <Stepper label="Pitch" value={`${pad.settings.pitchSemitones > 0 ? '+' : ''}${pad.settings.pitchSemitones} st`} onMinus={() => setPad(pad.padIndex, { pitchSemitones: Math.max(-12, pad.settings.pitchSemitones - 1) })} onPlus={() => setPad(pad.padIndex, { pitchSemitones: Math.min(12, pad.settings.pitchSemitones + 1) })} />
            <View style={styles.wrap}>
              <Chip label="Loop" selected={pad.settings.loop} onPress={() => setPad(pad.padIndex, { loop: !pad.settings.loop })} />
              <Chip label="Mute" selected={pad.settings.muted} onPress={() => setPad(pad.padIndex, { muted: !pad.settings.muted })} />
              <Chip label="Test" onPress={() => triggerPad(pad.padIndex)} />
            </View>
          </View>
        )}
      </Sheet>
    </View>
  );
}

function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <View style={styles.row}>
      <Text style={[font.label, { width: 60 }]}>{label}</Text>
      <IconButton icon="back" label={`${label} down`} onPress={onMinus} />
      <Text style={[font.heading, { flex: 1, textAlign: 'center' }]}>{value}</Text>
      <IconButton icon="send" label={`${label} up`} onPress={onPlus} />
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
  const voice = useVoicePrompt((t) => setPrompt(t));

  return (
    <View style={{ gap: space.lg, marginTop: space.lg }}>
      <View style={styles.promptBox}>
        <TextInput
          value={voice.state === 'listening' && voice.partial ? voice.partial : prompt}
          onChangeText={setPrompt}
          placeholder="Describe your track… e.g. chill lo-fi night drive"
          placeholderTextColor={color.textMuted}
          multiline
          style={styles.promptInput}
          accessibilityLabel="Prompt"
        />
        {voice.available && (
          <IconButton
            icon={voice.state === 'listening' ? 'stop' : 'mic'}
            label={voice.state === 'listening' ? 'Stop listening' : 'Speak prompt'}
            onPress={() => (voice.state === 'listening' ? voice.stop() : void voice.start())}
          />
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        <Chip label="Auto style" selected={!style} onPress={() => setStyle(null)} />
        {STYLE_CHOICES.map((s) => (
          <Chip key={s.id} label={s.label} selected={style === s.id} onPress={() => setStyle(s.id)} />
        ))}
      </ScrollView>
      <Segmented options={[{ value: '30', label: '30 s' }, { value: '45', label: '45 s' }, { value: '60', label: '60 s' }]} value={String(durationSec) as '30' | '45' | '60'} onChange={(v) => setDuration(Number(v))} />
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
  const amount = useStudio((s) => s.productionAmount);
  const session = useStudio((s) => s.session);
  const { push, setTab } = useNav();
  const id = preview ? `preview:${preview.uri}` : '';
  const state = usePlayer((s) => (s.activeId === id ? s.state : 'idle'));
  const progress = usePlayer((s) => (s.activeId === id && s.durationMs ? s.positionMs / s.durationMs : 0));
  const [edit, setEdit] = useState('');
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => () => void stopPlayer(), []);
  if (!preview) return null;

  return (
    <View style={styles.preview}>
      <Text style={font.heading}>{preview.plan.title || 'Your track'}</Text>
      <Text style={font.caption}>
        {preview.plan.style} · {preview.plan.tempoBpm} BPM · {preview.plan.key} {preview.plan.scale} · {formatDuration(preview.durationMs)} · {preview.source}
        {preview.produced ? ' · ACE-Step produced' : ''}
      </Text>
      <View style={styles.vinylRow}>
        <Pressable onPress={() => void toggle(id, preview.uri)} style={styles.vinyl} accessibilityRole="button" accessibilityLabel={state === 'playing' ? 'Pause' : 'Play'}>
          <Icon name={state === 'playing' ? 'pause' : 'play'} size={28} color={color.bg} />
        </Pressable>
        <View style={{ flex: 1, gap: space.sm }}>
          <Peaks peaks={preview.peaks} progress={progress} height={48} tint={color.cyan} />
          <IconButton icon="stop" label="Stop" disabled={state === 'idle'} onPress={() => void stopPlayer()} />
        </View>
      </View>
      {preview.notes.length > 0 && <Text style={font.caption}>{preview.notes.slice(0, 3).join(' · ')}</Text>}

      {lyrics && (
        <View style={styles.karaoke}>
          <Text style={font.label}>Lyrics — sing along</Text>
          <Text style={[font.body, { color: color.text }]}>{lyricsToText(lyrics)}</Text>
        </View>
      )}

      <Field label="Change it" value={edit} onChangeText={setEdit} placeholder="e.g. more bass, slower, remove the hats" />
      <View style={styles.row}>
        <Button label="Apply" icon="edit" disabled={!edit.trim() || !!job} onPress={() => { void editPreview(edit.trim()); setEdit(''); }} style={{ flex: 1 }} />
        <Button label="Regenerate" icon="repeat" disabled={!!job} onPress={() => void (preview.mode === 'AI' ? generate() : rerender())} style={{ flex: 1 }} />
      </View>
      <Button label={`AI Producer (ACE-Step) · ${Math.round(amount * 100)}%`} icon="ai" disabled={!!job || preview.produced} onPress={() => void produce()} />
      <View style={styles.row}>
        <Button label="Lyrics" icon="lyrics" onPress={() => push({ name: 'lyricsEditor', captureIds: session?.sources.map((s) => s.captureId) ?? [] })} style={{ flex: 1 }} />
        <Button label="Save track" kind="primary" icon="save" disabled={!!job} onPress={() => { setName(preview.plan.title || 'My track'); setSaving(true); }} style={{ flex: 1 }} />
      </View>

      <Sheet visible={saving} onClose={() => setSaving(false)} title="Save to My Jams">
        <View style={{ gap: space.md }}>
          <Field label="Name" value={name} onChangeText={setName} maxLength={60} />
          <Field label="Description" value={desc} onChangeText={setDesc} multiline maxLength={240} />
          <Text style={font.caption}>Sources: {session?.sources.map((s) => useStudio.getState().captures[s.captureId]?.name).filter(Boolean).join(', ')}</Text>
          <Button
            label="Save"
            kind="primary"
            icon="save"
            busy={busy}
            onPress={async () => {
              setBusy(true);
              try {
                await stopPlayer();
                const t = await saveTrack(name.trim() || 'My track', desc.trim(), null);
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
    </View>
  );
}

// ---------------------------------------------------------------- AI Guide (floating, draggable, tuckable)

const GUIDE = 56;

function AiGuide({ enabled, bottomInset }: { enabled: boolean; bottomInset: number }) {
  const { width, height } = Dimensions.get('window');
  const pos = useRef(new Animated.ValueXY({ x: width - GUIDE - 12, y: height - bottomInset - GUIDE - 140 })).current;
  const last = useRef({ x: width - GUIDE - 12, y: height - bottomInset - GUIDE - 140 });
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
          // Flick past the edge tucks it away; pulling it back out untucks.
          const tuck = x < -GUIDE * 0.2 || x > width - GUIDE * 0.8;
          snap(x, y, tuck);
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
        <ScrollView style={{ maxHeight: height * 0.6 }} contentContainerStyle={{ gap: space.md }}>
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
        </ScrollView>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  orbit: { alignSelf: 'center', position: 'relative' },
  ring: { position: 'absolute', borderWidth: 1, borderColor: color.line },
  core: { position: 'absolute', width: 44, height: 44, borderRadius: 22, backgroundColor: color.cyan, alignItems: 'center', justifyContent: 'center' },
  planet: { position: 'absolute', width: 40, height: 40, borderRadius: 20, borderWidth: 2, backgroundColor: color.elevated, alignItems: 'center', justifyContent: 'center' },
  planetText: { color: color.text, fontSize: 11, fontWeight: '600' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pad: { borderRadius: radius.card, borderWidth: 2, backgroundColor: color.surface, padding: space.sm, justifyContent: 'space-between' },
  padOn: { backgroundColor: color.elevated, transform: [{ scale: 0.96 }] },
  padName: { color: color.text, fontSize: 13, fontWeight: '600' },
  transport: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  emptyBox: { marginTop: space.lg, padding: space.lg, gap: space.sm, borderRadius: radius.panel, backgroundColor: color.surface },
  promptBox: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, padding: space.md, borderRadius: radius.panel, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  promptInput: { flex: 1, minHeight: 72, color: color.text, fontSize: 16, textAlignVertical: 'top' },
  job: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.card, backgroundColor: color.surface },
  bar: { height: 6, borderRadius: 3, backgroundColor: color.line, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: color.cyan },
  preview: { marginTop: space.xl, padding: space.lg, gap: space.md, borderRadius: radius.panel, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  vinylRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  vinyl: { width: 72, height: 72, borderRadius: 36, backgroundColor: color.text, alignItems: 'center', justifyContent: 'center', borderWidth: 6, borderColor: color.violet },
  karaoke: { padding: space.md, borderRadius: radius.card, backgroundColor: color.bg, gap: space.sm },
  guide: { position: 'absolute', left: 0, top: 0, zIndex: 50, elevation: 12 },
  guideBtn: { width: GUIDE, height: GUIDE, borderRadius: GUIDE / 2, backgroundColor: color.violet, alignItems: 'center', justifyContent: 'center' },
  suggestion: { padding: space.md, gap: space.sm, borderRadius: radius.card, backgroundColor: color.bg },
});
