import { generatePlan as gemmaArrange } from '@/ai/gemma';
import { SECTION_DENSITY, SECTION_GAIN, type Section, type SectionKind } from '@/audio/arrangement';
import { describeObjects, genreTempo, grooveFor, matchGenre, type GenreProfile } from '@/audio/genres';
import { applyGroove, directTempo } from '@/audio/groove';
import { buildSongForm, distinctKinds, renderSong } from '@/audio/song';
import { buildSectionPrompt, sectionSeed } from '@/audio/texture';
import type { AccompanimentLayer, ArrangementPlan, MusicalRole, Style, VocalTake, WorldJamObject } from '@/types';

import type { FeatureVector } from '../contracts/library';
import type { BusName, LayerRole, MusicPlan, NoteName, PlanLayer, PlanSection, StyleId, SynthInstrument } from '../contracts/musicPlan';
import { MUSIC_PLAN_SCHEMA_VERSION } from '../contracts/musicPlan';
import type { RenderEvent, RenderGraph, RenderLayer, RenderSource } from '../contracts/renderGraph';
import { assembleGraph } from './planCompiler';

/**
 * The music engine from master (src/state/sessionStore.ts `arrange` +
 * `applyPlan` + `buildSong`), unchanged in its musical logic, rendered through
 * V2's offline mixer instead of the live transport:
 *
 *  1. the genre is read off the user's words (or the genre chip);
 *  2. Gemma arranges the objects — which sound plays on which beats, tempo,
 *     accompaniment, texture — steered toward that genre;
 *  3. a named genre's own groove is played by the user's objects, and its
 *     tempo range owns the bpm; with Stable Audio 3 installed the model makes
 *     the backing (drum-led genres keep a synth bass for weight);
 *  4. the song form (intro → verse → build → chorus → …) with section density,
 *     accents, fills and the style's swing/humanisation (applyGroove);
 *  5. accompaniment per section with the chorus entering the chord cycle two
 *     degrees in;
 *  6. Stable Audio 3 music per section kind, prompted with the genre's
 *     instruments, the section's colour, tempo, key and the drum policy.
 *
 * The one adaptation: master's form is a fixed two minutes; here it is scaled
 * to the length the user asked for. An edit ("more bass, faster") goes back to
 * Gemma with the current beats, and Gemma re-tunes them.
 */

export interface MasterSound {
  id: string;
  name: string;
  type: 'AUDIO' | 'VIDEO' | 'HUM' | 'VOCAL';
  role: LayerRole | null;
  features: FeatureVector | null;
  path: string;
  durationSec: number;
  /** The single hit master plays (findTransientWindow), seconds into the file. */
  hit?: { startSec: number; endSec: number } | null;
}

export interface MasterInput {
  sounds: MasterSound[];
  /** What the user typed or said. */
  words: string | null;
  /** The genre chip, as its label ("Mass beat"), when one is picked. */
  chipGenre: string | null;
  chipStyle: StyleId | null;
  /** The nearest legacy style for the chip (drives the synth/groove tables). */
  fallbackStyle: Style;
  durationSec: number;
  /** An edit on the current arrangement ("more bass, faster"): Gemma re-tunes the beats. */
  edit?: { instruction: string; previous: ArrangementPlan } | null;
  /** New on every Generate press, so the same words make new music. */
  nonce: number;
}

export interface MasterDeps {
  /** Synth accompaniment for one section, as a WAV file. */
  renderStem(layer: AccompanimentLayer, o: { bpm: number; bars: number; key: string | null; style: Style; rotation: number }): Promise<{ path: string; durationSec: number }>;
  /** Stable Audio music for one prompt, as a WAV file (null when unavailable). */
  renderBed?(prompt: string, seconds: number, seed: number): Promise<{ path: string; durationSec: number } | null>;
  /** True when the engine is Stable Audio 3 (it then makes the backing). */
  sa3: boolean;
  maxSeconds: number;
  onStage?(stage: 'ARRANGING' | 'COMPOSING' | 'RENDERING', progress: number, detail?: string): void;
}

export interface MasterResult {
  graph: RenderGraph;
  arrangement: ArrangementPlan;
  plan: MusicPlan;
  form: Section[];
  /** "Gemma arranged Mass beat · 134 BPM · Table 1,3 · Cup 2,4" */
  info: string;
  /** The exact music prompts Stable Audio got, per section kind. */
  prompts: Partial<Record<SectionKind, string>>;
  usedGemma: boolean;
}

const V2_TO_V1_ROLE: Record<LayerRole, MusicalRole> = {
  kick: 'kick', snare: 'snare', hat: 'hat', percussion: 'perc', bass: 'bass',
  chords: 'lead', lead: 'lead', pad: 'texture', texture: 'texture', fx: 'texture', vocal: 'lead',
};
const V1_TO_V2_ROLE: Record<MusicalRole, LayerRole> = { kick: 'kick', snare: 'snare', hat: 'hat', perc: 'percussion', bass: 'bass', lead: 'lead', texture: 'texture' };
const ROLE_BUS: Record<MusicalRole, BusName> = { kick: 'DRUMS', snare: 'DRUMS', hat: 'DRUMS', perc: 'DRUMS', bass: 'BASS', lead: 'MELODY', texture: 'TEXTURE' };
/** Accompaniment layer → the role the section density table knows it by (master's LAYER_ROLE). */
const LAYER_ROLE: Record<AccompanimentLayer, MusicalRole> = { bass: 'bass', chords: 'lead', pad: 'texture', arp: 'lead', guitar: 'lead', perc: 'perc' };
const LAYER_BUS: Record<AccompanimentLayer, BusName> = { bass: 'BASS', chords: 'HARMONY', pad: 'HARMONY', arp: 'MELODY', guitar: 'HARMONY', perc: 'DRUMS' };
const GENRE_TO_STYLE: Record<string, StyleId> = {
  phonk: 'phonk', mass: 'massbeat', bhangra: 'bhangra', bollywood: 'bollywood', carnatic: 'carnatic', 'indian-classical': 'indian_classical',
  trap: 'trap', hiphop: 'hiphop', lofi: 'lofi', pop: 'pop', edm: 'edm', afrobeat: 'afrobeats', reggaeton: 'reggaeton', jazz: 'jazz',
  rock: 'rock', cinematic: 'cinematic', chill: 'chill',
};
const STYLE_OF_V1: Record<Style, StyleId> = { chill: 'chill', jazz: 'jazz', lofi: 'lofi', cinematic: 'cinematic', edm: 'edm', rock: 'rock' };
const NOTES: NoteName[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** A captured sound as one of master's objects. */
function toObject(s: MasterSound, i: number): WorldJamObject {
  const f = s.features;
  return {
    id: s.id,
    label: s.name,
    category: 'other' as WorldJamObject['category'],
    slot: i,
    position: { x: 0.5, y: 0.5 },
    features: f ? { duration: f.durationSec, energy: f.rms, brightness: f.brightness, decay: f.decay, pitch: f.pitchHz, tonality: f.tonality } : null,
    role: V2_TO_V1_ROLE[s.role ?? 'percussion'] ?? 'perc',
    beatPattern: [],
    volume: 1,
    pan: 0.5,
    color: '',
    createdAt: 0,
  };
}

/** Master's two-minute form scaled to the requested length (whole bars, song order kept). */
export function formForLength(style: Style, bpm: number, seconds: number): Section[] {
  const base = buildSongForm(style);
  const baseBars = base.reduce((n, s) => n + s.bars, 0);
  const target = Math.max(1, Math.round((seconds * bpm) / 240));
  let parts = base.map((s) => ({ kind: s.kind, bars: (s.bars * target) / baseBars }));
  // Too short for every section: keep the ones that carry the song (chorus/drop/verse first).
  const rank: Record<string, number> = { chorus: 0, drop: 1, verse: 2, build: 3, intro: 4, outro: 5 };
  if (target < parts.length) {
    const keep = new Set(parts.map((p, i) => ({ p, i })).sort((a, b) => (rank[a.p.kind] ?? 9) - (rank[b.p.kind] ?? 9)).slice(0, target).map((x) => x.i));
    parts = parts.filter((_, i) => keep.has(i)).map((p) => ({ ...p, bars: target / keep.size }));
  }
  const bars = parts.map((p) => Math.max(1, Math.round(p.bars)));
  let diff = target - bars.reduce((a, b) => a + b, 0);
  const main = parts.findIndex((p) => p.kind === 'chorus' || p.kind === 'drop');
  while (diff !== 0) {
    const i = diff > 0 ? Math.max(0, main) : bars.findIndex((b, k) => b > 1 && k !== main) >= 0 ? bars.findIndex((b, k) => b > 1 && k !== main) : bars.findIndex((b) => b > 1);
    if (i < 0) break;
    bars[i] += diff > 0 ? 1 : -1;
    diff += diff > 0 ? -1 : 1;
  }
  let start = 0;
  return parts.map((p, i) => {
    const s = { kind: p.kind, startBar: start, bars: bars[i] };
    start += bars[i];
    return s;
  });
}

const beatsToPattern = (beats: number[]): string => {
  const steps = Array.from({ length: 16 }, () => '.');
  for (const b of beats) {
    const k = Math.round((b - 1) * 4);
    if (k >= 0 && k < 16) steps[k] = Number.isInteger(b) ? 'X' : 'x';
  }
  return steps.join('');
};

function parseKey(key: string | null, genre: GenreProfile | null): { note: NoteName; minor: boolean } {
  const m = key?.match(/^([A-G]#?)/);
  const note = (m && NOTES.includes(m[1] as NoteName) ? m[1] : 'A') as NoteName;
  const minor = key ? /min|m$/i.test(key) : genre?.minor ?? true;
  return { note, minor };
}

export async function masterGenerate(input: MasterInput, deps: MasterDeps): Promise<MasterResult> {
  const voice = input.sounds.find((s) => (s.type === 'HUM' || s.type === 'VOCAL') && (s.features?.melody?.notes.length ?? 0) >= 3) ?? null;
  const kit = input.sounds.filter((s) => s !== voice && s.type !== 'HUM' && s.type !== 'VOCAL');
  const objects = kit.map(toObject);
  if (objects.length === 0) throw new Error('Add at least one sound (not only a hum) — your objects are the instruments.');

  // 1. Genre from the user's words first, then the chip (master's arrange).
  const words = input.words?.trim() || input.chipGenre || null;
  const asked = matchGenre(words) ?? matchGenre(input.chipGenre);
  const style: Style = asked?.style ?? input.fallbackStyle;

  const vocal: VocalTake | null = voice?.features?.melody
    ? {
        id: voice.id,
        slot: 0,
        duration: voice.durationSec,
        notes: voice.features.melody.notes.map((n) => ({ midi: n.midi, time: n.start, duration: n.duration, confidence: 1 })),
        detectedKey: voice.features.melody.key,
        muted: false,
      }
    : null;

  // 2. Gemma arranges the beats (or re-tunes them for an edit).
  deps.onStage?.('ARRANGING', 0, 'Gemma is arranging your beats');
  const prev = input.edit?.previous ?? null;
  const instruction = input.edit
    ? `${input.edit.instruction}. Current arrangement to change: ${prev!.genre ?? prev!.style} at ${prev!.bpm} BPM, beats ${JSON.stringify(prev!.objectPattern)}, accompaniment ${JSON.stringify(prev!.accompaniment)}.`
    : words ?? undefined;
  const result = await gemmaArrange(
    { objects, vocal, bpmHint: prev?.bpm ?? null, style: prev?.style ?? style, mood: undefined },
    instruction,
  );
  const said = input.edit ? prev!.request : words ?? undefined;
  const plan: ArrangementPlan = { ...result.plan, request: said, genre: result.plan.genre ?? prev?.genre ?? asked?.name };

  const genre = matchGenre(plan.request) ?? matchGenre(plan.genre) ?? asked;
  if (genre) {
    // 3. The genre's own beat on the user's objects (a fresh arrangement); an
    // edit keeps the beats Gemma just re-tuned.
    if (!input.edit) {
      const groove = grooveFor(genre, objects);
      if (groove) plan.objectPattern = groove;
    }
    if (deps.sa3) plan.accompaniment = genre.percussion ? ['bass'] : [];
  }
  const directed = directTempo(plan.style, objects, plan.bpm);
  const bpm = genre ? genreTempo(genre, plan.bpm || directed) : directed;
  plan.bpm = bpm;

  // 4. The song form at the requested length, objects across it with feel.
  const form = formForLength(plan.style, bpm, input.durationSec);
  const totalBars = form.reduce((n, s) => n + s.bars, 0);
  const objectEvents = applyGroove(renderSong({ objects, objectPattern: plan.objectPattern, form }), {
    style: plan.style,
    bpm,
    objects,
    totalBeats: totalBars * 4,
  });
  plan.bars = totalBars;

  const secPerBeat = 60 / bpm;
  const sources: RenderSource[] = [];
  const layers: RenderLayer[] = [];
  const toDb = (v: number) => 20 * Math.log10(Math.max(0.05, v));

  for (const o of objects) {
    const s = kit.find((k) => k.id === o.id)!;
    const hitLen = s.hit ? s.hit.endSec - s.hit.startSec : s.durationSec;
    const events: RenderEvent[] = objectEvents
      .filter((e) => e.objectId === o.id)
      .map((e) => ({ timeSec: Math.max(0, e.beat * secPerBeat), rate: 1, gainDb: toDb(e.velocity), durationSec: Math.min(hitLen, secPerBeat * 2), fadeOutSec: 0.02 }));
    if (!events.length) continue;
    sources.push({ id: `cap_${o.id}`, path: s.path, ...(s.hit ? { trimStartSec: s.hit.startSec, trimEndSec: s.hit.endSec } : {}) });
    layers.push({ id: `obj_${o.id}`, sourceId: `cap_${o.id}`, bus: ROLE_BUS[o.role], gainDb: 0, pan: 0, effects: [], events });
  }

  // 5. Accompaniment per section (chorus/drop rotated two degrees).
  const genreKey = vocal?.detectedKey ?? null;
  const key = parseKey(genreKey, genre);
  const keyText = `${key.note} ${key.minor ? 'minor' : 'major'}`;
  const seen = new Set<string>();
  for (const layer of plan.accompaniment) {
    const slotKey = layer === 'pad' ? 'chords' : layer;
    if (seen.has(slotKey)) continue;
    seen.add(slotKey);
    const events: RenderEvent[] = [];
    for (const section of form) {
      const density = SECTION_DENSITY[section.kind][LAYER_ROLE[layer]] ?? 1;
      if (density <= 0) continue;
      const rotation = section.kind === 'chorus' || section.kind === 'drop' ? 2 : 0;
      const stem = await deps.renderStem(layer, { bpm, bars: section.bars, key: keyText, style: plan.style, rotation });
      const id = `acc_${layer}_${section.bars}_${rotation}`;
      if (!sources.some((x) => x.id === id)) sources.push({ id, path: stem.path });
      events.push({ timeSec: section.startBar * 4 * secPerBeat, rate: 1, gainDb: toDb(SECTION_GAIN[section.kind] * density), fadeInSec: 0.01, fadeOutSec: 0.05, sourceId: id } as RenderEvent & { sourceId: string });
    }
    // One layer per stem file (a layer plays one source).
    const bySource = new Map<string, RenderEvent[]>();
    for (const e of events as Array<RenderEvent & { sourceId: string }>) {
      const { sourceId, ...ev } = e;
      bySource.set(sourceId, [...(bySource.get(sourceId) ?? []), ev]);
    }
    for (const [sourceId, evs] of bySource) layers.push({ id: sourceId, sourceId, bus: LAYER_BUS[layer], gainDb: -3, pan: 0, effects: [], events: evs });
  }

  // 6. Stable Audio music per section kind (master's buildSong beds).
  const prompts: Partial<Record<SectionKind, string>> = {};
  if (deps.renderBed) {
    const kinds = distinctKinds(form);
    const intent = { instruction: plan.request ?? null, genre: plan.genre ?? null, objects: describeObjects(objects) };
    for (let k = 0; k < kinds.length; k++) {
      const kind = kinds[k];
      const prompt = buildSectionPrompt(kind, plan.style, bpm, keyText, plan.texture, intent);
      prompts[kind] = prompt;
      deps.onStage?.('COMPOSING', k / kinds.length, `Stable Audio is making the ${kind}`);
      const bars = form.find((f) => f.kind === kind)?.bars ?? 4;
      const seconds = Math.min((bars * 240) / bpm + 0.2, deps.maxSeconds);
      const clip = await deps.renderBed(prompt, seconds, sectionSeed(`${prompt}|${input.nonce}`));
      if (!clip) continue;
      const id = `bed_${kind}`;
      sources.push({ id, path: clip.path });
      const xfade = 0.08;
      const events: RenderEvent[] = [];
      for (const section of form.filter((f) => f.kind === kind)) {
        const start = section.startBar * 4 * secPerBeat;
        const end = (section.startBar + section.bars) * 4 * secPerBeat;
        for (let t = start; t < end - 0.05; t += Math.max(1, clip.durationSec - xfade)) {
          events.push({ timeSec: t, durationSec: Math.min(clip.durationSec, end - t + xfade), rate: 1, gainDb: 0, fadeInSec: t === 0 ? 0.02 : xfade, fadeOutSec: xfade });
        }
      }
      layers.push({ id, sourceId: id, bus: 'HARMONY', gainDb: -2, pan: 0, effects: [], events });
    }
    deps.onStage?.('COMPOSING', 1);
  }

  // The user's own voice over the song, as recorded, once per verse/chorus.
  if (voice && plan.voiceRole !== 'none') {
    sources.push({ id: `cap_${voice.id}`, path: voice.path });
    const events = form
      .filter((f) => f.kind === 'verse' || f.kind === 'chorus' || form.length <= 2)
      .map((f) => {
        const start = f.startBar * 4 * secPerBeat;
        return { timeSec: start, durationSec: Math.min(voice.durationSec, f.bars * 4 * secPerBeat), rate: 1, gainDb: 0, fadeInSec: 0.02, fadeOutSec: 0.25 };
      });
    if (events.length) layers.push({ id: 'voice', sourceId: `cap_${voice.id}`, bus: 'VOCAL', gainDb: 0, pan: 0, effects: [], events });
  }

  const durationSec = totalBars * 4 * secPerBeat;
  deps.onStage?.('RENDERING', 0);
  const graph = assembleGraph({ sources, layers, bpm, durationSec, reverb: 0.3, warmth: 0.3 });

  // A MusicPlan describing the same song, for karaoke timing, saving, games.
  const styleId = (genre && GENRE_TO_STYLE[genre.id]) ?? input.chipStyle ?? STYLE_OF_V1[plan.style];
  let bar0 = 0;
  const sections: PlanSection[] = form.map((f, i) => {
    const s: PlanSection = {
      id: `${f.kind}${i + 1}`,
      kind: f.kind,
      bars: f.bars,
      energy: SECTION_GAIN[f.kind],
      layers: [],
      startSec: +(bar0 * 4 * secPerBeat).toFixed(3),
      endSec: +((bar0 + f.bars) * 4 * secPerBeat).toFixed(3),
    };
    bar0 += f.bars;
    return s;
  });
  const planLayers: PlanLayer[] = [];
  for (const p of plan.objectPattern) {
    const o = objects.find((x) => x.label.toLowerCase() === p.object.toLowerCase());
    if (!o) continue;
    const id = `obj_${o.id}`;
    planLayers.push({ id, source: { kind: 'capture', captureId: o.id }, role: V1_TO_V2_ROLE[o.role], gainDb: 0, pan: 0, pattern: beatsToPattern(p.beats) });
    for (const s of sections) if ((SECTION_DENSITY[s.kind as SectionKind]?.[o.role] ?? 1) > 0) s.layers.push(id);
  }
  for (const layer of seen) {
    const inst = (layer === 'perc' ? 'bass' : layer) as SynthInstrument;
    planLayers.push({ id: `synth_${layer}`, source: { kind: 'synth', instrument: inst }, role: layer === 'bass' ? 'bass' : 'chords', gainDb: -3, pan: 0 });
    for (const s of sections) s.layers.push(`synth_${layer}`);
  }
  if (voice) {
    planLayers.push({ id: 'voice', source: { kind: 'capture', captureId: voice.id }, role: 'vocal', gainDb: 0, pan: 0, pitch: { mode: 'hum', captureId: voice.id } });
    for (const s of sections) if (s.kind === 'verse' || s.kind === 'chorus') s.layers.push('voice');
  }
  for (const s of sections) if (s.layers.length === 0 && planLayers[0]) s.layers.push(planLayers[0].id);

  const genreName = genre?.name ?? plan.genre ?? styleId;
  const musicPlan: MusicPlan = {
    schemaVersion: MUSIC_PLAN_SCHEMA_VERSION,
    title: `${genreName} ${objects[0]?.label ?? 'jam'}`.replace(/^\w/, (c) => c.toUpperCase()),
    style: styleId,
    tempoBpm: bpm,
    timeSignature: '4/4',
    key: key.note,
    scale: key.minor ? 'minor' : 'major',
    durationSec: +durationSec.toFixed(3),
    sections,
    layers: planLayers,
    mix: { reverb: 0.3, width: 0.7, warmth: 0.3 },
    lyrics: null,
    caption: prompts.chorus ?? prompts.verse ?? Object.values(prompts)[0] ?? plan.texture,
  };

  const beatsText = plan.objectPattern.slice(0, 4).map((p) => `${p.object} ${p.beats.join(',')}`).join(' · ');
  const info = `${result.usedFallback ? 'Rule-based' : 'Gemma'} arranged ${genreName} · ${bpm} BPM · ${beatsText}`;
  return { graph, arrangement: plan, plan: musicPlan, form, info, prompts, usedGemma: !result.usedFallback };
}
