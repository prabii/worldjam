import { STYLE_IDS, type MusicPlan, type NoteName, type PlanLyrics, type ScaleId, type StyleId } from '../contracts/musicPlan';
import type { PlannerCapture } from './fallback';
import type { Intent } from './interpret';
import { EDIT_RULES, describeFeatures, roleForCapture } from './kb/rules';
import { STYLES, styleSpec } from './kb/styles';

export const SYSTEM_PROMPT_VERSION = 'wj-sp-2026.09.27';

/** 05_LLM_KNOWLEDGE_AND_PROMPTS.md system prompt, plus the renderer's hard limits. */
const SYSTEM = `You are WorldJam Studio AI, a music producer.
Create original arrangements using ONLY the user's captured sounds listed below (plus the optional synth parts synth:bass, synth:chords, synth:pad, synth:arp, synth:guitar).
Never invent sound ids. Respect explicit user instructions. Preserve user-written lyrics unless asked to change them.
The user's hums/singing are the vocal: never pitch-shift them and never write parts for an AI singer.
Return one JSON object only.`;

const RENDERER = `Renderer can do: trigger/loop sounds, per-hit gain, pan -100..100 (percent), pitch a TONAL sound as bass/chords/melody, lowpass/highpass/eq, delay, reverb, saturation, compression, section energy. Patterns are one bar of 16 sixteenth steps: X accent, x hit, - hold, . rest.`;

function inventory(captures: PlannerCapture[]): string {
  return captures
    .map((c) => {
      const role = c.role ?? roleForCapture(c);
      const desc = c.description ? ` — "${c.description.slice(0, 80)}"` : '';
      return `- id=${c.id} "${c.name}"${desc} [${c.type.toLowerCase()}; ${describeFeatures(c.features)}; suggested role: ${role}]`;
    })
    .join('\n');
}

/** Only the style rules this prompt needs, so the context stays small. */
export function kbSnippet(style: StyleId): string {
  const s = styleSpec(style);
  const grooves = Object.entries(s.grooves).map(([r, p]) => `${r}:${p}`).join(' ');
  return [
    `Style ${s.label}: ${s.arrangement}`,
    `Tempo ${s.tempo.min}-${s.tempo.max} (home ${s.tempo.home}), ${s.scale}, swing ${s.swing}.`,
    `Typical grooves: ${grooves}`,
    `Form: ${s.form.map((f) => `${f.kind}(${Math.round(f.share * 100)}%, energy ${f.energy})`).join(' → ')}`,
    'Map sounds to roles by what they are: low thumps=kick, sharp/bright hits=hat or percussion, claps=snare, hums/voices=vocal, steady noise=texture, tonal notes=lead/bass. Not every section needs every layer. Leave space.',
  ].join('\n');
}

export interface PlanPromptInput {
  captures: PlannerCapture[];
  prompt: string;
  intent: Intent;
  style: StyleId;
  durationSec: number;
  lock?: { tempoBpm?: number | null; key?: NoteName | null; scale?: ScaleId | null };
  lyrics?: PlanLyrics | null;
}

export function buildPlanPrompt(input: PlanPromptInput): string {
  const lock = input.lock ?? {};
  const locked = [
    lock.tempoBpm ? `tempoBpm MUST be ${lock.tempoBpm} (locked to the user's recording)` : null,
    lock.key ? `key MUST be ${lock.key} ${lock.scale ?? ''} (the user's voice is in this key)` : null,
  ].filter(Boolean);
  const lyricHint = input.lyrics
    ? `Lyrics to fit (sections: ${input.lyrics.sections.map((s) => `${s.type} ${s.lines.length} lines`).join(', ')}). Put vocal layers in the sections that carry lyrics.`
    : '';
  return [
    SYSTEM,
    RENDERER,
    kbSnippet(input.style),
    `SOUNDS:\n${inventory(input.captures)}`,
    `Target length about ${Math.round(input.durationSec)} seconds (at least 30).`,
    locked.length ? `LOCKED: ${locked.join('; ')}.` : '',
    input.intent.featured.length ? `FEATURE these sound ids prominently: ${input.intent.featured.join(', ')}.` : '',
    input.intent.excluded.length ? `Do NOT use: ${input.intent.excluded.join(', ')}.` : '',
    lyricHint,
    `USER PROMPT: "${input.prompt.trim() || `a ${styleSpec(input.style).label} track`}"`,
    'Reply with the plan JSON: title, style, mood, tempoBpm, key, scale, sections [{kind, bars, energy 0-100, layers:[layer ids]}], layers [{id, source (a sound id or synth:bass etc.), role, gainDb, pan -100..100, pattern, pitch}], mix {reverb 0-100, warmth 0-100}. All numbers are whole numbers, caption (genre + instruments for a producer, no vocals).',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildEditPrompt(plan: MusicPlan, instruction: string, captures: PlannerCapture[]): string {
  const compact = {
    style: plan.style,
    tempoBpm: plan.tempoBpm,
    key: `${plan.key} ${plan.scale}`,
    sections: plan.sections.map((s) => ({ id: s.id, kind: s.kind, bars: s.bars, energy: s.energy, layers: s.layers })),
    layers: plan.layers.map((l) => ({
      id: l.id,
      source: l.source.kind === 'capture' ? l.source.captureId : l.source.kind === 'synth' ? `synth:${l.source.instrument}` : 'texture',
      role: l.role,
      gainDb: l.gainDb,
      pan: l.pan,
      pattern: l.pattern,
    })),
  };
  return [
    SYSTEM,
    RENDERER,
    `SOUNDS:\n${inventory(captures)}`,
    `CURRENT PLAN:\n${JSON.stringify(compact)}`,
    `Editing guidance: ${EDIT_RULES.map((r) => r.describe).join('. ')}.`,
    `USER EDIT: "${instruction.trim()}"`,
    'Reply with a patch JSON {operations:[...], summary} using only: add_layer, remove_layer, set_gain, set_pan, set_role, set_pattern, add_effect, change_tempo, change_section_energy, change_style. Change only what the edit asks for.',
  ].join('\n\n');
}

// ---------------------------------------------------------------- JSON Schemas (grammar-constrained decoding)

const ROLE_ENUM = ['kick', 'snare', 'hat', 'percussion', 'bass', 'chords', 'pad', 'lead', 'vocal', 'texture', 'fx'];
const KIND_ENUM = ['intro', 'verse', 'build', 'chorus', 'drop', 'bridge', 'breakdown', 'outro'];
const NOTE_ENUM = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Plan schema for llama.rn response_format. Flat and bounded so the grammar
 * stays small and generation stays short: ids are strings the validator
 * checks against the real inventory.
 */
export function planSchema(sourceIds: string[]): object {
  return {
    type: 'object',
    properties: {
      title: { type: 'string', maxLength: 48 },
      style: { type: 'string', enum: [...STYLE_IDS] },
      mood: { type: 'string', maxLength: 24 },
      tempoBpm: { type: 'integer', minimum: 60, maximum: 180 },
      key: { type: 'string', enum: NOTE_ENUM },
      scale: { type: 'string', enum: ['major', 'minor', 'dorian', 'mixolydian', 'pentatonic_minor', 'pentatonic_major'] },
      sections: {
        type: 'array',
        minItems: 2,
        maxItems: 7,
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: KIND_ENUM },
            bars: { type: 'integer', minimum: 1, maximum: 16 },
            energy: { type: 'integer', minimum: 0, maximum: 100 },
            layers: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 24 } },
          },
          required: ['kind', 'bars', 'energy', 'layers'],
        },
      },
      layers: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', maxLength: 24 },
            source: { type: 'string', enum: [...sourceIds, 'synth:bass', 'synth:chords', 'synth:pad', 'synth:arp', 'synth:guitar'] },
            role: { type: 'string', enum: ROLE_ENUM },
            gainDb: { type: 'integer', minimum: -24, maximum: 6 },
            pan: { type: 'integer', minimum: -100, maximum: 100 },
            pattern: { type: 'string', maxLength: 16 },
            pitch: { type: 'string', enum: ['fixed', 'bass', 'chords', 'melody'] },
          },
          required: ['id', 'source', 'role', 'gainDb'],
        },
      },
      mix: { type: 'object', properties: { reverb: { type: 'integer', minimum: 0, maximum: 100 }, warmth: { type: 'integer', minimum: 0, maximum: 100 } } },
      caption: { type: 'string', maxLength: 160 },
    },
    required: ['title', 'style', 'tempoBpm', 'key', 'scale', 'sections', 'layers', 'caption'],
  };
}

export function patchSchema(layerIds: string[], sectionIds: string[]): object {
  return {
    type: 'object',
    properties: {
      summary: { type: 'string', maxLength: 120 },
      operations: {
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['remove_layer', 'set_gain', 'set_pan', 'set_role', 'set_pattern', 'add_effect', 'change_tempo', 'change_section_energy', 'change_style'] },
            layerId: { type: 'string', enum: layerIds.length ? layerIds : ['none'] },
            sectionId: { type: 'string', enum: sectionIds.length ? sectionIds : ['none'] },
            gainDb: { type: 'integer', minimum: -24, maximum: 6 },
            pan: { type: 'integer', minimum: -100, maximum: 100 },
            role: { type: 'string', enum: ROLE_ENUM },
            pattern: { type: 'string', maxLength: 16 },
            tempoBpm: { type: 'integer', minimum: 60, maximum: 180 },
            energy: { type: 'integer', minimum: 0, maximum: 100 },
            style: { type: 'string', enum: [...STYLE_IDS] },
            effect: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['lowpass', 'highpass', 'eq', 'delay', 'reverb', 'saturation', 'compressor'] },
                cutoffHz: { type: 'integer', minimum: 40, maximum: 18000 },
                freqHz: { type: 'integer', minimum: 40, maximum: 16000 },
                gainDb: { type: 'integer', minimum: -12, maximum: 12 },
                beats: { type: 'number', enum: [0.25, 0.5, 0.75, 1, 1.5, 2] },
                feedback: { type: 'integer', minimum: 0, maximum: 85 },
                mix: { type: 'integer', minimum: 0, maximum: 80 },
                size: { type: 'integer', minimum: 0, maximum: 100 },
                drive: { type: 'integer', minimum: 1, maximum: 8 },
                amount: { type: 'integer', minimum: 0, maximum: 100 },
              },
              required: ['type'],
            },
          },
          required: ['type'],
        },
      },
    },
    required: ['operations', 'summary'],
  };
}

export function lyricsSchema(): object {
  return {
    type: 'object',
    properties: {
      title: { type: 'string', maxLength: 48 },
      language: { type: 'string', maxLength: 8 },
      theme: { type: 'string', maxLength: 80 },
      sections: {
        type: 'array',
        minItems: 2,
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['intro', 'verse', 'pre-chorus', 'chorus', 'hook', 'bridge', 'outro'] },
            lines: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', maxLength: 80 } },
          },
          required: ['type', 'lines'],
        },
      },
    },
    required: ['title', 'language', 'sections'],
  };
}

/** The style names the UI chips show, in the knowledge base's order. */
export const STYLE_CHOICES = STYLE_IDS.map((id) => ({ id, label: STYLES[id].label }));
