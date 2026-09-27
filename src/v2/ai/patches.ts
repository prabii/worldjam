import type { LayerRole, MusicPlan, PatchOp, PlanPatch } from '../contracts/musicPlan';
import { PLAN_LIMITS } from '../contracts/musicPlan';
import { ROLE_BUS } from './kb/rules';
import { styleSpec } from './kb/styles';
import { normalizePattern, validatePlan, type ValidateContext } from './validator';

export interface PatchResult {
  plan: MusicPlan;
  applied: string[];
  rejected: string[];
  repairs: string[];
}

/**
 * Applies a patch (05_LLM_KNOWLEDGE "Editing") and re-validates, so an edit
 * can never produce a plan the renderer would reject. Unknown targets are
 * rejected individually; the rest of the patch still applies.
 */
export function applyPatch(plan: MusicPlan, patch: PlanPatch, ctx: ValidateContext): PatchResult {
  const next: MusicPlan = JSON.parse(JSON.stringify(plan));
  const applied: string[] = [];
  const rejected: string[] = [];
  const layer = (id: string) => next.layers.find((l) => l.id === id);

  for (const op of patch.operations ?? []) {
    const label = describeOp(op);
    switch (op.type) {
      case 'add_layer': {
        if (!op.layer) {
          rejected.push(label);
          break;
        }
        const id = next.layers.some((l) => l.id === op.layer.id) ? `${op.layer.id}_${next.layers.length + 1}` : op.layer.id;
        next.layers.push({ ...op.layer, id });
        const targets = op.sections?.length ? next.sections.filter((s) => op.sections!.includes(s.id)) : next.sections.filter((s) => s.energy >= 0.5);
        for (const s of targets.length ? targets : next.sections) s.layers.push(id);
        applied.push(label);
        break;
      }
      case 'remove_layer': {
        if (!layer(op.layerId) || next.layers.length <= 1) {
          rejected.push(label);
          break;
        }
        next.layers = next.layers.filter((l) => l.id !== op.layerId);
        for (const s of next.sections) s.layers = s.layers.filter((id) => id !== op.layerId);
        applied.push(label);
        break;
      }
      case 'set_gain':
      case 'set_pan':
      case 'set_role':
      case 'set_pattern':
      case 'add_effect': {
        const l = layer(op.layerId);
        if (!l) {
          rejected.push(label);
          break;
        }
        if (op.type === 'set_gain') l.gainDb = op.gainDb;
        if (op.type === 'set_pan') l.pan = op.pan;
        if (op.type === 'set_role') {
          l.role = op.role as LayerRole;
          l.bus = ROLE_BUS[l.role];
          l.pattern = normalizePattern(undefined, l.role, next.style);
        }
        if (op.type === 'set_pattern') l.pattern = op.pattern;
        if (op.type === 'add_effect') l.effects = [...(l.effects ?? []), op.effect].slice(-4);
        applied.push(label);
        break;
      }
      case 'change_tempo': {
        // One edit moves tempo at most ±20% (a small model's "slower" is often half-time),
        // and bars are rescaled so the song keeps its length.
        const old = next.tempoBpm;
        const bpm = Math.round(Math.min(old * 1.2, Math.max(old * 0.8, op.tempoBpm, PLAN_LIMITS.tempoMin), PLAN_LIMITS.tempoMax));
        next.tempoBpm = bpm;
        const ratio = bpm / old;
        next.sections = next.sections.map((sec) => ({ ...sec, bars: Math.max(1, Math.round(sec.bars * ratio)) }));
        applied.push(label);
        break;
      }
      case 'change_section_energy': {
        const s = next.sections.find((x) => x.id === op.sectionId);
        if (!s) {
          rejected.push(label);
          break;
        }
        s.energy = op.energy;
        applied.push(label);
        break;
      }
      case 'change_style': {
        next.style = op.style;
        const spec = styleSpec(op.style);
        // A new style brings its own grooves and tempo range with it.
        for (const l of next.layers) if (l.pattern) l.pattern = normalizePattern(`groove:${l.role}`, l.role, op.style);
        if (next.tempoBpm < spec.tempo.min || next.tempoBpm > spec.tempo.max) next.tempoBpm = spec.tempo.home;
        next.caption = undefined;
        applied.push(label);
        break;
      }
      case 'rewrite_lyrics':
        next.lyrics = op.lyrics;
        applied.push(label);
        break;
      default:
        rejected.push(label);
    }
  }
  const v = validatePlan(next, { ...ctx, style: next.style, durationSec: ctx.durationSec || next.durationSec });
  return { plan: v.plan ?? plan, applied, rejected, repairs: v.repairs };
}

export function describeOp(op: PatchOp): string {
  switch (op.type) {
    case 'add_layer':
      return `add ${op.layer?.role ?? 'layer'}`;
    case 'remove_layer':
      return `remove ${op.layerId}`;
    case 'set_gain':
      return `${op.layerId} ${op.gainDb >= 0 ? '+' : ''}${Math.round(op.gainDb)} dB`;
    case 'set_pan':
      return `pan ${op.layerId}`;
    case 'set_role':
      return `${op.layerId} → ${op.role}`;
    case 'set_pattern':
      return `new rhythm for ${op.layerId}`;
    case 'add_effect':
      return `${op.effect.type} on ${op.layerId}`;
    case 'change_tempo':
      return `tempo ${op.tempoBpm}`;
    case 'change_section_energy':
      return `${op.sectionId} energy ${op.energy.toFixed(1)}`;
    case 'change_style':
      return `style ${op.style}`;
    case 'rewrite_lyrics':
      return 'new lyrics';
    default:
      return 'unknown change';
  }
}
