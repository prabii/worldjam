import type { Capture } from '../contracts/library';
import type { LayerRole, MusicPlan, NoteName, PatchOp, PlanLayer, PlanPatch, ScaleId, StyleId, SynthInstrument } from '../contracts/musicPlan';
import type { Intent } from './interpret';
import { EDIT_RULES, ROLE_BUS, isTonal, roleForCapture } from './kb/rules';
import { barsFor, formFor, styleSpec } from './kb/styles';
import { normalizePattern, validatePlan, type CaptureRef, type ValidateContext } from './validator';

export type PlannerCapture = Pick<Capture, 'id' | 'name' | 'description' | 'type' | 'features' | 'detectedLabel'> & {
  /** Role pinned by the user on the Orbit, if any. */
  role?: LayerRole | null;
};

export function captureRefs(captures: PlannerCapture[]): CaptureRef[] {
  return captures.map((c) => ({
    id: c.id,
    name: c.name,
    role: c.role ?? roleForCapture(c),
    tonal: isTonal(c.features),
    isVoice: c.type === 'HUM' || c.type === 'VOCAL',
  }));
}

const DRUM_ORDER: LayerRole[] = ['kick', 'snare', 'hat', 'percussion'];

/**
 * The deterministic planner: a sensible, always-valid arrangement built from
 * the knowledge base, the prompt reading and the sounds themselves. Used when
 * no model is loaded, when the model fails twice, and as the manual studio's
 * starting point. Deterministic: the same inputs give the same song.
 */
export function fallbackPlan(args: {
  captures: PlannerCapture[];
  intent: Intent;
  style?: StyleId | null;
  durationSec: number;
  lock?: { tempoBpm?: number | null; key?: NoteName | null; scale?: ScaleId | null };
}): MusicPlan {
  const style: StyleId = args.intent.style ?? args.style ?? 'chill';
  const spec = styleSpec(style);
  let tempo = args.lock?.tempoBpm ?? args.intent.tempoBpm ?? spec.tempo.home;
  if (!args.lock?.tempoBpm && args.intent.tempoHint === 'faster') tempo = Math.min(spec.tempo.max + 10, tempo + 10);
  if (!args.lock?.tempoBpm && args.intent.tempoHint === 'slower') tempo = Math.max(spec.tempo.min - 10, tempo - 10);
  const key: NoteName = args.lock?.key ?? 'A';
  const scale: ScaleId = args.lock?.scale ?? spec.scale;
  const refs = captureRefs(args.captures).filter((c) => !args.intent.excluded.includes(c.id));

  // Give each sound a distinct job: two "kicks" become kick + snare, etc.
  const usedDrums = new Set<LayerRole>();
  const layers: PlanLayer[] = [];
  refs.forEach((c, i) => {
    let role = c.role;
    if (DRUM_ORDER.includes(role)) {
      if (usedDrums.has(role)) role = DRUM_ORDER.find((r) => !usedDrums.has(r)) ?? 'percussion';
      usedDrums.add(role);
    }
    const featured = args.intent.featured.includes(c.id);
    layers.push({
      id: `s${i + 1}`,
      source: { kind: 'capture', captureId: c.id },
      role,
      bus: ROLE_BUS[role],
      gainDb: featured ? 0 : role === 'texture' ? -9 : role === 'vocal' ? -2 : -4,
      // Spread percussion across the field; keep bass, vocal and kick centred.
      pan: ['bass', 'kick', 'vocal'].includes(role) ? 0 : ((i % 2 === 0 ? -1 : 1) * (0.2 + 0.1 * (i % 3))),
      pattern: normalizePattern(undefined, role, style),
      pitch: c.isVoice ? { mode: 'hum', captureId: c.id } : c.tonal && (role === 'bass' || role === 'chords' || role === 'lead') ? { mode: role === 'lead' ? 'melody' : role } : undefined,
    });
  });

  // Synth backing only where no capture already plays that part.
  const covered = new Set(layers.map((l) => l.role));
  for (const inst of spec.backing) {
    const role: LayerRole = inst === 'bass' ? 'bass' : inst === 'pad' ? 'pad' : 'chords';
    if (covered.has(role)) continue;
    covered.add(role);
    layers.push({ id: `synth_${inst}`, source: { kind: 'synth', instrument: inst as SynthInstrument }, role, bus: ROLE_BUS[role], gainDb: role === 'bass' ? -6 : -10, pan: 0 });
  }
  if (!layers.some((l) => DRUM_ORDER.includes(l.role)) && layers.length === 0) {
    layers.push({ id: 'synth_pad', source: { kind: 'synth', instrument: 'pad' }, role: 'pad', bus: 'HARMONY', gainDb: -8, pan: 0 });
  }

  const bars = barsFor(args.intent.durationSec ?? args.durationSec, tempo);
  const form = formFor(spec, bars);
  const sections = form.map((f, i) => {
    const ids = layers
      .filter((l) => {
        if (args.intent.featured.some((id) => l.source.kind === 'capture' && l.source.captureId === id)) return true;
        if (f.energy < 0.4) return l.role === 'texture' || l.role === 'pad' || l.role === 'kick' || l.role === 'vocal';
        if (f.energy < 0.7) return l.role !== 'hat' || layers.length <= 3;
        return true;
      })
      .map((l) => l.id);
    return { id: `${f.kind}${i + 1}`, kind: f.kind, bars: f.bars, energy: f.energy, layers: ids.length ? ids : layers.map((l) => l.id) };
  });

  const mood = args.intent.mood ? `${args.intent.mood} ` : '';
  const first = refs[0]?.name;
  const plan: MusicPlan = {
    schemaVersion: '1.0',
    title: first ? `${spec.label} ${first}` : `${spec.label} jam`,
    style,
    mood: args.intent.mood ?? undefined,
    tempoBpm: Math.round(tempo),
    timeSignature: '4/4',
    key,
    scale,
    durationSec: args.intent.durationSec ?? args.durationSec,
    sections,
    layers,
    mix: { ...spec.mix },
    lyrics: null,
    caption: `${mood}${spec.caption}, ${Math.round(tempo)} bpm, ${key} ${scale}, instrumental`,
  };
  const ctx: ValidateContext = {
    captures: captureRefs(args.captures),
    durationSec: args.intent.durationSec ?? args.durationSec,
    style,
    lock: args.lock,
    featured: args.intent.featured,
    excluded: args.intent.excluded,
  };
  return validatePlan(plan, ctx).plan ?? plan;
}

/** Deterministic edit: editing-language rules + prompt reading → a patch. */
export function fallbackPatch(plan: MusicPlan, instruction: string, intent: Intent): PlanPatch {
  const text = instruction.toLowerCase();
  const layerIds = plan.layers.map((l) => l.id);
  const melodicIds = plan.layers.filter((l) => ['lead', 'chords', 'pad', 'vocal', 'bass'].includes(l.role)).map((l) => l.id);
  const drumIds = plan.layers.filter((l) => l.bus === 'DRUMS').map((l) => l.id);
  const sectionIds = plan.sections.map((s) => s.id);
  const top = Math.max(...plan.sections.map((s) => s.energy));
  const mainSectionIds = plan.sections.filter((s) => s.energy >= top - 0.15).map((s) => s.id);
  const ops: PatchOp[] = [];
  const notes: string[] = [];
  for (const r of EDIT_RULES) {
    if (r.test.test(text)) {
      ops.push(...r.build({ layerIds, melodicIds, drumIds, sectionIds, mainSectionIds, tempo: plan.tempoBpm }));
      notes.push(r.describe);
    }
  }
  if (intent.style && intent.style !== plan.style) {
    ops.push({ type: 'change_style', style: intent.style });
    notes.push(`Style → ${styleSpec(intent.style).label}`);
  }
  if (intent.tempoBpm) ops.push({ type: 'change_tempo', tempoBpm: intent.tempoBpm });
  for (const id of intent.featured) {
    for (const l of plan.layers.filter((x) => x.source.kind === 'capture' && x.source.captureId === id)) {
      ops.push({ type: 'set_gain', layerId: l.id, gainDb: Math.min(6, l.gainDb + 4) });
      notes.push('Brought the named sound forward');
    }
  }
  for (const id of intent.excluded) {
    for (const l of plan.layers.filter((x) => x.source.kind === 'capture' && x.source.captureId === id)) {
      ops.push({ type: 'remove_layer', layerId: l.id });
      notes.push('Removed the named sound');
    }
  }
  return { operations: ops, summary: notes.join('; ') || 'No change recognised — try "darker", "faster", "more reverb" or name a sound.' };
}
