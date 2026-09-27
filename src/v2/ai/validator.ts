import { extractJson } from '@/ai/schema';

import {
  MUSIC_PLAN_SCHEMA_VERSION,
  PLAN_LIMITS,
  STYLE_IDS,
  type LayerPitch,
  type LayerRole,
  type LayerSource,
  type MusicPlan,
  type NoteName,
  type PlanEffect,
  type PlanEvent,
  type PlanLayer,
  type PlanLyrics,
  type PlanSection,
  type ScaleId,
  type SectionKind,
  type StyleId,
  type SynthInstrument,
} from '../contracts/musicPlan';
import { ROLE_BUS } from './kb/rules';
import { barsFor, formFor, styleSpec } from './kb/styles';

/** What the validator knows about the session's sounds. */
export interface CaptureRef {
  id: string;
  name: string;
  role: LayerRole;
  tonal: boolean;
  isVoice: boolean;
}

export interface ValidateContext {
  captures: CaptureRef[];
  /** Target length (10-90 s); the plan is fitted to it within about one bar (<= ~2 s). */
  durationSec: number;
  style?: StyleId | null;
  /** The user chose the genre (chip or named in the prompt): the model may not change it. */
  lockStyle?: boolean;
  /** Fixed by the user's hum/grid: the model may not change these. */
  lock?: { tempoBpm?: number | null; key?: NoteName | null; scale?: ScaleId | null };
  /** Capture ids the prompt asked to feature — they must be prominent. */
  featured?: string[];
  excluded?: string[];
}

export interface ValidationResult {
  plan: MusicPlan | null;
  repairs: string[];
  /** Problems severe enough to ask the model for one repair round. */
  errors: string[];
}

const NOTES: NoteName[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS: Record<string, NoteName> = { DB: 'C#', EB: 'D#', GB: 'F#', AB: 'G#', BB: 'A#' };
const SCALES: ScaleId[] = ['major', 'minor', 'dorian', 'mixolydian', 'pentatonic_minor', 'pentatonic_major'];
const KINDS: SectionKind[] = ['intro', 'verse', 'build', 'chorus', 'drop', 'bridge', 'breakdown', 'outro'];
const ROLES: LayerRole[] = ['kick', 'snare', 'hat', 'percussion', 'bass', 'chords', 'pad', 'lead', 'vocal', 'texture', 'fx'];
const SYNTHS: SynthInstrument[] = ['bass', 'chords', 'pad', 'arp', 'guitar'];
const SUSTAINED: LayerRole[] = ['pad', 'texture', 'vocal'];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Model numbers are whole percents (grammar-safe: no endless decimals); plans keep 0..1 / -1..1. */
export const unit = (v: number): number => (Math.abs(v) > 1 ? v / 100 : v);

export function normalizeKey(raw: unknown): { key: NoteName | null; scale: ScaleId | null } {
  if (typeof raw !== 'string') return { key: null, scale: null };
  const m = raw.trim().match(/^([A-Ga-g])([#b♯♭]?)\s*(m(?!aj)|min(or)?|maj(or)?)?/);
  if (!m) return { key: null, scale: null };
  let name = m[1].toUpperCase() + (m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2]);
  if (name.endsWith('b')) name = FLATS[name.toUpperCase()] ?? name[0];
  const key = (NOTES as string[]).includes(name) ? (name as NoteName) : null;
  const scale: ScaleId | null = m[3] ? (m[3].startsWith('maj') ? 'major' : 'minor') : null;
  return { key, scale };
}

/** A pattern must be 16 steps of X x - . ; `groove:<role>` expands from the style. */
export function normalizePattern(raw: unknown, role: LayerRole, style: StyleId): string | undefined {
  const spec = styleSpec(style);
  if (typeof raw === 'string') {
    const s = raw.trim();
    const g = s.match(/^groove:(\w+)/);
    if (g) return spec.grooves[g[1] as LayerRole] ?? spec.grooves[role] ?? spec.grooves.percussion;
    const cleaned = s.replace(/[^Xx.\-0-9o*]/g, '').replace(/[1-9*o]/g, 'x').replace(/0/g, '.');
    if (cleaned.length >= 4 && /[Xx]/.test(cleaned)) {
      // Stretch/cut to exactly one bar of sixteenths.
      if (cleaned.length === 16) return cleaned;
      const out: string[] = [];
      for (let i = 0; i < 16; i++) out.push(cleaned[Math.floor((i * cleaned.length) / 16)]);
      return out.join('');
    }
  }
  if (SUSTAINED.includes(role)) return undefined;
  return spec.grooves[role] ?? spec.grooves.percussion ?? 'X...x...X...x...';
}

function normalizeEffect(raw: unknown): PlanEffect | null {
  const e = obj(raw);
  if (!e) return null;
  switch (e.type) {
    case 'lowpass':
    case 'highpass':
      return isNum(e.cutoffHz) ? { type: e.type, cutoffHz: clamp(e.cutoffHz, 40, 18000), q: isNum(e.q) ? clamp(e.q, 0.3, 8) : undefined } : null;
    case 'eq':
      return isNum(e.freqHz) && isNum(e.gainDb) ? { type: 'eq', freqHz: clamp(e.freqHz, 40, 16000), gainDb: clamp(e.gainDb, -12, 12), q: isNum(e.q) ? clamp(e.q, 0.3, 8) : undefined } : null;
    case 'delay':
      return { type: 'delay', beats: clamp(isNum(e.beats) ? e.beats : 0.75, 0.125, 4), feedback: clamp(isNum(e.feedback) ? unit(e.feedback) : 0.3, 0, 0.85), mix: clamp(isNum(e.mix) ? unit(e.mix) : 0.2, 0, 0.8) };
    case 'reverb':
      return { type: 'reverb', size: clamp(isNum(e.size) ? unit(e.size) : 0.5, 0, 1), mix: clamp(isNum(e.mix) ? unit(e.mix) : 0.25, 0, 0.8) };
    case 'saturation':
      return { type: 'saturation', drive: clamp(isNum(e.drive) ? e.drive : 2, 1, 8), mix: isNum(e.mix) ? clamp(unit(e.mix), 0, 1) : undefined };
    case 'compressor':
      return { type: 'compressor', amount: clamp(isNum(e.amount) ? unit(e.amount) : 0.5, 0, 1) };
    default:
      return null;
  }
}

function normalizeSource(raw: unknown, ctx: ValidateContext): LayerSource | null {
  const byId = new Map(ctx.captures.map((c) => [c.id.toLowerCase(), c]));
  const byName = new Map(ctx.captures.map((c) => [c.name.toLowerCase(), c]));
  const capture = (key: string) => byId.get(key.toLowerCase()) ?? byName.get(key.toLowerCase()) ?? null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    const synth = s.match(/^synth[:_\s-]?(\w+)/i);
    if (synth) return SYNTHS.includes(synth[1].toLowerCase() as SynthInstrument) ? { kind: 'synth', instrument: synth[1].toLowerCase() as SynthInstrument } : null;
    if (/^texture/i.test(s)) return { kind: 'texture', prompt: s.replace(/^texture[:\s]*/i, '') || 'soft ambient pad' };
    const c = capture(s.replace(/^capture[:\s]*/i, ''));
    return c ? { kind: 'capture', captureId: c.id } : null;
  }
  const o = obj(raw);
  if (!o) return null;
  if (o.kind === 'capture' && typeof o.captureId === 'string') {
    const c = capture(o.captureId);
    return c ? { kind: 'capture', captureId: c.id } : null;
  }
  if (o.kind === 'synth' && SYNTHS.includes(o.instrument as SynthInstrument)) return { kind: 'synth', instrument: o.instrument as SynthInstrument };
  if (o.kind === 'texture') return { kind: 'texture', prompt: typeof o.prompt === 'string' && o.prompt.trim() ? o.prompt.slice(0, 160) : 'soft ambient pad' };
  if (typeof o.sourceCaptureId === 'string') return normalizeSource(o.sourceCaptureId, ctx);
  return null;
}

function normalizePitch(raw: unknown, role: LayerRole, source: LayerSource, ctx: ValidateContext): LayerPitch | undefined {
  const cap = source.kind === 'capture' ? ctx.captures.find((c) => c.id === source.captureId) : null;
  if (cap?.isVoice) return { mode: 'hum', captureId: cap.id };
  const o = obj(raw);
  const mode = typeof raw === 'string' ? raw : o && typeof o.mode === 'string' ? o.mode : null;
  if (mode === 'fixed' || (o && isNum(o.semitones))) return { mode: 'fixed', semitones: clamp(o && isNum(o.semitones) ? Math.round(o.semitones) : 0, -24, 24) };
  if ((mode === 'bass' || mode === 'chords' || mode === 'melody') && cap?.tonal) return { mode };
  // A pitched part only makes sense for a tonal sound; otherwise play it as recorded.
  if (cap?.tonal && (role === 'bass' || role === 'chords' || role === 'lead')) return { mode: role === 'lead' ? 'melody' : role };
  return undefined;
}

function normalizeEvents(raw: unknown, durationSec: number): PlanEvent[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: PlanEvent[] = [];
  for (const r of raw.slice(0, 512)) {
    const e = obj(r);
    if (!e || !isNum(e.timeSec) || e.timeSec < 0 || e.timeSec > durationSec) continue;
    out.push({
      type: 'trigger',
      timeSec: e.timeSec,
      durationSec: isNum(e.durationSec) ? clamp(e.durationSec, 0.01, 30) : undefined,
      pitchSemitones: isNum(e.pitchSemitones) ? clamp(Math.round(e.pitchSemitones), -24, 24) : undefined,
      gainDb: isNum(e.gainDb) ? clamp(e.gainDb, PLAN_LIMITS.gainMin, PLAN_LIMITS.gainMax) : undefined,
      pan: isNum(e.pan) ? clamp(unit(e.pan), -1, 1) : undefined,
    });
  }
  return out.length ? out.sort((a, b) => a.timeSec - b.timeSec) : undefined;
}

/**
 * Validates and repairs a candidate plan (model output or a patched plan).
 * Never throws. Returns plan=null only when nothing playable survives.
 */
export function validatePlan(input: unknown, ctx: ValidateContext): ValidationResult {
  const repairs: string[] = [];
  const errors: string[] = [];
  // 1. Parse.
  const parsed = typeof input === 'string' ? extractJson(input) : input;
  const raw = obj(parsed);
  if (!raw) return { plan: null, repairs, errors: ['response was not a JSON object'] };

  // 2. Schema basics: style, tempo, key.
  let style: StyleId = ctx.lockStyle && ctx.style ? ctx.style : STYLE_IDS.includes(raw.style as StyleId) ? (raw.style as StyleId) : ctx.style ?? 'chill';
  if (raw.style !== style) repairs.push(`style ${String(raw.style)} → ${style}`);
  const spec = styleSpec(style);

  let tempo = isNum(raw.tempoBpm) ? raw.tempoBpm : isNum(raw.bpm) ? raw.bpm : NaN;
  if (ctx.lock?.tempoBpm) {
    if (tempo !== ctx.lock.tempoBpm) repairs.push('tempo locked to the recorded voice/beat');
    tempo = ctx.lock.tempoBpm;
  } else if (Number.isNaN(tempo)) {
    tempo = spec.tempo.home;
    repairs.push('tempo missing');
  } else if (tempo < PLAN_LIMITS.tempoMin || tempo > PLAN_LIMITS.tempoMax) {
    const t0 = tempo;
    while (tempo > PLAN_LIMITS.tempoMax) tempo /= 2;
    while (tempo < PLAN_LIMITS.tempoMin) tempo *= 2;
    repairs.push(`tempo ${t0} folded to ${Math.round(tempo)}`);
  }
  tempo = Math.round(clamp(tempo, PLAN_LIMITS.tempoMin, PLAN_LIMITS.tempoMax));

  const nk = normalizeKey(raw.key);
  let key: NoteName = ctx.lock?.key ?? nk.key ?? 'A';
  let scale: ScaleId = ctx.lock?.scale ?? (SCALES.includes(raw.scale as ScaleId) ? (raw.scale as ScaleId) : nk.scale ?? spec.scale);
  if (!nk.key && !ctx.lock?.key) repairs.push('key missing, using A');

  // 3–4. Layers: source ids, roles, bounds, patterns.
  const layers: PlanLayer[] = [];
  const seen = new Set<string>();
  const rawLayers = Array.isArray(raw.layers) ? raw.layers : [];
  if (rawLayers.length === 0) errors.push('no layers');
  for (const rl of rawLayers) {
    if (layers.length >= PLAN_LIMITS.maxLayers) {
      repairs.push('too many layers, extra dropped');
      break;
    }
    const l = obj(rl);
    if (!l) continue;
    const source = normalizeSource(l.source ?? l.sourceCaptureId, ctx);
    if (!source) {
      errors.push(`layer ${String(l.id ?? '?')} uses a sound that does not exist (${JSON.stringify(l.source ?? l.sourceCaptureId)})`);
      continue;
    }
    if (source.kind === 'capture' && ctx.excluded?.includes(source.captureId)) {
      repairs.push('excluded sound removed');
      continue;
    }
    const cap = source.kind === 'capture' ? ctx.captures.find((c) => c.id === source.captureId) : null;
    let role: LayerRole = ROLES.includes(l.role as LayerRole) ? (l.role as LayerRole) : cap?.role ?? (source.kind === 'synth' ? (source.instrument === 'arp' || source.instrument === 'guitar' ? 'chords' : (source.instrument as LayerRole)) : 'texture');
    if (cap?.isVoice) role = 'vocal';
    let id = typeof l.id === 'string' && l.id.trim() ? l.id.trim().slice(0, 40) : `layer${layers.length + 1}`;
    while (seen.has(id)) id = `${id}_${layers.length + 1}`;
    seen.add(id);
    const pattern = normalizePattern(l.pattern, role, style);
    layers.push({
      id,
      source,
      role,
      bus: ROLE_BUS[role],
      gainDb: clamp(isNum(l.gainDb) ? l.gainDb : role === 'texture' ? -8 : -4, PLAN_LIMITS.gainMin, PLAN_LIMITS.gainMax),
      pan: clamp(isNum(l.pan) ? unit(l.pan) : 0, -1, 1),
      pattern,
      pitch: normalizePitch(l.pitch, role, source, ctx),
      effects: (Array.isArray(l.effects) ? l.effects : []).map(normalizeEffect).filter((e): e is PlanEffect => !!e).slice(0, 4),
      events: normalizeEvents(l.events, PLAN_LIMITS.durationMax),
    });
  }
  if (layers.length === 0) return { plan: null, repairs, errors: errors.length ? errors : ['no playable layers'] };

  // Featured sounds must be in the plan.
  for (const fid of ctx.featured ?? []) {
    if (!layers.some((l) => l.source.kind === 'capture' && l.source.captureId === fid)) {
      const cap = ctx.captures.find((c) => c.id === fid);
      if (!cap) continue;
      const role = cap.isVoice ? 'vocal' : cap.role;
      layers.push({ id: `featured_${layers.length + 1}`, source: { kind: 'capture', captureId: fid }, role, bus: ROLE_BUS[role], gainDb: -2, pan: 0, pattern: normalizePattern(undefined, role, style), pitch: normalizePitch(undefined, role, { kind: 'capture', captureId: fid }, ctx) });
      repairs.push(`featured sound "${cap.name}" added`);
    }
  }
  const layerIds = new Set(layers.map((l) => l.id));

  // 5. Sections.
  let sections: PlanSection[] = [];
  for (const rs of Array.isArray(raw.sections) ? raw.sections.slice(0, PLAN_LIMITS.maxSections) : []) {
    const s = obj(rs);
    if (!s) continue;
    const kind: SectionKind = KINDS.includes(s.kind as SectionKind) ? (s.kind as SectionKind) : KINDS.includes(s.id as SectionKind) ? (s.id as SectionKind) : 'verse';
    const bars = clamp(isNum(s.bars) ? Math.round(s.bars) : isNum(s.startSec) && isNum(s.endSec) ? Math.round(((s.endSec - s.startSec) * tempo) / 240) : 4, 1, 32);
    const lids = (Array.isArray(s.layers) ? s.layers : []).filter((x): x is string => typeof x === 'string' && layerIds.has(x));
    sections.push({ id: `${kind}${sections.length + 1}`, kind, bars, energy: clamp(isNum(s.energy) ? unit(s.energy) : 0.6, 0, 1), layers: lids });
  }
  const target = clamp(isNum(ctx.durationSec) ? ctx.durationSec : 30, PLAN_LIMITS.durationMin, PLAN_LIMITS.durationMax);
  const targetBars = barsFor(target, tempo);
  if (sections.length === 0) {
    repairs.push('sections missing, using the style form');
    sections = formFor(spec, targetBars).map((f, i) => ({ id: `${f.kind}${i + 1}`, kind: f.kind, bars: f.bars, energy: f.energy, layers: [...layerIds] }));
  }
  // A section with no layers plays everything (better than silence).
  for (const s of sections) {
    if (s.layers.length === 0) {
      s.layers = [...layerIds];
      repairs.push(`section ${s.id} had no layers`);
    }
  }

  // 6. Duration: fitted to the requested length (10-90 s) to the nearest bar.
  const secPerBar = 240 / tempo;
  let totalBars = sections.reduce((n, s) => n + s.bars, 0);
  if (totalBars < targetBars) {
    const main = sections.reduce((best, s) => (s.energy > best.energy ? s : best), sections[0]);
    while (totalBars < targetBars) {
      const extra = Math.min(Math.max(1, main.bars), targetBars - totalBars, 8);
      const insertAt = sections.indexOf(main) + 1;
      sections.splice(insertAt, 0, { ...main, id: `${main.kind}${sections.length + 1}`, bars: extra, layers: [...main.layers] });
      totalBars += extra;
    }
    repairs.push(`extended to ${Math.round(totalBars * secPerBar)} s`);
  }
  if (totalBars > targetBars) {
    // Shorten the longest sections a bar at a time; if every section is one bar, drop the quietest.
    while (totalBars > targetBars) {
      const longest = sections.reduce((best, s) => (s.bars > best.bars ? s : best), sections[0]);
      if (longest.bars > 1) {
        longest.bars -= 1;
      } else if (sections.length > 1) {
        const quiet = sections.reduce((low, s) => (s.energy < low.energy ? s : low), sections[0]);
        sections.splice(sections.indexOf(quiet), 1);
      } else break;
      totalBars = sections.reduce((n, s) => n + s.bars, 0);
    }
    repairs.push(`fitted to ${Math.round(totalBars * secPerBar)} s`);
  }
  let t = 0;
  for (const s of sections) {
    s.startSec = +(t * secPerBar).toFixed(3);
    t += s.bars;
    s.endSec = +(t * secPerBar).toFixed(3);
  }
  const durationSec = +(totalBars * secPerBar).toFixed(3);

  // 7. Every layer plays somewhere; 8. featured sounds are prominent.
  const main = [...sections].sort((a, b) => b.energy - a.energy).slice(0, Math.max(1, Math.ceil(sections.length / 2)));
  for (const l of layers) {
    if (!sections.some((s) => s.layers.includes(l.id))) {
      for (const s of main) s.layers.push(l.id);
      repairs.push(`layer ${l.id} was unused`);
    }
  }
  for (const fid of ctx.featured ?? []) {
    for (const l of layers.filter((x) => x.source.kind === 'capture' && x.source.captureId === fid)) {
      l.gainDb = Math.max(l.gainDb, -1);
      const present = sections.filter((s) => s.layers.includes(l.id)).length;
      if (present / sections.length < 0.6) {
        for (const s of sections) if (s.kind !== 'intro' && s.kind !== 'outro' && !s.layers.includes(l.id)) s.layers.push(l.id);
        repairs.push('featured sound brought forward');
      }
    }
  }

  // 9. Mix, lyrics, caption.
  const m = obj(raw.mix) ?? {};
  const mix = {
    reverb: clamp(isNum(m.reverb) ? unit(m.reverb) : spec.mix.reverb, 0, 1),
    width: clamp(isNum(m.width) ? unit(m.width) : spec.mix.width, 0, 1),
    warmth: clamp(isNum(m.warmth) ? unit(m.warmth) : spec.mix.warmth, 0, 1),
    masterGainDb: clamp(isNum(m.masterGainDb) ? m.masterGainDb : 0, -12, 6),
  };
  const lyrics = normalizeLyrics(raw.lyrics);
  const caption = typeof raw.caption === 'string' && raw.caption.trim() ? raw.caption.trim().slice(0, 240) : `${spec.caption}, ${tempo} bpm, ${key} ${scale}`;
  if (ctx.lock?.key) key = ctx.lock.key;
  if (ctx.lock?.scale) scale = ctx.lock.scale;

  const plan: MusicPlan = {
    schemaVersion: MUSIC_PLAN_SCHEMA_VERSION,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 60) : `${spec.label} jam`,
    style,
    mood: typeof raw.mood === 'string' ? raw.mood.slice(0, 40) : undefined,
    tempoBpm: tempo,
    timeSignature: '4/4',
    key,
    scale,
    durationSec,
    sections,
    layers,
    mix,
    lyrics,
    caption,
  };
  return { plan, repairs, errors };
}

export function normalizeLyrics(raw: unknown): PlanLyrics | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.sections)) return null;
  const sections = o.sections
    .map((s) => obj(s))
    .filter((s): s is Record<string, unknown> => !!s && Array.isArray(s.lines))
    .map((s) => ({
      type: (['verse', 'chorus', 'pre-chorus', 'bridge', 'intro', 'outro', 'hook'].includes(s.type as string) ? s.type : 'verse') as PlanLyrics['sections'][number]['type'],
      lines: (s.lines as unknown[]).filter((l): l is string => typeof l === 'string' && l.trim().length > 0).map((l) => l.trim().slice(0, 120)).slice(0, 12),
    }))
    .filter((s) => s.lines.length > 0)
    .slice(0, 12);
  if (sections.length === 0) return null;
  return {
    title: typeof o.title === 'string' && o.title.trim() ? o.title.trim().slice(0, 60) : 'Untitled',
    language: typeof o.language === 'string' && o.language.trim() ? o.language.trim().slice(0, 12) : 'en',
    theme: typeof o.theme === 'string' ? o.theme.slice(0, 120) : '',
    sections,
  };
}
