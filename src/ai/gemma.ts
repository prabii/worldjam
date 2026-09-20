import type { ArrangementPlan, Style, VocalTake, WorldJamObject } from '@/types';
import { buildFallbackPlan } from './fallbackArranger';
import { extractJson, validatePlan } from './schema';

/**
 * The Gemma orchestrator — the "music director" of HLD v2 §4.
 *
 * Two rules govern everything here:
 *  1. The model plans; it never synthesises audio.
 *  2. The interaction loop never blocks on it. Every call is racing a timeout
 *     against the rule-based arranger, and the arranger wins ties.
 *
 * The runtime is pluggable because the on-device model backend (MediaPipe LLM
 * Inference, llama.rn, or an ExecuTorch build) is the one thing that must be
 * validated on the actual iQOO 15 at the event. Swap the adapter, keep the
 * contract.
 */

export interface GemmaRuntime {
  readonly name: string;
  isReady(): boolean;
  /** Returns raw model text; the caller parses and validates it. */
  generate(prompt: string, maxTokens: number): Promise<string>;
}

let runtime: GemmaRuntime | null = null;

export function registerGemmaRuntime(rt: GemmaRuntime | null): void {
  runtime = rt;
}

export function getGemmaRuntime(): GemmaRuntime | null {
  return runtime;
}

export function isGemmaReady(): boolean {
  return runtime?.isReady() ?? false;
}

/** Beyond this the user is just watching a spinner, so we take the fallback. */
export const PLAN_TIMEOUT_MS = 4000;

export interface SessionSnapshot {
  objects: WorldJamObject[];
  vocal: VocalTake | null;
  bpmHint: number | null;
  style: Style;
  mood?: string;
}

/**
 * Builds the model prompt. Compact by design: every token costs latency on
 * device, so the session is summarised rather than dumped.
 */
export function buildPrompt(snapshot: SessionSnapshot, instruction?: string): string {
  const objects = snapshot.objects.map((o) => {
    const f = o.features;
    return {
      object: o.label,
      role: o.role,
      brightness: f ? Math.round(f.brightness) : null,
      decay: f ? Number(f.decay.toFixed(2)) : null,
      pitched: f?.pitch != null,
    };
  });

  const vocal = snapshot.vocal
    ? {
        present: true,
        key: snapshot.vocal.detectedKey,
        noteCount: snapshot.vocal.notes.length,
        duration: Number(snapshot.vocal.duration.toFixed(1)),
      }
    : { present: false };

  return `You are the music director for WorldJam. The user recorded the REAL sounds of physical objects around them. Your job is to arrange WHEN each object plays. You never generate audio.

SESSION:
objects: ${JSON.stringify(objects)}
vocal: ${JSON.stringify(vocal)}
tempo_hint: ${snapshot.bpmHint ?? 'none'}
requested_style: ${snapshot.style}${snapshot.mood ? `\nmood: ${snapshot.mood}` : ''}${instruction ? `\nuser_instruction: "${instruction}"` : ''}

RULES:
- Use ONLY the object names listed above. Never invent an object.
- beats are 1-indexed within one 4/4 bar. Fractional values (e.g. 2.5) are allowed for offbeats.
- bpm must be between 60 and 180.
- Give low/dark objects the downbeats and bright/short objects the offbeats.
- Leave space. Not every object plays on every beat.

Reply with ONLY this JSON, no prose:
{"bpm":92,"bars":4,"objectPattern":[{"object":"cup","beats":[1,3]},{"object":"table","beats":[2,4]}],"voiceRole":"lead","accompaniment":["bass"],"style":"${snapshot.style}","reasoning":"one short sentence"}`;
}

export interface PlanResult {
  plan: ArrangementPlan;
  /** Milliseconds the model took, or null when the fallback was used. */
  elapsedMs: number | null;
  repairs: string[];
  usedFallback: boolean;
  error?: string;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * Produces an arrangement plan. Always resolves with a playable plan — it
 * degrades to rules rather than failing.
 */
export async function generatePlan(
  snapshot: SessionSnapshot,
  instruction?: string,
): Promise<PlanResult> {
  const fallback = () =>
    buildFallbackPlan(snapshot.objects, snapshot.style, snapshot.bpmHint);

  if (snapshot.objects.length === 0) {
    return {
      plan: fallback(),
      elapsedMs: null,
      repairs: [],
      usedFallback: true,
      error: 'no objects captured yet',
    };
  }

  if (!runtime || !runtime.isReady()) {
    return {
      plan: fallback(),
      elapsedMs: null,
      repairs: [],
      usedFallback: true,
      error: 'no on-device model runtime registered',
    };
  }

  const started = Date.now();
  try {
    const raw = await withTimeout(
      runtime.generate(buildPrompt(snapshot, instruction), 320),
      PLAN_TIMEOUT_MS,
    );
    const elapsedMs = Date.now() - started;

    const parsed = extractJson(raw);
    if (parsed === null) {
      return {
        plan: fallback(),
        elapsedMs,
        repairs: [],
        usedFallback: true,
        error: 'model returned no parseable JSON',
      };
    }

    const { plan, repairs } = validatePlan(parsed, snapshot.objects, snapshot.bpmHint ?? 92);
    if (plan === null) {
      return {
        plan: fallback(),
        elapsedMs,
        repairs,
        usedFallback: true,
        error: 'plan failed validation',
      };
    }

    return { plan, elapsedMs, repairs, usedFallback: false };
  } catch (err) {
    return {
      plan: fallback(),
      elapsedMs: Date.now() - started,
      repairs: [],
      usedFallback: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Maps a spoken/typed command to a style. Tried locally first so the common
 * "make it jazz" case never needs the model at all.
 */
export function parseStyleCommand(text: string): Style | null {
  const t = text.toLowerCase();
  const table: Array<[RegExp, Style]> = [
    [/jazz|swing|bebop/, 'jazz'],
    // 'lo-fi' before 'chill': the two overlap in everyday use, and lo-fi is
    // the more specific request, so it must be tested first.
    [/lo-?fi|study|mellow|tape|dusty/, 'lofi'],
    [/cinema|epic|film|movie|trailer|orchestr/, 'cinematic'],
    [/electro|techno|edm|house|dance|club/, 'edm'],
    [/rock|punk|metal|band/, 'rock'],
    [/chill|natural|normal|default|original|plain|relax|calm/, 'chill'],
  ];
  for (const [re, style] of table) {
    if (re.test(t)) return style;
  }
  return null;
}
