/**
 * Optional Gemma phrasing for object read-outs.
 *
 * Never on the per-frame path: native code asks for phrasing only when the
 * primary object changes, and speaks its own deterministic sentence if this
 * does not answer inside the budget. Gemma sees only the compact event —
 * never pixels, boxes or confidences — and its answer is rejected unless it is
 * short, names the object, and invents nothing (distances, colours, numbers).
 *
 * The runtime is injected, so this file does not import the music AI layer
 * and is testable without llama.rn.
 */

export interface CompactVisionEvent {
  primary: string;
  direction: 'left' | 'center' | 'right';
  additionalObjectCount: number;
}

/** Structural match for src/ai/gemma.ts GemmaRuntime (kept local on purpose). */
export interface TextRuntime {
  isReady(): boolean;
  generate(prompt: string, maxTokens: number): Promise<string>;
}

export const MAX_WORDS = 18;

export function buildReadoutPrompt(e: CompactVisionEvent): string {
  return [
    'You are the concise voice interface for WorldJam, describing objects for a blind or low-vision user.',
    'Use only the supplied object name, direction and count.',
    'Do not invent objects, distances, colours, text or actions. No numbers except the count.',
    `Maximum ${MAX_WORDS} words. Return exactly one natural sentence and nothing else.`,
    `Input: ${JSON.stringify(e)}`,
    'Sentence:',
  ].join('\n');
}

const FORBIDDEN = /\b(meter|metre|meters|metres|feet|foot|inch|inches|cm|percent|%|confidence|probability|approximately|red|blue|green|yellow|black|white)\b/i;

/** Returns a clean sentence, or null if the model's answer cannot be trusted. */
export function validateReadout(raw: string, e: CompactVisionEvent): string | null {
  let text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!text) return null;
  text = text.replace(/^sentence:\s*/i, '').trim();

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > MAX_WORDS) return null;
  if (!text.toLowerCase().includes(e.primary.toLowerCase().split(' ')[0])) return null;
  if (FORBIDDEN.test(text)) return null;
  // Digits are only allowed if they are the actual count.
  const digits = text.match(/\d+/g) ?? [];
  if (digits.some((d) => Number(d) !== e.additionalObjectCount)) return null;

  if (!/[.!?]$/.test(text)) text += '.';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Asks the runtime for a phrasing within [timeoutMs]. Resolves to null on any
 * failure — the caller then lets native speak the deterministic text.
 */
export async function formatWithGemma(
  e: CompactVisionEvent,
  runtime: TextRuntime | null,
  timeoutMs: number,
): Promise<string | null> {
  if (!runtime || !runtime.isReady()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const raw = await Promise.race([runtime.generate(buildReadoutPrompt(e), 48), timeout]);
    return raw == null ? null : validateReadout(raw, e);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
