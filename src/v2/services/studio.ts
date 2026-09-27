import * as FileSystem from 'expo-file-system';
import { create } from 'zustand';

import { textToLyrics } from '../ai/lyricsV2';
import WorldJamAudio from 'worldjam-audio';

import type { Capture, PadSettings, PerformanceEvent, StudioSession, StudioSource, Track } from '../contracts/library';
import type { LayerRole, MusicPlan, NoteName, PlanLyrics, ScaleId, StyleId } from '../contracts/musicPlan';
import type { PlannerCapture } from '../ai/fallback';
import { suggestionToPerformance, type GuideSuggestion } from '../ai/guide';
import { describeFeatures, roleForCapture } from '../ai/kb/rules';
import { styleSpec } from '../ai/kb/styles';
import { editPlan, generatePlan } from '../ai/planner';
import { normalizeKey } from '../ai/validator';
import { compilePlan, RENDERER_VERSION, type InventoryItem } from '../audio/planCompiler';
import { DEFAULT_QUANTIZE, performanceToGraph, performanceToPlan, quantizePerformance, type QuantizeSettings } from '../audio/performance';
import { TakeScheduler, type TakeState } from '../audio/scheduler';
import { KB_VERSION } from '../ai/kb/rules';
import { SYSTEM_PROMPT_VERSION } from '../ai/context';
import { captureAudioPath, getAsset } from './media';
import { deleteCapture, mediaStore } from './capture';
import { compileDeps, currentLlm, engineLatencyMs, renderToFile } from './engineLink';
import { getLibrary, notifyLibraryChanged } from './library';
import { stop as stopPlayer } from './player';

export const MAX_PADS = 64;
const DEFAULT_PAD: PadSettings = { gainDb: 0, pan: 0, pitchSemitones: 0, trimStartMs: 0, trimEndMs: null, loop: false, muted: false };

export type Stage = 'ANALYZING' | 'PLANNING' | 'VALIDATING' | 'RENDERING' | 'PRODUCING' | 'MIXING';
export const STAGE_LABEL: Record<Stage, string> = {
  ANALYZING: 'Listening to your sounds',
  PLANNING: 'Arranging',
  VALIDATING: 'Checking the arrangement',
  RENDERING: 'Rendering',
  PRODUCING: 'Producing with ACE-Step',
  MIXING: 'Mixing and mastering',
};

export interface Take {
  /** As played (latency-compensated). */
  raw: PerformanceEvent[];
  /** After quantize — what plays and what is saved. */
  events: PerformanceEvent[];
  lengthMs: number;
  accuracy: number;
}

export interface Preview {
  plan: MusicPlan;
  uri: string;
  peaks: number[];
  durationMs: number;
  mode: 'AI' | 'MANUAL';
  source: string;
  notes: string[];
  produced: boolean;
  prompt: string | null;
}

interface StudioState {
  session: StudioSession | null;
  captures: Record<string, Capture>;
  loading: boolean;
  mode: 'MANUAL' | 'AI';
  // manual
  recording: boolean;
  liveEvents: PerformanceEvent[];
  loopingPads: number[];
  take: Take | null;
  takeState: TakeState;
  quantize: QuantizeSettings;
  metronome: boolean;
  // ai
  prompt: string;
  style: StyleId | null;
  durationSec: number;
  job: { stage: Stage; progress: number } | null;
  error: string | null;
  preview: Preview | null;
  productionAmount: number;
  lyrics: PlanLyrics | null;
  /** Saved lyric the studio lyrics came from — linked to the track on save. */
  lyricId: string | null;
  /** AI mode timing (same controls as Manual); grid 0 = the style's own feel. */
  aiTiming: QuantizeSettings;
  /** Add a Stable Audio Open Small atmosphere layer (your words + the genre's instruments). */
  aiTexture: boolean;
}

export const useStudio = create<StudioState>(() => ({
  session: null,
  captures: {},
  loading: false,
  mode: 'AI',
  recording: false,
  liveEvents: [],
  loopingPads: [],
  take: null,
  takeState: 'idle',
  quantize: DEFAULT_QUANTIZE,
  metronome: true,
  prompt: '',
  style: null,
  durationSec: 30,
  job: null,
  error: null,
  preview: null,
  productionAmount: 0.6,
  lyrics: null,
  lyricId: null,
  aiTiming: { grid: 0, strength: 0.85, swing: 0 },
  aiTexture: false,
}));

/** Last hit time per pad (ms) — the soundboard flashes a pad when it sounds, live or from a take. */
export const usePadHits = create<Record<number, number>>(() => ({}));
const flash = (padIndex: number) => usePadHits.setState({ [padIndex]: Date.now() });

const set = useStudio.setState;
const get = useStudio.getState;

// ---------------------------------------------------------------- engine glue

const sampleRate = () => {
  try {
    return WorldJamAudio.sampleRate() || 48000;
  } catch {
    return 48000;
  }
};
const dbToGain = (db: number) => 10 ** (db / 20);
const enginePan = (pan: number) => (pan + 1) / 2;

function padOf(captureId: string): number | null {
  return get().session?.sources.find((s) => s.captureId === captureId)?.padIndex ?? null;
}

function sourceAt(padIndex: number): StudioSource | undefined {
  return get().session?.sources.find((s) => s.padIndex === padIndex);
}

async function loadPad(src: StudioSource): Promise<boolean> {
  const c = get().captures[src.captureId];
  if (!c || !WorldJamAudio.loadSampleFromWav) return false;
  const path = await captureAudioPath(c);
  if (!path) return false;
  const s = src.settings;
  return WorldJamAudio.loadSampleFromWav(src.padIndex, path, 1, s.trimStartMs / 1000, s.trimEndMs != null ? s.trimEndMs / 1000 : 0);
}

const scheduler = new TakeScheduler({
  now: () => WorldJamAudio.currentFrame(),
  sampleRate,
  triggerAt: (e, frame) => {
    const src = sourceAt(e.padIndex);
    if (!src || src.settings.muted) return;
    const s = src.settings;
    const lead = ((frame - WorldJamAudio.currentFrame()) / sampleRate()) * 1000;
    setTimeout(() => flash(e.padIndex), Math.max(0, lead));
    WorldJamAudio.triggerAtPitched?.(e.padIndex, dbToGain(s.gainDb) * e.velocity, enginePan(s.pan), frame, 2 ** (s.pitchSemitones / 12), false);
  },
  silence: () => WorldJamAudio.stopAllVoices(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
});
scheduler.onState = (s) => set({ takeState: s });

// ---------------------------------------------------------------- session

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const s = get().session;
    if (!s) return;
    const lib = await getLibrary();
    const saved = await lib.sessions.save({ ...s, style: get().style, plan: get().preview?.plan ?? s.plan, performance: get().take?.events ?? s.performance });
    if (get().session?.id === saved.id) set({ session: { ...get().session!, draftVersion: saved.draftVersion } });
  }, 600);
}

function update(session: StudioSession): void {
  set({ session: { ...session, dirty: true } });
  persist();
}

/** Opens the most recent session (or a given one), loading its sounds onto the pads. */
export async function openSession(id?: string): Promise<void> {
  set({ loading: true, error: null });
  try {
    const lib = await getLibrary();
    let session = id ? await lib.sessions.get(id) : (await lib.sessions.listRecent(1))[0] ?? null;
    if (!session) session = await lib.sessions.create({ name: 'Session', mode: 'AI', bpm: 92, key: null, scale: null, style: null, sources: [], performance: [], plan: null, lyricId: null, padLayout: 'auto' });
    const caps = await lib.captures.getMany(session.sources.map((s) => s.captureId));
    const byId = Object.fromEntries(caps.map((c) => [c.id, c]));
    // Sounds deleted elsewhere drop out of the session.
    const sources = session.sources.filter((s) => byId[s.captureId]);
    session = { ...session, sources };
    set({ session, captures: byId, style: session.style, mode: session.mode, take: null, preview: null, job: null });
    for (const s of sources) await loadPad(s);
    if (session.performance.length) applyTake(session.performance, session.performance[session.performance.length - 1].timeMs + 500, 0);
  } catch (err) {
    set({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    set({ loading: false });
  }
}

/** Render files live in v2/temp until saved; only those may ever be deleted by the studio. */
const isTemp = (uri: string) => uri.includes('/v2/temp/');

export async function newSession(): Promise<void> {
  scheduler.stop();
  const lib = await getLibrary();
  const s = await lib.sessions.create({ name: 'Session', mode: get().mode, bpm: 92, key: null, scale: null, style: null, sources: [], performance: [], plan: null, lyricId: null, padLayout: 'auto' });
  set({ session: s, captures: {}, take: null, preview: null, job: null, error: null, prompt: '', lyrics: null, lyricId: null });
}

export async function addSources(captureIds: string[]): Promise<void> {
  const s = get().session;
  if (!s) return;
  const lib = await getLibrary();
  const fresh = captureIds.filter((id) => !s.sources.some((x) => x.captureId === id));
  const caps = await lib.captures.getMany(fresh);
  const used = new Set(s.sources.map((x) => x.padIndex));
  const added: StudioSource[] = [];
  for (const c of caps) {
    let pad = 0;
    while (used.has(pad) && pad < MAX_PADS) pad++;
    if (pad >= MAX_PADS) break;
    used.add(pad);
    added.push({ captureId: c.id, padIndex: pad, settings: { ...DEFAULT_PAD }, role: null });
  }
  set({ captures: { ...get().captures, ...Object.fromEntries(caps.map((c) => [c.id, c])) } });
  update({ ...s, sources: [...s.sources, ...added] });
  for (const a of added) await loadPad(a);
}

/** Takes a sound out of the session; session-only drafts are deleted, library sounds stay in My Jams. */
export async function removeSource(captureId: string, opts: { deleteFromLibrary?: boolean } = {}): Promise<void> {
  const s = get().session;
  if (!s) return;
  const src = s.sources.find((x) => x.captureId === captureId);
  if (src) WorldJamAudio.clearSlot(src.padIndex);
  const cap = get().captures[captureId];
  update({ ...s, sources: s.sources.filter((x) => x.captureId !== captureId) });
  const { [captureId]: _removed, ...rest } = get().captures;
  set({ captures: rest });
  if (opts.deleteFromLibrary || (cap && !cap.inLibrary)) await deleteCapture(captureId);
}

export async function setPad(padIndex: number, patch: Partial<PadSettings>): Promise<void> {
  const s = get().session;
  if (!s) return;
  const sources = s.sources.map((x) => (x.padIndex === padIndex ? { ...x, settings: { ...x.settings, ...patch } } : x));
  update({ ...s, sources });
  if (patch.trimStartMs !== undefined || patch.trimEndMs !== undefined) {
    const src = sources.find((x) => x.padIndex === padIndex);
    if (src) await loadPad(src);
  }
}

export function setRole(captureId: string, role: LayerRole | null): void {
  const s = get().session;
  if (!s) return;
  update({ ...s, sources: s.sources.map((x) => (x.captureId === captureId ? { ...x, role } : x)) });
}

export function setBpm(bpm: number): void {
  const s = get().session;
  if (!s) return;
  update({ ...s, bpm: Math.round(Math.min(180, Math.max(60, bpm))) });
  if (get().metronome && get().recording) WorldJamAudio.setMetronome(true, get().session!.bpm);
}

export function setPadLayout(padLayout: StudioSession['padLayout']): void {
  const s = get().session;
  if (s) update({ ...s, padLayout });
}

export function setMode(mode: 'MANUAL' | 'AI'): void {
  scheduler.stop();
  set({ mode });
  const s = get().session;
  if (s) update({ ...s, mode });
}

// Tap tempo: the average of the last few intervals, reset after a pause.
let taps: number[] = [];
export function tapTempo(): number | null {
  const t = Date.now();
  if (taps.length && t - taps[taps.length - 1] > 2000) taps = [];
  taps.push(t);
  taps = taps.slice(-6);
  if (taps.length < 3) return null;
  const gaps = taps.slice(1).map((x, i) => x - taps[i]);
  const bpm = 60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length);
  setBpm(bpm);
  return Math.round(bpm);
}

// ---------------------------------------------------------------- pads + live recording

let recStartFrame = 0;

function elapsedMs(): number {
  return ((WorldJamAudio.currentFrame() - recStartFrame) / sampleRate()) * 1000;
}

/** Tap on a pad: plays it (or toggles a looping pad) and records the hit while recording. */
export function triggerPad(padIndex: number, velocity = 1): void {
  const src = sourceAt(padIndex);
  if (!src || src.settings.muted) return;
  flash(padIndex);
  const s = src.settings;
  const looping = get().loopingPads.includes(padIndex);
  if (s.loop && looping) {
    WorldJamAudio.stopSlot?.(padIndex);
    set({ loopingPads: get().loopingPads.filter((p) => p !== padIndex) });
    if (get().recording) set({ liveEvents: [...get().liveEvents, { padIndex, timeMs: elapsedMs(), velocity, stop: true }] });
    return;
  }
  WorldJamAudio.triggerPitched?.(padIndex, dbToGain(s.gainDb) * velocity, enginePan(s.pan), 2 ** (s.pitchSemitones / 12), s.loop);
  if (s.loop) set({ loopingPads: [...get().loopingPads, padIndex] });
  if (get().recording) set({ liveEvents: [...get().liveEvents, { padIndex, timeMs: elapsedMs(), velocity }] });
}

export function startRecording(): void {
  if (get().recording) return;
  scheduler.stop();
  stopPlayer();
  recStartFrame = WorldJamAudio.currentFrame();
  const bpm = get().session?.bpm ?? 92;
  if (get().metronome) WorldJamAudio.setMetronome(true, bpm);
  set({ recording: true, liveEvents: [] });
}

export function stopRecording(): void {
  if (!get().recording) return;
  const lengthMs = elapsedMs();
  WorldJamAudio.setMetronome(false, get().session?.bpm ?? 92);
  for (const p of get().loopingPads) WorldJamAudio.stopSlot?.(p);
  const raw = get().liveEvents;
  set({ recording: false, loopingPads: [] });
  if (raw.length === 0) return;
  applyTake(raw, lengthMs);
}

function applyTake(raw: PerformanceEvent[], lengthMs: number, latency = engineLatencyMs()): void {
  const bpm = get().session?.bpm ?? 92;
  const q = quantizePerformance(raw, bpm, get().quantize, latency);
  set({ take: { raw, events: q.events, lengthMs, accuracy: q.accuracy } });
  scheduler.load(q.events, lengthMs);
  persist();
}

export function setQuantize(q: Partial<QuantizeSettings>): void {
  set({ quantize: { ...get().quantize, ...q } });
  const t = get().take;
  // Re-quantize from what was played; latency was already removed from raw.
  if (t) applyTake(t.raw, t.lengthMs, 0);
}

export const playTake = () => {
  stopPlayer();
  scheduler.play();
};
export const pauseTake = () => scheduler.pause();
export const stopTake = () => scheduler.stop();
export const takePosition = () => scheduler.position;
export function clearTake(): void {
  scheduler.stop();
  set({ take: null });
  persist();
}

export function setMetronome(on: boolean): void {
  set({ metronome: on });
  if (!on) WorldJamAudio.setMetronome(false, get().session?.bpm ?? 92);
  else if (get().recording) WorldJamAudio.setMetronome(true, get().session?.bpm ?? 92);
}

/** AI Guide → Manual: the suggestion becomes the current take (two bars), at its tempo. */
export function useSuggestionAsTake(s: GuideSuggestion): void {
  setBpm(s.tempoBpm);
  const perf = suggestionToPerformance(s, padOf, 2);
  // Guide patterns are already on the grid: no latency to remove.
  applyTake(perf.events, perf.lengthMs, 0);
  const sess = get().session;
  if (sess) for (const part of s.parts) setRole(part.captureId, part.role);
  set({ style: s.style, mode: 'MANUAL' });
}

/** AI Guide → AI: fill the prompt and style. */
export function useSuggestionInAi(s: GuideSuggestion): void {
  set({ prompt: s.prompt, style: s.style, mode: 'AI' });
  const sess = get().session;
  if (sess) for (const part of s.parts) setRole(part.captureId, part.role);
}

/** AI Guide preview: two bars of the suggestion on the pads, without touching the take. */
export function previewSuggestion(s: GuideSuggestion): void {
  const perf = suggestionToPerformance(s, padOf, 2);
  scheduler.load(perf.events, perf.lengthMs);
  scheduler.play();
  scheduler.onEnd = () => {
    scheduler.onEnd = null;
    const t = get().take;
    if (t) scheduler.load(t.events, t.lengthMs);
  };
}

// ---------------------------------------------------------------- AI generation

let jobToken = 0;

export function plannerCaptures(): PlannerCapture[] {
  const s = get().session;
  if (!s) return [];
  return s.sources
    .map((src) => {
      const c = get().captures[src.captureId];
      if (!c) return null;
      const pc: PlannerCapture = { id: c.id, name: c.name, description: c.description, type: c.type, features: c.features, detectedLabel: c.detectedLabel, role: (src.role as LayerRole | null) ?? null };
      return pc;
    })
    .filter((c): c is PlannerCapture => c !== null);
}

async function inventory(): Promise<Record<string, InventoryItem>> {
  const out: Record<string, InventoryItem> = {};
  for (const c of Object.values(get().captures)) {
    const path = await captureAudioPath(c);
    if (path) out[c.id] = { path, durationSec: (c.durationMs || (c.features?.durationSec ?? 1) * 1000) / 1000, features: c.features };
  }
  return out;
}

/** The user's voice fixes tempo and key, so the music is built around it. */
function voiceLock(): { tempoBpm?: number | null; key?: NoteName | null; scale?: ScaleId | null } | undefined {
  const voice = Object.values(get().captures).find((c) => (c.type === 'HUM' || c.type === 'VOCAL') && c.features?.melody);
  const m = voice?.features?.melody;
  if (!m) return undefined;
  const k = normalizeKey(m.key ?? '');
  const tempo = m.tempoBpm && m.tempoBpm >= 60 && m.tempoBpm <= 180 ? Math.round(m.tempoBpm) : null;
  return { tempoBpm: tempo, key: k.key, scale: k.scale ?? (m.key?.includes('minor') ? 'minor' : m.key ? 'major' : null) };
}

async function renderPreview(plan: MusicPlan, token: number, opts: { production?: { path: string; durationSec: number; amount: number } | null } = {}): Promise<Preview | null> {
  set({ job: { stage: 'RENDERING', progress: 0 } });
  const graph = await compilePlan(plan, await inventory(), compileDeps, { production: opts.production ?? null, timing: get().aiTiming });
  if (token !== jobToken) return null;
  set({ job: { stage: 'MIXING', progress: 0 } });
  const s = await mediaStore();
  const uri = s.tempUri('wav');
  const r = await renderToFile(graph, uri, (p) => token === jobToken && set({ job: { stage: 'MIXING', progress: p } }));
  if (token !== jobToken) {
    void FileSystem.deleteAsync(uri, { idempotent: true });
    return null;
  }
  return { plan, uri, peaks: r.peaks, durationMs: Math.round(r.durationSec * 1000), mode: 'AI', source: '', notes: [], produced: !!opts.production, prompt: get().prompt || null };
}

function replacePreview(p: Preview): void {
  const old = get().preview;
  if (old && old.uri !== p.uri && isTemp(old.uri)) void FileSystem.deleteAsync(old.uri, { idempotent: true }).catch(() => {});
  stopPlayer();
  set({ preview: p });
  const s = get().session;
  if (s) update({ ...s, plan: p.plan, style: p.plan.style, bpm: p.plan.tempoBpm });
}

async function runJob(fn: (token: number) => Promise<void>): Promise<void> {
  const token = ++jobToken;
  set({ error: null, job: { stage: 'ANALYZING', progress: 0 } });
  try {
    await fn(token);
  } catch (err) {
    if (token === jobToken) set({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    if (token === jobToken) set({ job: null });
  }
}

export function generate(): Promise<void> {
  return runJob(async (token) => {
    const caps = plannerCaptures();
    if (caps.length === 0) throw new Error('Add at least one sound first.');
    const out = await generatePlan(
      { captures: caps, prompt: get().prompt, style: get().style, durationSec: get().durationSec, lock: voiceLock(), lyrics: get().lyrics, onStage: (st) => token === jobToken && set({ job: { stage: st, progress: 0 } }) },
      currentLlm(),
    );
    if (token !== jobToken) return;
    const plan = get().aiTexture ? withTexture(out.plan, get().prompt) : out.plan;
    const p = await renderPreview(plan, token);
    if (!p) return;
    const notes = out.source === 'fallback' ? [`Arranged by the built-in director${out.error ? ` (${out.error})` : ''}`] : out.repairs.length ? [`${out.repairs.length} fix(es) applied`] : [];
    replacePreview({ ...p, source: out.source, notes });
    await logPrompt('PLAN', out.plan);
  });
}

/** Renders the session's saved plan again (sessions keep plans, not render files). */
export function rerender(): Promise<void> {
  return runJob(async (token) => {
    const plan = get().preview?.plan ?? get().session?.plan;
    if (!plan) throw new Error('Nothing to render yet.');
    const p = await renderPreview(plan, token);
    if (p) replacePreview({ ...p, source: 'saved', notes: [] });
  });
}

export function editPreview(instruction: string): Promise<void> {
  return runJob(async (token) => {
    const base = get().preview?.plan ?? get().session?.plan;
    if (!base) throw new Error('Generate a track first.');
    set({ job: { stage: 'PLANNING', progress: 0 } });
    const out = await editPlan(base, instruction, plannerCaptures(), currentLlm(), voiceLock());
    if (token !== jobToken) return;
    const p = await renderPreview(out.plan, token);
    if (!p) return;
    replacePreview({ ...p, source: out.source, notes: [out.summary || out.applied.join(', ') || 'No change'], prompt: instruction });
    await logPrompt('EDIT', out.plan, instruction);
  });
}

/** Manual take → plan → prompt edit → AI preview ("Enhance with AI"). */
export function enhanceTake(instruction: string): Promise<void> {
  return runJob(async (token) => {
    const t = get().take;
    const s = get().session;
    if (!t || !s) throw new Error('Record something first.');
    const roles = Object.fromEntries(s.sources.map((x) => [x.captureId, (x.role as LayerRole | null) ?? roleForCapture(get().captures[x.captureId])]));
    const base = performanceToPlan(t.events, s.sources, roles, { bpm: s.bpm, lengthMs: t.lengthMs, style: get().style ?? 'chill', durationSec: get().durationSec });
    set({ job: { stage: 'PLANNING', progress: 0 } });
    const out = instruction.trim() ? await editPlan(base, instruction, plannerCaptures(), currentLlm()) : { plan: base, summary: 'Your take, arranged into a song', applied: [], rejected: [], source: 'fallback' as const, error: null };
    if (token !== jobToken) return;
    const p = await renderPreview(out.plan, token);
    if (!p) return;
    replacePreview({ ...p, source: 'manual+ai', notes: [out.summary], prompt: instruction || null });
    set({ mode: 'AI' });
  });
}

/**
 * ACE-Step production pass: render the capture bed (without the voice), let
 * ACE-Step re-produce it in the plan's style, then blend it under the user's
 * sounds and voice. Optional and slow (~2–3 min on the phone).
 */
/**
 * ACE-Step prompt: the user's own words first (never collapsed to a style),
 * then the genre's signature instruments and feel, what the captured sounds
 * are like, and the drum policy — drum-led genres keep generated drums, the
 * rest ask for none so the user's objects stay the beat.
 */
export function productionCaption(plan: MusicPlan, userPrompt: string | null): string {
  const spec = styleSpec(plan.style);
  const sounds = Object.values(get().captures)
    .filter((c) => c.type !== 'HUM' && c.type !== 'VOCAL')
    .slice(0, 4)
    .map((c) => describeFeatures(c.features))
    .filter(Boolean);
  const parts = [
    userPrompt?.trim() || null,
    spec.caption,
    spec.instruments,
    plan.mood ?? null,
    sounds.length ? `built around ${sounds.join('; ')}` : null,
    spec.drumLed ? null : 'no drums',
    `${plan.tempoBpm} bpm`,
    'instrumental',
  ];
  return parts.filter(Boolean).join(', ').slice(0, 480);
}

export function produce(): Promise<void> {
  return runJob(async (token) => {
    const preview = get().preview;
    if (!preview) throw new Error('Generate a track first.');
    // Native returns null when ready, else the reason; a build without the function cannot produce.
    const reason = typeof WorldJamAudio.aceStepUnavailableReason === 'function' && typeof WorldJamAudio.aceStepGenerate === 'function'
      ? WorldJamAudio.aceStepUnavailableReason()
      : 'not in this build';
    if (reason) throw new Error(`AI producer unavailable: ${reason}`);
    const plan = preview.plan;
    set({ job: { stage: 'RENDERING', progress: 0 } });
    const inv = await inventory();
    const bedGraph = await compilePlan(plan, inv, compileDeps, { excludeRoles: ['vocal'], timing: get().aiTiming });
    const s = await mediaStore();
    const bedUri = s.tempUri('wav');
    await renderToFile(bedGraph, bedUri);
    if (token !== jobToken) return;
    set({ job: { stage: 'PRODUCING', progress: 0 } });
    const sub = WorldJamAudio.addListener?.('onAceProgress', (e) => token === jobToken && set({ job: { stage: 'PRODUCING', progress: e.progress } }));
    const request = {
      task_type: 'cover-nofsq',
      caption: productionCaption(plan, preview.prompt),
      lyrics: '[Instrumental]',
      bpm: plan.tempoBpm,
      keyscale: `${plan.key} ${plan.scale === 'major' || plan.scale === 'mixolydian' || plan.scale === 'pentatonic_major' ? 'major' : 'minor'}`,
      duration: Math.round(plan.durationSec + 1),
      // Fresh seed per press: the same words never hand back a stale take.
      seed: Math.floor(Math.random() * 2_147_483_647),
      inference_steps: 8,
      audio_cover_strength: 0.4,
      output_format: 'wav16',
    };
    let res;
    try {
      res = await WorldJamAudio.aceStepGenerate!(JSON.stringify(request), bedUri.replace(/^file:\/\//, ''), `${FileSystem.documentDirectory?.replace(/^file:\/\//, '')}v2/temp`, 7);
    } finally {
      sub?.remove();
      void FileSystem.deleteAsync(bedUri, { idempotent: true });
    }
    if (token !== jobToken) return;
    if (!res?.ok || !res.path) throw new Error(res?.error ?? 'AI producer failed');
    const p = await renderPreview(plan, token, { production: { path: res.path, durationSec: plan.durationSec + 1, amount: get().productionAmount } });
    void FileSystem.deleteAsync(`file://${res.path}`, { idempotent: true });
    if (!p) return;
    replacePreview({ ...p, source: preview.source, notes: [`Produced with ACE-Step in ${Math.round((res.elapsedMs ?? 0) / 1000)} s`], prompt: preview.prompt });
  });
}

export function cancelJob(): void {
  jobToken++;
  WorldJamAudio.aceStepCancel?.();
  set({ job: null });
}

/** Manual take → rendered preview (exact, quantized), ready to save as a track. */
export function renderTake(): Promise<void> {
  return runJob(async (token) => {
    const t = get().take;
    const s = get().session;
    if (!t || !s) throw new Error('Record something first.');
    set({ job: { stage: 'MIXING', progress: 0 } });
    const graph = performanceToGraph(t.events, s.sources, await inventory(), { lengthMs: t.lengthMs });
    const store = await mediaStore();
    const uri = store.tempUri('wav');
    const r = await renderToFile(graph, uri, (p) => token === jobToken && set({ job: { stage: 'MIXING', progress: p } }));
    if (token !== jobToken) return;
    const roles = Object.fromEntries(s.sources.map((x) => [x.captureId, (x.role as LayerRole | null) ?? roleForCapture(get().captures[x.captureId])]));
    const plan = performanceToPlan(t.events, s.sources, roles, { bpm: s.bpm, lengthMs: t.lengthMs, style: get().style ?? 'chill' });
    replacePreview({ plan, uri, peaks: r.peaks, durationMs: Math.round(r.durationSec * 1000), mode: 'MANUAL', source: 'manual', notes: [`Timing ${Math.round(t.accuracy * 100)}%`], produced: false, prompt: null });
  });
}

async function logPrompt(kind: 'PLAN' | 'EDIT', plan: MusicPlan, prompt?: string): Promise<void> {
  const s = get().session;
  const lib = await getLibrary();
  await lib.prompts.add({ sessionId: s?.id ?? null, trackId: null, kind, prompt: prompt ?? get().prompt ?? '', planJson: JSON.stringify(plan) }).catch(() => {});
}

/** Saves the current preview as a Track in My Jams (the file moves into tracks/audio). */
export async function saveTrack(name: string, description: string, lyricId: string | null): Promise<Track> {
  const preview = get().preview;
  if (!preview) throw new Error('Nothing to save yet.');
  stopPlayer();
  const store = await mediaStore();
  const lib = await getLibrary();
  // A preview that is already a saved track is copied, never moved.
  let from = preview.uri;
  if (!isTemp(from)) {
    from = store.tempUri('wav');
    await FileSystem.copyAsync({ from: preview.uri, to: from });
  }
  const asset = await store.commit(from, {
    kind: preview.mode === 'AI' ? 'AI_TRACK' : 'MANUAL_TRACK',
    dir: 'track',
    ext: 'wav',
    mimeType: 'audio/wav',
    durationMs: preview.durationMs,
    sampleRate: 48000,
    channels: 2,
  });
  const caps = get().captures;
  const sources = preview.plan.layers
    .filter((l) => l.source.kind === 'capture')
    .map((l) => (l.source.kind === 'capture' ? l.source.captureId : ''))
    .filter((id, i, a) => id && a.indexOf(id) === i && caps[id])
    .map((id) => ({ captureId: id, name: caps[id].name, description: caps[id].description, role: preview.plan.layers.find((l) => l.source.kind === 'capture' && l.source.captureId === id)?.role ?? null }));
  const llm = currentLlm();
  const track = await lib.tracks.create({
    name,
    description,
    mode: preview.mode,
    audioAssetId: asset.id,
    durationMs: preview.durationMs,
    bpm: preview.plan.tempoBpm,
    key: preview.plan.key,
    scale: preview.plan.scale,
    style: preview.plan.style,
    plan: preview.plan,
    peaks: preview.peaks,
    lyricId,
    prompt: preview.prompt,
    sources,
    versions: { model: preview.mode === 'AI' ? llm?.model ?? 'built-in director' : null, kb: KB_VERSION, systemPrompt: SYSTEM_PROMPT_VERSION, renderer: RENDERER_VERSION },
  });
  set({ preview: { ...preview, uri: store.uri(asset.path) } });
  notifyLibraryChanged();
  return track;
}

export function setPrompt(prompt: string): void {
  set({ prompt });
}
export function setStyle(style: StyleId | null): void {
  set({ style });
}
export function setDuration(durationSec: number): void {
  set({ durationSec });
}
export function setProductionAmount(amount: number): void {
  set({ productionAmount: amount });
}
export function setLyrics(lyrics: PlanLyrics | null, lyricId: string | null = null): void {
  set({ lyrics, lyricId: lyrics ? lyricId : null });
}
export function setAiTexture(on: boolean): void {
  set({ aiTexture: on });
}

/** Adds an AI texture bed under the fuller sections (skipped when the plan already has one). */
function withTexture(plan: MusicPlan, userPrompt: string): MusicPlan {
  if (plan.layers.some((l) => l.source.kind === 'texture')) return plan;
  const spec = styleSpec(plan.style);
  const prompt = [userPrompt.trim() || null, spec.instruments, plan.mood ?? null, spec.drumLed ? null : 'no drums', `${plan.tempoBpm} bpm`, `${plan.key} ${plan.scale}`]
    .filter(Boolean)
    .join(', ')
    .slice(0, 160);
  const id = 'ai_texture';
  return {
    ...plan,
    layers: [...plan.layers, { id, source: { kind: 'texture', prompt }, role: 'texture', gainDb: -11, pan: 0 }],
    sections: plan.sections.map((sec) => (sec.energy >= 0.5 ? { ...sec, layers: [...sec.layers, id] } : sec)),
  };
}

export function setAiTiming(t: Partial<QuantizeSettings>): void {
  set({ aiTiming: { ...get().aiTiming, ...t } });
}

/** Opens a saved track in a new session: its sounds on the pads and its plan ready to edit. */
export async function openTrackForEditing(track: Track): Promise<void> {
  await newSession();
  await addSources(track.sources.map((s) => s.captureId));
  const asset = await getAsset(track.audioAssetId);
  if (!track.plan) return;
  const uri = asset ? `${FileSystem.documentDirectory ?? ''}${asset.path}` : null;
  set({
    preview: uri ? { plan: track.plan, uri, peaks: track.peaks, durationMs: track.durationMs, mode: track.mode, source: 'saved', notes: [], produced: false, prompt: track.prompt } : null,
    style: track.plan.style,
    mode: 'AI',
    prompt: '',
  });
  const sess = get().session;
  if (sess) update({ ...sess, plan: track.plan, bpm: track.plan.tempoBpm, style: track.plan.style });
  if (track.lyricId) {
    const l = await (await getLibrary()).lyrics.get(track.lyricId);
    if (l) set({ lyrics: l.structured ?? textToLyrics(l.text, l.name, l.language), lyricId: l.id });
  }
}
