import type {
  AccompanimentLayer,
  ArrangementPlan,
  Style,
  WorldJamObject,
} from '@/types';

/**
 * The validator that stands between the model and the audio engine.
 *
 * HLD v2 §4: "Force this JSON schema, validate it, and apply deterministic
 * music constraints before execution. If Gemma returns junk, the validator
 * falls back to a rule-based pattern — the interaction loop must never stall
 * waiting on the model."
 *
 * So this module never throws on bad model output. It repairs what it can and
 * reports what it had to fix.
 */

const STYLES: Style[] = ['chill', 'jazz', 'lofi', 'cinematic', 'edm', 'rock'];
const LAYERS: AccompanimentLayer[] = ['bass', 'chords', 'pad', 'arp', 'guitar', 'perc'];
const VOICE_ROLES = ['lead', 'harmony', 'texture', 'none'] as const;

export const BPM_MIN = 60;
export const BPM_MAX = 180;

export interface ValidationResult {
  plan: ArrangementPlan | null;
  repairs: string[];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Models wrap JSON in prose and code fences no matter how firmly you ask them
 * not to, so pull out the first balanced object rather than trusting the shape
 * of the whole response.
 */
export function extractJson(raw: string): unknown | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;

  const start = candidate.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Validates and repairs a candidate plan against the session's real objects.
 * Returns null only when the input is too broken to repair, at which point the
 * caller uses the rule-based fallback.
 */
export function validatePlan(
  input: unknown,
  objects: WorldJamObject[],
  fallbackBpm: number,
): ValidationResult {
  const repairs: string[] = [];
  if (typeof input !== 'object' || input === null) {
    return { plan: null, repairs: ['response was not an object'] };
  }
  const raw = input as Record<string, unknown>;

  // --- bpm ---
  let bpm = typeof raw.bpm === 'number' && Number.isFinite(raw.bpm) ? raw.bpm : NaN;
  if (Number.isNaN(bpm)) {
    bpm = fallbackBpm;
    repairs.push('bpm missing or not a number');
  } else if (bpm < BPM_MIN || bpm > BPM_MAX) {
    // Models like to return 240 for "fast". Halving keeps the intent.
    const original = bpm;
    while (bpm > BPM_MAX) bpm /= 2;
    while (bpm < BPM_MIN) bpm *= 2;
    repairs.push(`bpm ${original} folded to ${Math.round(bpm)}`);
  }
  bpm = Math.round(clamp(bpm, BPM_MIN, BPM_MAX));

  // --- bars ---
  let bars = typeof raw.bars === 'number' ? Math.round(raw.bars) : 4;
  if (![1, 2, 4, 8].includes(bars)) {
    repairs.push(`bars ${raw.bars} is not a usable loop length, using 4`);
    bars = 4;
  }

  // --- objectPattern ---
  const byLabel = new Map<string, WorldJamObject>();
  for (const o of objects) {
    byLabel.set(o.label.toLowerCase(), o);
    byLabel.set(o.id.toLowerCase(), o);
  }

  const pattern: ArrangementPlan['objectPattern'] = [];
  const rawPattern = Array.isArray(raw.objectPattern) ? raw.objectPattern : [];
  if (rawPattern.length === 0) {
    repairs.push('objectPattern empty');
  }

  const beatsInBar = 4;
  for (const entry of rawPattern) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.object === 'string' ? e.object.toLowerCase().trim() : '';
    const match = byLabel.get(name);
    if (!match) {
      // A hallucinated object cannot be played; dropping it is safer than
      // guessing which real object was meant.
      repairs.push(`unknown object "${e.object}" dropped`);
      continue;
    }

    const rawBeats = Array.isArray(e.beats) ? e.beats : [];
    const beats = rawBeats
      .filter((b): b is number => typeof b === 'number' && Number.isFinite(b))
      // The contract is 1-indexed beats within the bar.
      .map((b) => clamp(b, 1, beatsInBar))
      .filter((b, i, arr) => arr.indexOf(b) === i)
      .sort((a, b) => a - b);

    if (beats.length === 0) {
      repairs.push(`object "${match.label}" had no valid beats`);
      continue;
    }
    pattern.push({ object: match.label, beats });
  }

  if (pattern.length === 0) {
    return { plan: null, repairs: [...repairs, 'no playable pattern survived validation'] };
  }

  // --- voiceRole ---
  const voiceRole = VOICE_ROLES.includes(raw.voiceRole as never)
    ? (raw.voiceRole as ArrangementPlan['voiceRole'])
    : 'lead';
  if (voiceRole !== raw.voiceRole) repairs.push('voiceRole defaulted to lead');

  // --- accompaniment ---
  const rawAcc = Array.isArray(raw.accompaniment) ? raw.accompaniment : [];
  const accompaniment = rawAcc.filter((l): l is AccompanimentLayer =>
    LAYERS.includes(l as AccompanimentLayer),
  );
  if (accompaniment.length !== rawAcc.length) {
    repairs.push('unsupported accompaniment layers removed');
  }

  // --- style ---
  const style = STYLES.includes(raw.style as Style) ? (raw.style as Style) : 'chill';
  if (style !== raw.style) repairs.push(`unknown style "${raw.style}" defaulted to chill`);

  return {
    plan: {
      bpm,
      bars,
      objectPattern: pattern,
      voiceRole,
      accompaniment,
      style,
      source: 'gemma',
      reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : undefined,
    },
    repairs,
  };
}
