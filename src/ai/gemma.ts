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

/**
 * How long to wait for the model before using the rule-based arranger.
 *
 * Measured on this project's dev phone (MediaTek MT6878, CPU-only llama.cpp):
 * a 4.6B model needs well over 4 s for even a short JSON response, so the
 * original 4 s budget meant the model never once beat the fallback. 25 s is
 * long for a spinner, but arranging is an explicit button press rather than
 * part of the real-time loop, and the alternative is shipping a model that
 * never actually runs.
 */
export const PLAN_TIMEOUT_MS = 25000;

export interface SessionSnapshot {
  objects: WorldJamObject[];
  vocal: VocalTake | null;
  bpmHint: number | null;
  style: Style;
  mood?: string;
  /**
   * A plain-language description of the sung or hummed melody, from
   * describeMelody(). The model cannot hear the recording, so without this it
   * is arranging blind and every result comes back generic.
   */
  melodyDescription?: string;
  /** Reference artists the user named, to steer the production. */
  reference?: string;
  /**
   * The one-bar beat the user programmed on the studio grid. When present the
   * model produces AROUND it: those rows are fixed, and it writes the parts
   * that answer them.
   */
  userBeat?: Array<{ object: string; beats: number[] }>;
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

  const vocalDetail = snapshot.melodyDescription
    ? `
melody: ${snapshot.melodyDescription}`
    : '';

  return `You are the music producer for WorldJam. The user recorded the REAL sounds of physical objects around them, and may have sung or hummed a melody. Your job is to arrange WHEN each object plays and how the song is built around the voice. You never generate audio.

SESSION:
objects: ${JSON.stringify(objects)}
vocal: ${JSON.stringify(vocal)}${vocalDetail}
tempo_hint: ${snapshot.bpmHint ?? 'none'}
requested_style: ${snapshot.style}${snapshot.mood ? `
mood: ${snapshot.mood}` : ''}${snapshot.reference ? `
reference_artists: ${snapshot.reference}` : ''}${instruction ? `
user_instruction: "${instruction}"` : ''}${snapshot.userBeat && snapshot.userBeat.length ? `
user_beat (FIXED, plays exactly as written): ${JSON.stringify(snapshot.userBeat)}` : ''}

HOW TO PRODUCE THIS:
- If a melody is present, it is the song. Build everything else to support it: match its key, lock the tempo to it, and leave the beats where the voice is most exposed uncluttered.
- Think in sections, not one repeated bar. A verse is sparse; a chorus adds the bass and more of the objects.
- Give low, dark, long-decay objects the downbeats. Bright, short objects belong on offbeats and sixteenths, where they add movement rather than weight.
- Leave space. Silence is what makes the objects that DO play sound deliberate. Not every object plays every bar.
${snapshot.userBeat && snapshot.userBeat.length ? `- The user programmed user_beat themselves. It is the heart of the track and you do not change it. Write parts ONLY for objects NOT in user_beat, placed in the gaps it leaves (call and response, not doubling its hits); if every object is in user_beat, copy user_beat as objectPattern. Then choose the tempo and accompaniment that make their beat sound like a finished record.
` : ''}- Pick accompaniment that fits the voice: "bass" and "chords" almost always; "pad" for slow or emotional; "arp" for electronic; "guitar" for acoustic and pop.

RULES:
- Use ONLY the object names listed above. Never invent an object.
- beats are 1-indexed within one 4/4 bar. Fractional values (e.g. 2.5) are allowed for offbeats.
- bpm must suit the style: chill 84-100, jazz 104-136, lofi 70-88, cinematic 62-84, edm 120-130, rock 100-128. If a melody tempo is given, stay within 4 BPM of it.
- bars is 8 (a full intro, verse, build and chorus).
- Hats and shakers can play every eighth or sixteenth; long ringing objects should play at most once or twice per bar.
- genre: user's genre in their words, else requested_style. user_instruction wins.
- texture: <12 words of backing music with the genre's instruments.
- style: nearest of chill/jazz/lofi/cinematic/edm/rock.
- voiceRole is "lead" when the user sang a tune, "harmony" when the voice should sit under other parts, "texture" for wordless atmosphere, "none" when there is no voice.

Reply with ONLY this JSON, no prose:
{"bpm":92,"bars":8,"objectPattern":[{"object":"cup","beats":[1,3]},{"object":"table","beats":[2,4]}],"voiceRole":"lead","accompaniment":["bass","chords"],"genre":"<genre>","texture":"<backing music for that genre>","style":"${snapshot.style}"}`;
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
      /*
       * 128 tokens.
       *
       * Generation is linear in tokens produced, and on a 4.6B model running
       * on phone CPU that is the whole latency budget. The plan JSON for a
       * handful of objects fits well inside 128 now that the prompt no longer
       * asks for a `reasoning` sentence — which cost real seconds to generate
       * and which nothing in the app ever displayed.
       */
      runtime.generate(buildPrompt(snapshot, instruction), 200),
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
