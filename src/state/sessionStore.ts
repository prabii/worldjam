import { create } from 'zustand';
import type {
  ArrangementPlan,
  Loop,
  LoopEvent,
  MusicalRole,
  ObjectCategory,
  Style,
  VocalTake,
  WorldJamObject,
} from '@/types';
import {
  SLOT_ARP,
  SLOT_BASS,
  SLOT_CHORDS,
  SLOT_GUITAR,
  SLOT_PERC,
  SLOT_TEXTURE,
  SLOT_VOCAL,
  generateFromMelody,
  generateTextureClip,
  generateTextureInto,
  textureEngine,
  textureUnavailableReason,
  allocateSlot,
  clearSlot,
  loadSample,
  sampleRate,
  setMetronome,
  startRecording,
  stopAllVoices,
  stopRecording,
  trigger,
} from '@/audio/engine';
import { renderLayer } from '@/audio/synth';
import { encodeWav, mixSession, toBase64 } from '@/audio/render';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { transport } from '@/audio/transport';
import { renderArrangement } from '@/audio/arrangement';
import { applyGroove, describeFeel, directTempo } from '@/audio/groove';
import {
  buildSectionPrompt,
  buildTexturePrompt,
  sectionSeed,
  textureEvents,
  textureSeconds,
  textureSeed,
} from '@/audio/texture';
import {
  SECTION_DENSITY,
  SECTION_GAIN,
  type SectionKind,
} from '@/audio/arrangement';
import { buildSongForm, distinctKinds, renderSong, songBars } from '@/audio/song';
import { assembleBed, bedEvents } from '@/audio/songBed';
import { describeObjects, genreTempo, grooveFor, matchGenre } from '@/audio/genres';
import { monoToStereo, renderMelody, type MelodyInstrument } from '@/audio/melodySynth';
import {
  EMPTY_GRID,
  beatToStep,
  describeGrid,
  gridHitCount,
  gridToEvents,
  gridToPattern,
  layerUserBeat,
  removeRow,
  resizeGrid,
  setStep,
  toggleStep,
  type BeatGrid,
  type GridSteps,
} from '@/audio/beatGrid';
import { cleanCapture, estimateNoiseFloor, findTransientWindow } from '@/dsp/denoise';
import { describeMelody, refineMelody } from '@/dsp/melody';
import { buildRhythmCues, describeCapture } from '@/audio/guidance';
import { guidance, isGuidanceEnabled, setGuidanceEnabled, speakNow } from '@/audio/speech';
import {
  detectKey,
  detectOnsets,
  estimateTempo,
  extractFeatures,
  extractMelody,
  nameFromSound,
  normalisePeak,
  inferRole,
  trimSilence,
} from '@/dsp/analysis';
import {
  DEFAULT_QUANTIZE,
  type QuantizeOptions,
  quantizeLoop,
  timingAccuracy,
  wrapToLoop,
} from '@/dsp/quantize';
import { generatePlan, parseStyleCommand } from '@/ai/gemma';
import { buildFallbackPlan, restylePlan } from '@/ai/fallbackArranger';
import { generateLyrics, type LyricSet } from '@/ai/lyrics';
import {
  deleteSession,
  listSessions,
  loadSession,
  saveSession,
  type SessionSummary,
} from './sessionStorage';

import { colors as themeColors } from '@/theme';

/** Neon accents matching the object outlines in the product mockups. */
const OBJECT_COLORS = themeColors.objectPalette;

/**
 * Disambiguates a generated name against what is already captured.
 *
 * Two cups struck the same way genuinely produce the same name, and a pad
 * grid showing "Tap, Tap, Tap" is no better than "Object, Object, Object".
 */
function uniqueLabel(base: string, existing: { label: string }[]): string {
  const taken = new Set(existing.map((o) => o.label.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 50; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}

export type CaptureTarget =
  | { kind: 'object'; label: string; category: ObjectCategory; x: number; y: number }
  | { kind: 'vocal' };

interface SessionState {
  // --- session data ---
  objects: WorldJamObject[];
  /**
   * Raw mono PCM per slot. The native engine owns its own copy for playback;
   * this mirror exists so the offline renderer can mix without reading back
   * across the bridge.
   */
  pcmBySlot: Map<number, number[]>;
  loops: Loop[];
  vocalTake: VocalTake | null;
  plan: ArrangementPlan | null;
  bpm: number;
  bars: number;
  style: Style;
  key: string | null;

  // --- transient UI state ---
  recording: CaptureTarget | null;
  recordStartedAt: number | null;
  arranging: boolean;
  playing: boolean;
  quantizeOpts: QuantizeOptions;
  /** Accuracy before quantize was applied, so the gain is showable. */
  accuracyBefore: number | null;
  accuracyAfter: number | null;
  lastPlanInfo: string | null;
  statusMessage: string | null;
  /**
   * Plain-language summary of the sung melody, built at capture time and
   * handed to the model so it arranges around the actual tune.
   */
  melodyDescription: string | null;
  /** Reference artists the user named, to steer the production. */
  reference: string | null;
  /** AI-written lyrics for the current arrangement. */
  lyrics: LyricSet | null;
  writingLyrics: boolean;
  /** True while a mixdown is being rendered and written. */
  exporting: boolean;
  /** Path of the most recent export, for sharing without re-rendering. */
  lastExportPath: string | null;

  // --- live performance recording ---
  armed: boolean;
  liveEvents: LoopEvent[];

  // --- the step grid: the user's own beat ---
  grid: BeatGrid;
  /** While on and playing, tapping a sound writes it onto the nearest step. */
  gridRecording: boolean;
  /** AI producer mode: the model builds a full track around the grid beat. */
  aiMode: boolean;
  /**
   * The producer's plan before the user's beat is laid in. Kept so a grid
   * edit in AI mode re-renders instantly without asking the model again.
   */
  producerPlan: ArrangementPlan | null;
  /**
   * Song mode: the loop becomes a two-minute arrangement with an opening,
   * two choruses and an ending, rather than eight bars going round.
   *
   * Off by default and additive throughout — with it off every path behaves
   * exactly as it did before, which is what keeps a jam a jam.
   */
  songMode: boolean;
  /** Progress while the song is being built, 0..1, or null when idle. */
  songProgress: number | null;
  /** What the song builder is currently doing, for the progress UI. */
  songStage: string | null;
  /** Builds the full song: form, accompaniment, then the generated beds. */
  makeSong: () => Promise<void>;
  /** Returns to the eight-bar loop. */
  exitSongMode: () => void;

  /** AI texture layer: Stable Audio Open Small, generated on the phone. */
  textureOn: boolean;
  textureStatus: 'idle' | 'unavailable' | 'generating' | 'ready' | 'error';
  /** The prompt being or last generated, or why generation cannot run. */
  textureInfo: string | null;
  setTextureOn: (on: boolean) => void;
  /** A fresh take of the texture with a new seed. */
  regenerateTexture: () => void;
  toggleGridStep: (id: string, step: number) => void;
  setGridSteps: (steps: GridSteps) => void;
  clearGrid: () => void;
  toggleGridRecord: () => void;
  /** Turning AI mode on produces a track around the beat; off plays the raw beat. */
  setAiMode: (on: boolean) => Promise<void>;

  // --- actions ---
  beginCapture: (target: CaptureTarget) => boolean;
  finishCapture: () => Promise<void>;
  cancelCapture: () => void;
  removeObject: (id: string) => void;
  /**
   * Moves an object in the AR view. Position is spatial audio, not decoration:
   * dragging an object left pans its sound left, live, even mid-loop.
   */
  moveObject: (id: string, x: number, y: number) => void;
  /** Names an object after its sound has been captured. */
  renameObject: (id: string, label: string) => void;
  playObject: (id: string) => void;
  /** Fires every captured object together, so the kit can be heard as one. */
  playAllObjects: () => void;
  setObjectVolume: (id: string, volume: number) => void;
  arrange: (instruction?: string) => Promise<void>;
  applyStyle: (style: Style) => Promise<void>;
  handleCommand: (text: string) => Promise<void>;
  togglePlay: () => void;
  toggleArm: () => void;
  applyQuantize: () => void;
  setQuantize: (opts: Partial<QuantizeOptions>) => void;
  toggleLoopMute: (id: string) => void;
  clearLiveLoop: () => void;
  /** Clears the arrangement and lyrics, keeping the captured sounds. */
  clearTrack: () => void;
  /** Saved jams, newest first. */
  savedSessions: SessionSummary[];
  savingSession: boolean;
  refreshSessions: () => Promise<void>;
  saveCurrentSession: (name: string) => Promise<void>;
  openSession: (id: string) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  setStatus: (msg: string | null) => void;
  writeLyrics: (mood?: string) => Promise<void>;

  // --- your tune: a hum or song, heard back three ways ---
  /** Where the hum-to-song pipeline is. */
  /**
   * The genre last asked for. Kept so that arranging again — after capturing
   * another object, say — stays in that genre instead of snapping back to the
   * style chip, which is what made the music change style unasked.
   */
  currentGenre: string | null;
  /** The saved jam playing from the jams list, or null. */
  playingJamId: string | null;
  /** Plays a saved jam where it is listed; tapping the playing one stops it. */
  toggleSavedJam: (id: string) => Promise<void>;
    tuneStatus: 'idle' | 'working' | 'ready' | 'error';
  tuneMessage: string | null;
  /** Plays the raw recording, exactly as sung. */
  playVoice: () => void;
  /** Plays the detected tune on an instrument. */
  playTune: (instrument: MelodyInstrument) => void;
  /** Builds a full song that follows the tune, in a genre. */
  songFromTune: (genre: string, instrument: MelodyInstrument) => Promise<void>;
  /** Replays the last song made from the tune, with the voice on top if wanted. */
  playTuneSong: (withVoice: boolean) => void;
  /** Names artists or a sound to steer the production, e.g. "Charlie Puth". */
  setReference: (ref: string | null) => void;
  /** Spoken guidance for accessibility and hands-free coaching. */
  guidanceOn: boolean;
  setGuidance: (on: boolean) => void;
  exportTrack: () => Promise<string | null>;
  shareTrack: () => Promise<void>;
  reset: () => void;
}

/** Slot assignments for the procedurally rendered accompaniment layers. */
const LAYER_SLOTS = {
  bass: SLOT_BASS,
  chords: SLOT_CHORDS,
  pad: SLOT_CHORDS,
  arp: SLOT_ARP,
  guitar: SLOT_GUITAR,
  perc: SLOT_PERC,
} as const;

/**
 * Which density row governs each accompaniment layer.
 *
 * The section table is written in terms of what a part DOES — weight, accent,
 * movement — rather than what instrument plays it, so the pitched layers all
 * answer to 'lead' and only the bass carries the low end. Without this the
 * arp would survive a drop, which is the one section that must not have one.
 */
const LAYER_ROLE: Record<string, MusicalRole> = {
  bass: 'bass',
  chords: 'lead',
  pad: 'texture',
  arp: 'lead',
  guitar: 'lead',
  perc: 'perc',
};

const LIVE_LOOP_ID = 'live';
const PLAN_LOOP_ID = 'plan';

export const useSession = create<SessionState>((set, get) => ({
  objects: [],
  pcmBySlot: new Map(),
  loops: [],
  vocalTake: null,
  melodyDescription: null,
  reference: null,
  plan: null,
  bpm: 92,
  bars: 4,
  style: 'chill',
  key: null,

  recording: null,
  recordStartedAt: null,
  arranging: false,
  playing: false,
  quantizeOpts: DEFAULT_QUANTIZE,
  accuracyBefore: null,
  accuracyAfter: null,
  lastPlanInfo: null,
  statusMessage: null,
  lyrics: null,
  writingLyrics: false,
  exporting: false,
  lastExportPath: null,
  guidanceOn: false,
  savedSessions: [],
  savingSession: false,

  currentGenre: null,
  playingJamId: null,

  toggleSavedJam: async (id) => {
    const s = get();
    if (s.playingJamId === id && s.playing) {
      s.togglePlay();
      set({ playingJamId: null });
      return;
    }
    // Loading swaps the engine's samples, so stop whatever is sounding first.
    if (s.playing) s.togglePlay();
    set({ playingJamId: id });
    await get().openSession(id);
    if (get().playingJamId !== id) return; // another jam was tapped meanwhile
    if (!get().playing) get().togglePlay();
  },
  tuneStatus: 'idle',
  tuneMessage: null,

  playVoice: () => {
    const take = get().vocalTake;
    if (!take) {
      set({ statusMessage: 'Sing or hum something first.' });
      return;
    }
    stopAllVoices();
    trigger(take.slot, 1, 0.5);
  },

  playTune: (instrument) => {
    const take = get().vocalTake;
    if (!take || take.notes.length < 2) {
      set({ statusMessage: 'No clear tune found — hum a little louder and longer.' });
      return;
    }
    const pcm = renderMelody(take.notes, sampleRate(), instrument);
    loadSample(SLOT_TUNE, Array.from(pcm), 1);
    stopAllVoices();
    trigger(SLOT_TUNE, 1, 0.5);
    set({ statusMessage: `Your tune on ${instrument} · ${take.notes.length} notes${take.detectedKey ? ` · ${take.detectedKey}` : ''}` });
  },

  songFromTune: async (genre, instrument) => {
    await buildSongFromTune(set, get, genre, instrument);
  },

  playTuneSong: (withVoice) => {
    const s = get();
    if (s.tuneStatus !== 'ready') return;
    stopAllVoices();
    trigger(SLOT_TEXTURE, 1, 0.5);
    if (withVoice && s.vocalTake) trigger(s.vocalTake.slot, 0.9, 0.5);
  },

  armed: false,
  liveEvents: [],

  songMode: false,
  songProgress: null,
  songStage: null,

  textureOn: true,
  textureStatus: 'idle',
  textureInfo: null,

  setTextureOn: (on) => {
    set({ textureOn: on });
    if (on) void requestTexture(set, get);
    else syncBeatLoops(set, get);
  },

  regenerateTexture: () => {
    void requestTexture(set, get, true);
  },

  makeSong: async () => {
    await buildSong(set, get);
  },

  exitSongMode: () => {
    const s = get();
    set({ songMode: false, songProgress: null, songStage: null });
    // Re-apply the loop arrangement, which rebuilds every layer at loop
    // length and puts the transport back to eight bars.
    if (s.plan) applyPlan(s.producerPlan ?? s.plan, set, get);
  },

  grid: EMPTY_GRID,
  gridRecording: false,
  aiMode: false,
  producerPlan: null,

  toggleGridStep: (id, step) => {
    set((s) => ({ grid: toggleStep(s.grid, id, step) }));
    afterGridEdit(set, get);
  },

  setGridSteps: (steps) => {
    set((s) => ({ grid: resizeGrid(s.grid, steps) }));
    afterGridEdit(set, get);
  },

  clearGrid: () => {
    set((s) => ({ grid: { ...s.grid, cells: {} }, gridRecording: false }));
    afterGridEdit(set, get);
    set({ statusMessage: 'Beat cleared' });
  },

  toggleGridRecord: () => {
    const s = get();
    if (s.gridRecording) {
      setMetronome(false, s.bpm);
      set({ gridRecording: false, statusMessage: describeGrid(s.grid, s.objects) });
      return;
    }
    // Recording needs a running clock to land taps against, and a click so
    // the user can hear where the beat is.
    if (!s.playing) get().togglePlay();
    setMetronome(true, get().bpm);
    set({ gridRecording: true, statusMessage: 'Recording — tap your sounds in time' });
  },

  setAiMode: async (on) => {
    const s = get();
    if (!on) {
      set({ aiMode: false });
      syncBeatLoops(set, get);
      set({ statusMessage: 'Playing your raw beat' });
      return;
    }
    set({ aiMode: true });
    if (gridHitCount(s.grid) === 0) {
      syncBeatLoops(set, get);
      set({ statusMessage: 'Program a beat on the grid, then the AI builds around it' });
      return;
    }
    await get().arrange();
    if (!get().playing) get().togglePlay();
  },

  setStatus: (msg) => set({ statusMessage: msg }),

  refreshSessions: async () => {
    set({ savedSessions: await listSessions() });
  },

  saveCurrentSession: async (name) => {
    const state = get();
    if (state.objects.length === 0) {
      set({ statusMessage: 'Record something first.' });
      return;
    }
    if (state.savingSession) return;

    set({ savingSession: true, statusMessage: 'Saving jam…' });

    try {
      await saveSession({
        name: name.trim() || `Jam ${new Date().toLocaleDateString()}`,
        objects: state.objects,
        pcmBySlot: state.pcmBySlot,
        loops: state.loops,
        plan: state.plan,
        lyrics: state.lyrics,
        style: state.style,
        bpm: state.bpm,
        bars: state.bars,
        key: state.key,
      });

      set({
        savingSession: false,
        savedSessions: await listSessions(),
        statusMessage: `Saved "${name}"`,
      });
      if (isGuidanceEnabled()) speakNow(`Jam saved as ${name}`);
    } catch (err) {
      set({
        savingSession: false,
        statusMessage: `Save failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },

  openSession: async (id) => {
    set({ statusMessage: 'Loading jam…' });

    const loaded = await loadSession(id);
    if (!loaded) {
      set({ statusMessage: 'Could not open that jam.' });
      return;
    }

    const { session, pcmBySlot } = loaded;

    // Stop everything before swapping the engine's samples underneath it.
    transport.stop();
    stopAllVoices();
    for (const o of get().objects) clearSlot(o.slot);

    layerCache.clear();

    // Push the audio back into the native engine.
    for (const [slot, pcm] of pcmBySlot) {
      loadSample(slot, pcm, 1);
    }

    transport.setResolver(resolveEvent(get));
    transport.setTempo(session.bpm, session.bars);
    transport.setLoops(session.loops);

    set({
      objects: session.objects,
      pcmBySlot,
      loops: session.loops,
      plan: session.plan,
      lyrics: session.lyrics,
      style: session.style,
      bpm: session.bpm,
      bars: session.bars,
      key: session.key,
      playing: false,
      armed: false,
      liveEvents: [],
      lastExportPath: null,
      statusMessage: `Opened "${session.name}"`,
    });

    if (isGuidanceEnabled()) {
      speakNow(`Opened ${session.name}, ${session.objectCount} sounds.`);
    }
  },

  removeSession: async (id) => {
    await deleteSession(id);
    set({ savedSessions: await listSessions(), statusMessage: 'Jam deleted' });
  },

  writeLyrics: async (mood) => {
    const state = get();
    if (!state.plan) {
      set({ statusMessage: 'Arrange the track first.' });
      return;
    }
    if (state.writingLyrics) return;

    set({ writingLyrics: true, statusMessage: 'Writing lyrics…' });

    const result = await generateLyrics(
      state.objects,
      state.plan,
      state.vocalTake,
      mood,
    );

    set({
      lyrics: result.lyrics,
      writingLyrics: false,
      statusMessage: result.usedFallback
        ? 'Lyrics written (template)'
        : `Lyrics by Gemma · ${((result.elapsedMs ?? 0) / 1000).toFixed(1)}s`,
    });

    if (isGuidanceEnabled()) {
      speakNow(`Lyrics ready. ${result.lyrics.hook}`);
    }
  },

  setReference: (ref) => set({ reference: ref && ref.trim() ? ref.trim() : null }),

  setGuidance: (on) => {
    setGuidanceEnabled(on);
    set({ guidanceOn: on });
    if (on) {
      speakNow('Voice guidance on.');
    } else {
      guidance.clear();
    }
  },

  beginCapture: (target) => {
    if (get().recording) return false;
    const ok = startRecording();
    if (!ok) {
      set({ statusMessage: 'Microphone unavailable — check permissions.' });
      return false;
    }
    set({ recording: target, recordStartedAt: Date.now(), statusMessage: null });
    return true;
  },

  cancelCapture: () => {
    if (!get().recording) return;
    stopRecording();
    set({ recording: null, recordStartedAt: null });
  },

  finishCapture: async () => {
    const target = get().recording;
    if (!target) return;

    const raw = stopRecording();
    set({ recording: null, recordStartedAt: null });

    const sr = sampleRate();
    if (raw.length < sr * 0.05) {
      set({ statusMessage: 'Too short — hold while the sound rings out.' });
      return;
    }

    if (target.kind === 'vocal') {
      // The raw voice is preserved untouched; analysis only describes it.
      const { pcm } = trimSilence(raw, sr, -50);
      const rawNotes = extractMelody(pcm, sr);
      const key = detectKey(rawNotes);

      // A hummed line is never in tune or in time on its own. Refining it here
      // means the note list the arranger and the lead synth read is already
      // musical, rather than each of them having to correct it separately and
      // possibly differently.
      const refined = refineMelody(rawNotes, key);
      const notes = refined.notes.length > 0 ? refined.notes : rawNotes;

      loadSample(SLOT_VOCAL, pcm, 1);
      get().pcmBySlot.set(SLOT_VOCAL, pcm);

      const take: VocalTake = {
        id: `vocal-${Date.now()}`,
        slot: SLOT_VOCAL,
        duration: pcm.length / sr,
        notes,
        detectedKey: key,
        muted: false,
      };
      set({
        vocalTake: take,
        key,
        // The hum's own tempo beats the default when the user has not played
        // anything yet — the song should follow the voice, not the other way.
        bpm: refined.notes.length >= 3 ? refined.bpm : get().bpm,
        melodyDescription: refined.notes.length ? describeMelody(refined) : null,
        statusMessage: notes.length
          ? `Voice captured — ${notes.length} notes${key ? `, ${key}` : ''}`
          : 'Voice captured (no clear melody detected)',
      });
      return;
    }

    // --- object capture ---
    /*
     * What plays back is the RECORDING, not a processed version of it.
     *
     * Denoising used to run before playback as well as analysis. Spectral
     * subtraction at 1.5x over-subtraction strips the quiet harmonics and
     * body that make an object sound like itself, so tapping a captured cup
     * played something thinner and metallic — recognisably not what was
     * recorded. That is the one thing this app cannot get wrong.
     *
     * So the signal splits here. Playback gets the real audio, gated only to
     * the hit and trimmed of silence. Analysis gets the denoised copy, where
     * removing the room genuinely helps decide brightness and decay, and
     * where nobody is listening.
     */
    const window = findTransientWindow(raw, sr, estimateNoiseFloor(raw, sr));
    const hit = window ? Array.from(raw).slice(window.start, window.end) : Array.from(raw);
    const trimmed = trimSilence(hit, sr).pcm;

    /*
     * Level-match the capture.
     *
     * Objects get struck with very different force, so without this a soft
     * tap is inaudible under the accompaniment while a hard one clips. The
     * arrangement then has no audible beat even though every event is firing
     * exactly on time. Normalising is what makes the rhythm actually land.
     */
    const pcm = normalisePeak(trimmed);

    // Denoised only for measurement.
    const analysed = cleanCapture(pcm, sr);
    const features = extractFeatures(analysed.pcm, sr);
    const role = inferRole(features);

    const state = get();
    const used = state.objects.map((o) => o.slot);
    const slot = allocateSlot(used);
    if (slot < 0) {
      set({ statusMessage: 'Object limit reached — remove one first.' });
      return;
    }

    loadSample(slot, pcm, 1);
    state.pcmBySlot.set(slot, pcm);

    const obj: WorldJamObject = {
      id: `obj-${Date.now()}-${slot}`,
      /*
       * Named from the sound, not the scan.
       *
       * The caller passes a generic "Object" when nothing identified it, and
       * five identical entries in a row are unusable. The recording's own
       * brightness and decay give a name a musician can act on, so the label
       * is only taken from the caller when it actually says something.
       */
      label:
        target.label && target.label !== 'Object'
          ? target.label
          : uniqueLabel(nameFromSound(features), get().objects),
      category: target.category,
      slot,
      position: { x: target.x, y: target.y },
      features,
      role,
      beatPattern: [],
      volume: 1,
      // Pan follows screen position so objects spread across the stereo field.
      pan: Math.min(0.9, Math.max(0.1, target.x)),
      color: OBJECT_COLORS[state.objects.length % OBJECT_COLORS.length],
      createdAt: Date.now(),
    };

    set({
      objects: [...state.objects, obj],
      lastExportPath: null,
      // The gate is reported because it ran on the ANALYSIS copy; the audio
      // the user will hear is untouched.
      statusMessage: analysed.gated
        ? `${target.label} → ${role} · room −${analysed.noiseReducedDb.toFixed(0)}dB`
        : `${target.label} → ${role}`,
    });

    // Confirm the capture by playing it back immediately: the user hears their
    // own object, which is the core promise of the product.
    trigger(slot, 1, obj.pan);

    // Spoken confirmation means a capture can be verified without looking.
    if (isGuidanceEnabled()) {
      speakNow(describeCapture(obj, analysed.noiseReducedDb));
    }
  },

  removeObject: (id) => {
    const obj = get().objects.find((o) => o.id === id);
    if (!obj) return;
    clearSlot(obj.slot);
    get().pcmBySlot.delete(obj.slot);
    set((s) => ({
      objects: s.objects.filter((o) => o.id !== id),
      grid: removeRow(s.grid, id),
      liveEvents: s.liveEvents.filter((e) => e.objectId !== id),
      loops: s.loops.map((l) => ({
        ...l,
        events: l.events.filter((e) => e.objectId !== id),
      })),
    }));
  },

  moveObject: (id, x, y) => {
    const cx = Math.min(1, Math.max(0, x));
    const cy = Math.min(1, Math.max(0, y));
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id
          ? { ...o, position: { x: cx, y: cy }, pan: Math.min(0.9, Math.max(0.1, cx)) }
          : o,
      ),
    }));
  },

  renameObject: (id, label) => {
    const trimmed = label.trim();
    if (!trimmed) return;

    // Keep labels unique: the AI addresses objects by name, so two "Mug"s
    // would make an arrangement ambiguous.
    const taken = new Set(
      get()
        .objects.filter((o) => o.id !== id)
        .map((o) => o.label.toLowerCase()),
    );
    let unique = trimmed;
    let n = 2;
    while (taken.has(unique.toLowerCase())) unique = `${trimmed} ${n++}`;

    set((s) => ({
      objects: s.objects.map((o) => (o.id === id ? { ...o, label: unique } : o)),
      lastExportPath: null,
    }));
  },

  /**
   * Fires every captured object at once.
   *
   * Recording several things and only ever hearing them one at a time hides
   * the whole point of the app. This is not an arrangement — it is the "what
   * do my sounds sound like together" button, available the moment there are
   * two of them and long before anything has been generated.
   *
   * A few milliseconds of stagger keeps the hits from summing into one
   * transient and clipping, and sounds like a strum rather than a stack.
   */
  playAllObjects: () => {
    const { objects } = get();
    objects.forEach((obj, i) => {
      if (i === 0) {
        trigger(obj.slot, obj.volume, obj.pan);
        return;
      }
      setTimeout(() => trigger(obj.slot, obj.volume, obj.pan), i * 45);
    });
  },

  playObject: (id) => {
    const state = get();
    const obj = state.objects.find((o) => o.id === id);
    if (!obj) return;

    trigger(obj.slot, obj.volume, obj.pan);

    // Grid recording: the tap lands on the nearest step of the user's beat.
    if (state.gridRecording && state.playing) {
      const step = beatToStep(transport.tapToBeat(), state.grid.steps);
      set({ grid: setStep(state.grid, id, step, true) });
      afterGridEdit(set, get);
      return;
    }

    // When armed, a tap is also a performance being recorded onto the grid.
    if (state.armed && state.playing) {
      const beat = transport.tapToBeat();
      set({ liveEvents: [...state.liveEvents, { objectId: id, beat, velocity: 1 }] });
    }
  },

  setObjectVolume: (id, volume) => {
    set((s) => ({
      objects: s.objects.map((o) => (o.id === id ? { ...o, volume } : o)),
    }));
  },

  arrange: async (instruction) => {
    const state = get();
    if (state.objects.length === 0) {
      set({ statusMessage: 'Capture an object first.' });
      return;
    }

    set({ arranging: true, statusMessage: 'Gemma is arranging…' });

    // A model call can take 20 s on a phone CPU. Without a ticking counter a
    // static message reads as a hang.
    // tickStart must be declared BEFORE the interval: a `const` referenced
    // from a callback that fires before the declaration throws on the
    // temporal dead zone.
    const tickStart = Date.now();
    const tick = setInterval(() => {
      if (!get().arranging) return;
      const secs = ((Date.now() - tickStart) / 1000).toFixed(0);
      set({ statusMessage: `Gemma is arranging… ${secs}s` });
    }, 1000);

    // Tempo hint from whatever the user has actually played so far, or from
    // the tempo their grid beat was programmed at.
    const bpmHint =
      state.liveEvents.length >= 3 || gridHitCount(state.grid) > 0 ? state.bpm : null;

    // Read the genre off the user's words before the model runs, so the style
    // it is steered toward — and the rule-based plan used if it times out —
    // already matches what they asked for. Typing "phonk" with the chill chip
    // selected must still give phonk.
    // With no words this time, carry on in the genre asked for last.
    const words = instruction?.trim() || state.currentGenre || undefined;
    instruction = words;
    const asked = matchGenre(words);
    if (asked) set({ currentGenre: words ?? asked.name });
    const style = asked?.style ?? state.style;

    const result = await generatePlan(
      {
        objects: state.objects,
        vocal: state.vocalTake,
        bpmHint,
        style,
        mood: undefined,
        melodyDescription: state.melodyDescription ?? undefined,
        reference: state.reference ?? undefined,
        userBeat: gridToPattern(state.grid, state.objects),
      },
      instruction,
    );

    clearInterval(tick);

    // Carry the user's own words into the plan. The music prompt is built
    // from these later, and without them a description only ever reached
    // Gemma — never the model that makes the sound.
    const said = instruction?.trim() || undefined;
    const plan: ArrangementPlan = {
      ...result.plan,
      request: said,
      genre: result.plan.genre ?? asked?.name,
    };

    if (asked) {
      // The genre's own beat, played by the user's objects. Without this every
      // genre fell back to the same per-style pattern.
      const groove = grooveFor(asked, get().objects);
      if (groove) plan.objectPattern = groove;

      // When the on-device model can make the genre's backing itself, it
      // leads: the built-in synth only knows six styles and plays the same
      // chords for every genre that maps to one, which is what made different
      // genres sound alike. Drum-led genres keep the synth bass for weight.
      if (/stable audio 3/i.test(textureEngine().name)) {
        plan.accompaniment = asked.percussion ? ['bass'] : [];
      }
    }
    // A fresh press is a fresh piece of music, even when the prompt matches
    // the last one; otherwise the texture cache hands back the same file.
    textureNonce++;
    applyPlan(plan, set, get);

    const info = result.usedFallback
      ? `Rule-based plan${result.error ? ` (${result.error})` : ''}`
      : `Gemma plan in ${result.elapsedMs}ms${
          result.repairs.length ? ` · ${result.repairs.length} repair(s)` : ''
        }`;

    set({
      arranging: false,
      lastPlanInfo: info,
      statusMessage: `${result.usedFallback ? 'Rule-based' : 'Gemma arranged'} ${
        plan.genre ?? plan.style
      } · ${describeFeel(plan.style, get().bpm, get().bars)}`,
    });
  },

  applyStyle: async (style) => {
    const state = get();

    // Paint the selection immediately. applyPlan() below synthesises several
    // seconds of accompaniment PCM, which is hundreds of thousands of samples
    // on the JS thread; without this the button appears frozen until it ends.
    set({ style, arranging: true, statusMessage: `Switching to ${style}…` });

    if (state.objects.length === 0) {
      set({ arranging: false });
      return;
    }

    // Yield twice so React commits the highlighted chip and the spinner
    // before the synchronous render begins. One frame is not always enough
    // on a loaded device.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    const immediate = state.plan
      ? restylePlan(state.plan, state.objects, style)
      : buildFallbackPlan(state.objects, style);
    applyPlan(immediate, set, get);
    set({ arranging: false, statusMessage: `${style} · ${immediate.bpm} BPM` });

    // Let the model refine it afterwards; the rule-based feel is already
    // playing, so this never blocks the user.
    await get().arrange(`make it ${style}`);
  },

  handleCommand: async (text) => {
    const style = parseStyleCommand(text);
    if (style) {
      await get().applyStyle(style);
      return;
    }
    await get().arrange(text);
  },

  togglePlay: () => {
    const state = get();
    if (state.playing) {
      transport.stop();
      stopAllVoices();
      setMetronome(false, state.bpm);
      set({ playing: false, gridRecording: false });
      return;
    }

    transport.setResolver(resolveEvent(get));
    transport.setTempo(state.bpm, state.bars);
    transport.setLoops(state.loops);
    transport.start();
    set({ playing: true });
  },

  toggleArm: () => {
    const state = get();
    if (state.armed) {
      // Disarming commits whatever was played into the live loop.
      const wrapped = wrapToLoop(state.liveEvents, state.bars * 4);
      const accuracy = timingAccuracy(wrapped, state.quantizeOpts.grid);

      const loops = upsertLoop(state.loops, {
        id: LIVE_LOOP_ID,
        name: 'Your performance',
        events: wrapped,
        bars: state.bars,
        muted: false,
        createdAt: Date.now(),
      });

      transport.setLoops(loops);
      set({
        armed: false,
        loops,
        accuracyBefore: accuracy,
        accuracyAfter: null,
        statusMessage: wrapped.length
          ? `${wrapped.length} hits recorded — timing ${Math.round(accuracy * 100)}%`
          : 'Nothing recorded',
      });
      return;
    }

    set({ armed: true, liveEvents: [], statusMessage: 'Armed — tap objects on the beat' });
  },

  applyQuantize: () => {
    const state = get();
    const live = state.loops.find((l) => l.id === LIVE_LOOP_ID);
    if (!live || live.events.length === 0) {
      set({ statusMessage: 'Record a performance first.' });
      return;
    }

    const before = timingAccuracy(live.events, state.quantizeOpts.grid);
    const quantized = quantizeLoop(live.events, state.quantizeOpts);
    const after = timingAccuracy(quantized, state.quantizeOpts.grid);

    const loops = state.loops.map((l) =>
      l.id === LIVE_LOOP_ID ? { ...l, events: quantized } : l,
    );
    transport.setLoops(loops);

    set({
      loops,
      accuracyBefore: before,
      accuracyAfter: after,
      statusMessage: `Timing ${Math.round(before * 100)}% → ${Math.round(after * 100)}%`,
    });
  },

  setQuantize: (opts) => {
    set((s) => ({ quantizeOpts: { ...s.quantizeOpts, ...opts } }));
  },

  toggleLoopMute: (id) => {
    const loops = get().loops.map((l) => (l.id === id ? { ...l, muted: !l.muted } : l));
    transport.setLoops(loops);
    set({ loops });
  },

  clearTrack: () => {
    transport.reset();
    stopAllVoices();
    transport.setLoops([]);
    set({
      loops: [],
      plan: null,
      producerPlan: null,
      aiMode: false,
      gridRecording: false,
      textureStatus: 'idle',
      textureInfo: null,
      lyrics: null,
      liveEvents: [],
      playing: false,
      armed: false,
      accuracyBefore: null,
      accuracyAfter: null,
      lastPlanInfo: null,
      lastExportPath: null,
      statusMessage: 'Track cleared — your sounds are kept',
    });
    if (isGuidanceEnabled()) {
      guidance.clear();
      speakNow('Track cleared. Your recorded sounds are still here.');
    }
  },

  clearLiveLoop: () => {
    const loops = get().loops.filter((l) => l.id !== LIVE_LOOP_ID);
    transport.setLoops(loops);
    set({ loops, liveEvents: [], accuracyBefore: null, accuracyAfter: null });
  },

  exportTrack: async () => {
    const state = get();
    if (state.exporting) return null;
    if (state.loops.length === 0) {
      set({ statusMessage: 'Nothing to export yet.' });
      return null;
    }

    set({ exporting: true, statusMessage: 'Rendering…' });

    try {
      const samples = new Map<number, number[]>(state.pcmBySlot);

      const mixed = mixSession(
        {
          samples,
          objects: state.objects,
          loops: state.loops,
          plan: state.plan,
          bpm: state.bpm,
          bars: state.bars,
          sampleRate: sampleRate(),
          repeats: 4,
        },
        (layer) => LAYER_SLOTS[layer as keyof typeof LAYER_SLOTS] ?? null,
      );

      const wav = encodeWav(mixed, sampleRate(), 2);
      const path = `${FileSystem.documentDirectory}worldjam-${Date.now()}.wav`;

      await FileSystem.writeAsStringAsync(path, toBase64(wav), {
        encoding: FileSystem.EncodingType.Base64,
      });

      const seconds = mixed.length / 2 / sampleRate();
      set({
        exporting: false,
        lastExportPath: path,
        statusMessage: `Saved ${seconds.toFixed(1)}s track`,
      });
      return path;
    } catch (err) {
      set({
        exporting: false,
        statusMessage: `Export failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return null;
    }
  },

  shareTrack: async () => {
    // Reuse the last render when nothing has changed; re-rendering a 4-bar
    // mixdown is fast but not free, and the user pressed Share, not Save.
    const path = get().lastExportPath ?? (await get().exportTrack());
    if (!path) return;

    try {
      if (!(await Sharing.isAvailableAsync())) {
        set({ statusMessage: `Saved to ${path.split('/').pop()}` });
        return;
      }
      await Sharing.shareAsync(path, {
        mimeType: 'audio/wav',
        dialogTitle: 'Share your WorldJam track',
      });
    } catch (err) {
      set({
        statusMessage: `Share failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },

  reset: () => {
    // A new jam starts from nothing. Everything the last one left behind —
    // sounds, voice, beat grid, genre, song, lyrics, generated music and the
    // synthesised layers still loaded in their slots — is cleared, or it
    // leaks into the new jam the moment it plays.
    transport.reset();
    stopAllVoices();
    setMetronome(false, get().bpm);
    const current = get();
    for (const o of current.objects) clearSlot(o.slot);
    for (const slot of [SLOT_VOCAL, SLOT_TEXTURE, SLOT_BASS, SLOT_CHORDS, SLOT_ARP, SLOT_GUITAR, SLOT_PERC]) {
      clearSlot(slot);
    }
    current.pcmBySlot.clear();
    layerCache.clear();
    loadedTextureKey = null;
    textureNonce++;
    transport.setLoops([]);
    set({
      objects: [],
      loops: [],
      vocalTake: null,
      melodyDescription: null,
      plan: null,
      producerPlan: null,
      key: null,
      bpm: 92,
      bars: 4,
      liveEvents: [],
      playing: false,
      armed: false,
      grid: EMPTY_GRID,
      gridRecording: false,
      aiMode: false,
      songMode: false,
      songProgress: null,
      songStage: null,
      currentGenre: null,
      tuneStatus: 'idle',
      tuneMessage: null,
      lyrics: null,
      textureStatus: 'idle',
      textureInfo: null,
      accuracyBefore: null,
      accuracyAfter: null,
      lastPlanInfo: null,
      lastExportPath: null,
      statusMessage: 'New jam — capture your first sound',
    });
  },
}));

function upsertLoop(loops: Loop[], loop: Loop): Loop[] {
  const idx = loops.findIndex((l) => l.id === loop.id);
  if (idx === -1) return [...loops, loop];
  const next = [...loops];
  next[idx] = loop;
  return next;
}

/**
 * Applies a validated plan: rebuilds the pattern loop, renders the
 * accompaniment layers to PCM and loads them into their reserved slots.
 */
function applyPlan(
  rawPlan: ArrangementPlan,
  set: (partial: Partial<SessionState>) => void,
  get: () => SessionState,
): void {
  const state = get();

  /*
   * The director's pass over whatever arranged this — Gemma or the rules.
   *
   * Tempo is folded into the genre's range (a model's EDM at 64 BPM meant the
   * half-time feel, so it becomes 128, not a dirge). And a song is at least
   * eight bars: four is too short for the intro → verse → build → chorus form
   * to play out, so short plans came back sounding like a single loop.
   */
  // The user's own grid beat, when there is one, is laid in on top of the
  // producer's plan: their rows play exactly as programmed, the producer owns
  // everything else. See audio/beatGrid.ts.
  const userBeat = gridToPattern(state.grid, state.objects);
  const layered = userBeat.length ? layerUserBeat(rawPlan, userBeat) : rawPlan;
  const fixedLabels = new Set(userBeat.map((u) => u.object.toLowerCase()));
  const fixedIds = new Set(
    state.objects.filter((o) => fixedLabels.has(o.label.toLowerCase())).map((o) => o.id),
  );

  // A named genre owns its tempo: phonk lives at 140, and folding it into the
  // nearest legacy style's range would leave it sounding like slow EDM.
  const genre = matchGenre(rawPlan.request) ?? matchGenre(rawPlan.genre);
  const directed = directTempo(rawPlan.style, state.objects, rawPlan.bpm);
  const plan: ArrangementPlan = {
    ...layered,
    bpm: genre ? genreTempo(genre, rawPlan.bpm || directed) : directed,
    bars: Math.max(8, rawPlan.bars),
  };

  // The arrangement is rendered across the whole form rather than repeating
  // one bar: sections thin parts out, accent the downbeats and put a fill on
  // each turnaround. Repeating a single bar at a flat velocity is what made a
  // jam sound like a loop instead of a piece of music.
  // Grid first, then feel: swing, humanisation, and breathing room for
  // objects that ring. See audio/groove.ts.
  const objectEvents = applyGroove(
    renderArrangement({
      objects: state.objects,
      objectPattern: plan.objectPattern,
      totalBars: plan.bars,
      style: plan.style,
      fixed: fixedLabels,
    }),
    {
      style: plan.style,
      bpm: plan.bpm,
      objects: state.objects,
      totalBeats: plan.bars * 4,
      fixedIds,
    },
  );

  // Render accompaniment. Each layer becomes one long sample fired once at the
  // top of the loop, so it costs the same as a single object hit rather than
  // one scheduled event per beat.
  const sr = sampleRate();
  const layerEvents: LoopEvent[] = [];
  const rendered = new Set<number>();

  for (const layer of plan.accompaniment) {
    const slot = LAYER_SLOTS[layer];
    // 'chords' and 'pad' share a slot; rendering both would overwrite one.
    if (rendered.has(slot)) continue;

    // Grid edits in AI mode re-run this on every tap. Synthesising seconds of
    // accompaniment each time would stall the UI, and the result would be
    // identical, so an unchanged layer is reused as it sits in the engine.
    const cacheKey = `${layer}|${plan.bpm}|${plan.bars}|${state.key}|${plan.style}|${sr}`;
    if (layerCache.get(slot) === cacheKey && state.pcmBySlot.has(slot)) {
      rendered.add(slot);
      layerEvents.push({ objectId: `layer:${layer}`, beat: 0, velocity: 1 });
      continue;
    }
    layerCache.set(slot, cacheKey);

    const pcm = renderLayer(layer, {
      sampleRate: sr,
      bpm: plan.bpm,
      bars: plan.bars,
      key: state.key,
      style: plan.style,
    });
    loadSample(slot, pcm, 1);
    state.pcmBySlot.set(slot, pcm);
    rendered.add(slot);

    layerEvents.push({ objectId: `layer:${layer}`, beat: 0, velocity: 1 });
  }

  // The vocal take plays at the top of every loop, so the user hears their
  // own voice blended with the objects and accompaniment rather than only
  // once when the arrangement was made.
  const vocalEvents: LoopEvent[] =
    state.vocalTake && !state.vocalTake.muted && plan.voiceRole !== 'none'
      ? [{ objectId: 'vocal', beat: 0, velocity: 1 }]
      : [];

  const planLoop: Loop = {
    id: PLAN_LOOP_ID,
    name: 'AI arrangement',
    // Built once, fully formed, and sorted — the scheduler walks these in order.
    events: [...objectEvents, ...layerEvents, ...vocalEvents].sort(
      (a, b) => a.beat - b.beat,
    ),
    bars: plan.bars,
    muted: false,
    createdAt: Date.now(),
  };

  const loops = upsertLoop(state.loops, planLoop);

  transport.setResolver(resolveEvent(get));

  // Rebuild the spoken call sequence for the new arrangement.
  if (isGuidanceEnabled()) {
    guidance.clear();
    for (const cue of buildRhythmCues(plan, state.objects)) {
      guidance.enqueue(cue);
    }
  }

  transport.setTempo(plan.bpm, plan.bars);
  transport.setLoops(loops);

  set({
    plan,
    loops,
    bpm: plan.bpm,
    bars: plan.bars,
    style: plan.style,
    objects: state.objects.map((o) => {
      const entry = plan.objectPattern.find(
        (p) => p.object.toLowerCase() === o.label.toLowerCase(),
      );
      return entry ? { ...o, beatPattern: entry.beats } : { ...o, beatPattern: [] };
    }),
    producerPlan: rawPlan,
    // An arrangement made while a beat is programmed IS the AI-produced
    // version of that beat, so it is what plays.
    aiMode: userBeat.length > 0 ? true : get().aiMode,
  });

  syncBeatLoops(set, get);
  void requestTexture(set, get);
}

/**
 * Maps a scheduled event to the slot, gain and pan it plays at.
 *
 * One resolver for every path (arranging, play/pause, opening a saved jam).
 * The play and open paths used to install an objects-only resolver, which
 * silently dropped the accompaniment and the vocal after a stop and restart.
 */
function resolveEvent(get: () => SessionState) {
  return (objectId: string) => {
    const s = get();
    if (objectId === 'vocal') {
      const take = s.vocalTake;
      // Centre-panned and slightly forward: the voice is the lead, and
      // panning it would make it fight the objects for space.
      return take && !take.muted ? { slot: take.slot, gain: 1.0, pan: 0.5 } : null;
    }
    const hasVocal = s.vocalTake != null && !s.vocalTake.muted;
    if (objectId === 'texture') {
      // Air and colour under the real sounds, never on top of them.
      // A genre bed from the music model carries the track's style, so it
      // sits up front; a generic texture stays underneath the objects.
      const leads = s.plan?.genre != null && /stable audio 3/i.test(textureEngine().name);
      return {
        slot: SLOT_TEXTURE,
        gain: leads ? (hasVocal ? 0.6 : 0.85) : hasVocal ? 0.35 : 0.55,
        pan: 0.5,
      };
    }
    if (objectId.startsWith('layer:')) {
      const layer = objectId.slice(6) as keyof typeof LAYER_SLOTS;
      const slot = LAYER_SLOTS[layer];
      if (slot == null) return null;
      // Duck the synthesised accompaniment when a vocal is in the mix. A
      // phone-mic voice has far less level than a synth, and at equal gain
      // the backing simply buries it.
      return { slot, gain: hasVocal ? 0.45 : 0.8, pan: 0.5 };
    }
    const obj = s.objects.find((o) => o.id === objectId);
    return obj ? { slot: obj.slot, gain: obj.volume, pan: obj.pan } : null;
  };
}

const TEXTURE_LOOP_ID = 'texture';
/** Prompt|length of the texture currently loaded in its slot. */
let loadedTextureKey: string | null = null;
let textureRunning = false;
let texturePending = false;

/**
 * Bumped on every Generate press.
 *
 * Folded into the texture's cache key and seed, so asking again gives new
 * music even when the prompt text comes out the same — which it often did,
 * and the cache then handed back the identical file.
 */
let textureNonce = 0;

/** What the user asked for, in the form the prompt builders take. */
function intentOf(s: SessionState) {
  return {
    instruction: s.plan?.request ?? null,
    genre: s.plan?.genre ?? null,
    objects: describeObjects(s.objects),
  };
}

function currentTextureKey(s: SessionState): { key: string; prompt: string; seconds: number } | null {
  if (!s.plan) return null;
  const prompt = buildTexturePrompt(s.plan.style, s.bpm, s.key, s.plan.texture, intentOf(s));
  const seconds = textureSeconds(s.bpm, textureEngine().maxSeconds);
  return { key: `${prompt}|${seconds.toFixed(3)}|${textureNonce}`, prompt, seconds };
}

/**
 * Makes sure the texture layer matches the current arrangement.
 *
 * Runs in the background: the track plays straight away with the synthesised
 * backing, and the texture fades in when Stable Audio finishes (~18 s on an
 * iQOO 15). Only one generation runs at a time; a request that arrives
 * meanwhile is replayed once it ends, against whatever is current by then.
 */
async function requestTexture(
  set: (partial: Partial<SessionState>) => void,
  get: () => SessionState,
  force = false,
): Promise<void> {
  const s = get();
  if (!s.textureOn || !s.plan) return;

  const reason = textureUnavailableReason();
  if (reason) {
    set({ textureStatus: 'unavailable', textureInfo: reason });
    return;
  }

  const want = currentTextureKey(s);
  if (!want) return;
  if (!force && want.key === loadedTextureKey) {
    syncBeatLoops(set, get);
    return;
  }
  if (textureRunning) {
    texturePending = true;
    return;
  }

  textureRunning = true;
  set({
    textureStatus: 'generating',
    textureInfo: want.prompt,
    statusMessage: `${textureEngine().name || 'Stable Audio'} is making music…`,
  });
  try {
    const seed = force
      ? Math.floor(Math.random() * 1_000_000)
      : textureSeed(`${want.prompt}|${textureNonce}`);
    const r = await generateTextureInto(want.prompt, want.seconds, seed, SLOT_TEXTURE);
    if (r.ok) {
      loadedTextureKey = want.key;
      set({
        textureStatus: 'ready',
        textureInfo: want.prompt,
        statusMessage: `Texture ready in ${Math.round((r.elapsedMs ?? 0) / 1000)}s: ${want.prompt}`,
      });
      syncBeatLoops(set, get);
    } else {
      set({
        textureStatus: 'error',
        textureInfo: r.error ?? 'generation failed',
        statusMessage: `Texture failed: ${r.error ?? 'unknown error'}`,
      });
    }
  } finally {
    textureRunning = false;
    if (texturePending) {
      texturePending = false;
      void requestTexture(set, get);
    }
  }
}

/**
 * The slot that holds the tune played on an instrument.
 *
 * Borrowed from the synthesised percussion layer, which the arranger never
 * asks for (schema.ts whitelists it out), so the two never compete.
 */
const SLOT_TUNE = SLOT_PERC;

/**
 * Hum or sing → a full song that follows the tune.
 *
 * The hum is first played back on a clean instrument, because a pitched line
 * is far easier for the music model to follow than a breathy voice. That
 * rendering is written to a file and handed to the model as the thing to
 * build around, with the genre as the prompt. Measured on the dev phone the
 * result keeps the sung note among its three loudest pitches on every beat.
 *
 * The raw voice is never touched; it can be layered back over the result.
 */
async function buildSongFromTune(
  set: (partial: Partial<SessionState>) => void,
  get: () => SessionState,
  genre: string,
  instrument: MelodyInstrument,
): Promise<void> {
  const s = get();
  const take = s.vocalTake;
  if (!take || take.notes.length < 3) {
    set({ tuneStatus: 'error', tuneMessage: 'No clear tune found — hum a phrase of at least a few notes.' });
    return;
  }
  if (s.tuneStatus === 'working') return;

  set({ tuneStatus: 'working', tuneMessage: 'Turning your tune into an instrument line…' });
  await new Promise((r) => setTimeout(r, 0));

  try {
    // Whole bars, so the song loops cleanly and the model gets a sensible length.
    const bpm = s.bpm;
    const barSec = 240 / Math.max(1, bpm);
    const end = take.notes.reduce((a, n) => Math.max(a, n.time + n.duration), 0);
    const seconds = Math.min(40, Math.max(barSec * 2, Math.ceil((end + 0.3) / barSec) * barSec));

    const FILE_RATE = 44100;
    const mono = renderMelody(take.notes, FILE_RATE, instrument, seconds);
    const wav = encodeWav(monoToStereo(mono), FILE_RATE, 2);
    const path = `${FileSystem.cacheDirectory}tune-${Date.now()}.wav`;
    await FileSystem.writeAsStringAsync(path, toBase64(wav), {
      encoding: FileSystem.EncodingType.Base64,
    });

    const key = take.detectedKey ?? s.key;
    const prompt = buildTexturePrompt(
      matchGenre(genre)?.style ?? s.style,
      bpm,
      key,
      null,
      {
        // "song" and "beat" tell the prompt builder drums are wanted: this is
        // a finished track, not a bed under recorded objects.
        instruction: `${genre} song with a beat, lead melody`,
        objects: describeObjects(s.objects),
      },
    );

    set({ tuneMessage: `${textureEngine().name || 'The music model'} is writing a ${genre} song around your tune…` });
    const started = Date.now();
    const r = await generateFromMelody(prompt, path, seconds, 0.7, Math.floor(Math.random() * 1_000_000));
    void FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});

    if (!r.ok || !r.pcm || r.pcm.length === 0) {
      set({ tuneStatus: 'error', tuneMessage: r.error ?? 'Could not build the song.' });
      return;
    }

    loadSample(SLOT_TEXTURE, r.pcm, 1);
    get().pcmBySlot.set(SLOT_TEXTURE, r.pcm);
    stopAllVoices();
    trigger(SLOT_TEXTURE, 1, 0.5);
    set({
      tuneStatus: 'ready',
      tuneMessage: `Your ${genre} song · ${Math.round(seconds)}s · made in ${Math.round((Date.now() - started) / 1000)}s${key ? ` · ${key}` : ''}`,
    });
  } catch (err) {
    set({ tuneStatus: 'error', tuneMessage: err instanceof Error ? err.message : String(err) });
  }
}

const SONG_LOOP_ID = 'song';

/**
 * Builds the full song.
 *
 * Three passes, in the order that gets something audible soonest. The object
 * arrangement and the synthesised backing are fast and deterministic, so the
 * song starts playing within a second or two. The generated beds take about
 * 26 s each and arrive afterwards, fading in section by section — the same
 * bargain requestTexture already makes, at song length.
 *
 * Yields to the UI between sections: synthesising two minutes of PCM is
 * hundreds of thousands of samples per layer, and without a yield the
 * progress bar would not paint until the work it is reporting had finished.
 */
async function buildSong(
  set: (partial: Partial<SessionState>) => void,
  get: () => SessionState,
): Promise<void> {
  const state = get();
  if (!state.plan) {
    set({ statusMessage: 'Arrange something first.' });
    return;
  }
  if (state.songProgress != null) return;

  const plan = state.plan;
  const form = buildSongForm(plan.style);
  const totalBars = songBars(form);
  const sr = sampleRate();

  set({
    songMode: true,
    songProgress: 0,
    songStage: 'Writing the arrangement…',
    statusMessage: null,
  });

  const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));
  await yieldToUi();

  // --- 1. the objects, across the whole form ---
  const userBeat = gridToPattern(state.grid, state.objects);
  const fixedLabels = new Set(userBeat.map((u) => u.object.toLowerCase()));
  const fixedIds = new Set(
    state.objects.filter((o) => fixedLabels.has(o.label.toLowerCase())).map((o) => o.id),
  );

  const objectEvents = applyGroove(
    renderSong({
      objects: state.objects,
      objectPattern: plan.objectPattern,
      form,
      fixed: fixedLabels,
    }),
    {
      style: plan.style,
      bpm: plan.bpm,
      objects: state.objects,
      totalBeats: totalBars * 4,
      fixedIds,
    },
  );

  set({ songProgress: 0.15, songStage: 'Playing the parts…' });
  await yieldToUi();

  // --- 2. the synthesised backing, per section ---
  const layerEvents: LoopEvent[] = [];
  const rendered = new Set<number>();

  for (const layer of plan.accompaniment) {
    const slot = LAYER_SLOTS[layer];
    if (rendered.has(slot)) continue;
    rendered.add(slot);

    const buffer = new Float32Array(
      Math.ceil((totalBars * 4 * 60) / Math.max(1, plan.bpm)) * sr + sr,
    );

    for (let i = 0; i < form.length; i++) {
      const section = form[i];
      const density = SECTION_DENSITY[section.kind];
      // A layer the section silences is simply not rendered there; that
      // absence is what makes an intro sound like an intro.
      const role = LAYER_ROLE[layer];
      if ((density[role] ?? 1) <= 0) continue;

      const pcm = renderLayer(layer, {
        sampleRate: sr,
        bpm: plan.bpm,
        bars: section.bars,
        key: state.key,
        style: plan.style,
        // A chorus starts the chord cycle two degrees in, so it lands
        // somewhere other than where the verse did.
        rotation: section.kind === 'chorus' || section.kind === 'drop' ? 2 : 0,
      });

      const gain = SECTION_GAIN[section.kind] * (density[role] ?? 1);
      const start = Math.round(
        (section.startBar * 4 * 60 * sr) / Math.max(1, plan.bpm),
      );
      for (let f = 0; f < pcm.length && start + f < buffer.length; f++) {
        buffer[start + f] += pcm[f] * gain;
      }

      if (i % 2 === 1) await yieldToUi();
    }

    loadSample(slot, Array.from(buffer), 1);
    state.pcmBySlot.set(slot, Array.from(buffer));
    layerEvents.push({ objectId: `layer:${layer}`, beat: 0, velocity: 1 });

    set({ songProgress: 0.15 + 0.35 * (rendered.size / Math.max(1, plan.accompaniment.length)) });
    await yieldToUi();
  }

  // --- 3. play what we have, before waiting on the generator ---
  const songLoop: Loop = {
    id: SONG_LOOP_ID,
    name: 'Song',
    events: [...objectEvents, ...layerEvents].sort((a, b) => a.beat - b.beat),
    bars: totalBars,
    muted: false,
    createdAt: Date.now(),
  };

  // The loop and plan loops would double every hit; the song replaces them.
  const loops = [songLoop];
  transport.setResolver(resolveEvent(get));
  transport.setTempo(plan.bpm, totalBars);
  transport.setLoops(loops);
  set({
    loops,
    bars: totalBars,
    songProgress: 0.5,
    songStage: 'Generating the beds…',
  });

  if (!get().playing) get().togglePlay();

  // --- 4. the generated beds, one per distinct section kind ---
  if (get().textureOn && !textureUnavailableReason()) {
    const kinds = distinctKinds(form);
    const clips = new Map<SectionKind, number[]>();

    for (let k = 0; k < kinds.length; k++) {
      const kind = kinds[k];
      if (!get().songMode) return; // user backed out mid-build

      const prompt = buildSectionPrompt(
        kind,
        plan.style,
        plan.bpm,
        state.key,
        plan.texture,
        intentOf(get()),
      );
      set({
        songStage: `Generating the ${kind}…`,
        songProgress: 0.5 + 0.45 * (k / kinds.length),
      });

      const r = await generateTextureClip(
        prompt,
        // As long as the section, up to what the engine makes in one call.
        // SA3 covers an eight-bar section whole; the older engine's clip is
        // looped to fill it by assembleBed.
        Math.min(
          ((form.find((f) => f.kind === kind)?.bars ?? 4) * 240) / Math.max(1, plan.bpm),
          textureEngine().maxSeconds,
        ),
        // Shared nonce: the song's sections agree with each other, but a new
        // song is new music.
        sectionSeed(`${prompt}|${textureNonce}`),
      );
      if (r.ok && r.pcm && r.pcm.length > 0) clips.set(kind, r.pcm);
    }

    if (clips.size > 0) {
      const bed = assembleBed(
        form,
        (i) => {
          const pcm = clips.get(form[i].kind);
          return pcm ? { pcm } : null;
        },
        plan.bpm,
        sr,
      );
      loadSample(SLOT_TEXTURE, Array.from(bed), 1);
      state.pcmBySlot.set(SLOT_TEXTURE, Array.from(bed));

      const withBed: Loop = {
        ...songLoop,
        events: [...songLoop.events, ...bedEvents()].sort((a, b) => a.beat - b.beat),
      };
      transport.setLoops([withBed]);
      set({ loops: [withBed] });
    }
  }

  set({
    songProgress: null,
    songStage: null,
    statusMessage: `Song ready · ${totalBars} bars · ${Math.round(
      (totalBars * 4 * 60) / plan.bpm,
    )}s`,
  });
}

/** Last parameters each accompaniment slot was rendered with. */
const layerCache = new Map<number, string>();

const GRID_LOOP_ID = 'grid';

/**
 * Decides what is audible: the raw grid beat, or the AI production of it.
 *
 * Both loops are kept so switching AI mode is instant in either direction —
 * the user can A/B their beat against the produced track mid-playback.
 */
function syncBeatLoops(
  set: (partial: Partial<SessionState>) => void,
  get: () => SessionState,
): void {
  const s = get();
  const hasBeat = gridHitCount(s.grid) > 0;
  const aiAudible = s.aiMode && s.plan != null;

  let loops = s.loops.filter((l) => l.id !== GRID_LOOP_ID);
  if (hasBeat) {
    loops = upsertLoop(loops, {
      id: GRID_LOOP_ID,
      name: 'Your beat',
      events: gridToEvents(s.grid, s.objects, s.bars),
      bars: s.bars,
      muted: aiAudible,
      createdAt: Date.now(),
    });
  }
  loops = loops.map((l) =>
    l.id === PLAN_LOOP_ID ? { ...l, muted: hasBeat && !s.aiMode } : l,
  );

  // The texture belongs to the produced track: it plays whenever the plan
  // does, but only once the audio in its slot matches the current plan.
  loops = loops.filter((l) => l.id !== TEXTURE_LOOP_ID);
  const want = currentTextureKey(s);
  if (s.textureOn && want && want.key === loadedTextureKey) {
    loops = upsertLoop(loops, {
      id: TEXTURE_LOOP_ID,
      name: 'AI texture',
      events: textureEvents(s.bpm, s.bars, textureEngine().maxSeconds),
      bars: s.bars,
      muted: hasBeat && !s.aiMode,
      createdAt: Date.now(),
    });
  }

  transport.setLoops(loops);
  set({ loops });
}

let remixTimer: ReturnType<typeof setTimeout> | null = null;

/** Grid changed: update the raw loop now, and the AI production shortly after. */
function afterGridEdit(
  set: (partial: Partial<SessionState>) => void,
  get: () => SessionState,
): void {
  syncBeatLoops(set, get);

  const s = get();
  if (!s.aiMode || !s.producerPlan) return;

  // Debounced so a quick run of taps re-renders once, not per tap. The model
  // is not called again: the producer's plan is reused with the new beat.
  if (remixTimer) clearTimeout(remixTimer);
  remixTimer = setTimeout(() => {
    remixTimer = null;
    const st = get();
    if (st.aiMode && st.producerPlan) applyPlan(st.producerPlan, set, get);
  }, 350);
}
