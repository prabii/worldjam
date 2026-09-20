import type { ArrangementPlan, VocalTake, WorldJamObject } from '@/types';
import { getGemmaRuntime } from './gemma';
import { formatGemmaPrompt } from './runtimes/llamaRuntime';
import { extractJson } from './schema';

/**
 * AI-written lyrics, timed to the beat grid.
 *
 * The lyrics are written *about the room you recorded* — the objects you hit
 * become the song's subject matter. That keeps the feature honest to the
 * product: the AI is not generating a generic pop song, it is writing about
 * your mug and your table.
 *
 * Every line carries a beat position so it can be displayed karaoke-style and,
 * for a blind user, spoken or sung along to in time.
 */

export interface LyricLine {
  text: string;
  /** Beat position from the start of the loop where this line begins. */
  beat: number;
  /** How many beats the line spans. */
  durationBeats: number;
  /** Syllable count, used to check the line actually fits its slot. */
  syllables: number;
}

export interface LyricSet {
  lines: LyricLine[];
  /** The hook, repeated between verses. */
  hook: string;
  mood: string;
  source: 'gemma' | 'fallback';
}

/**
 * Rough syllable count.
 *
 * Deliberately simple: English syllable counting is genuinely hard, and the
 * only decision this feeds is "does this line fit in four beats". A count that
 * is occasionally off by one changes nothing.
 */
export function countSyllables(text: string): number {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  let total = 0;

  for (const word of words) {
    // Vowel groups approximate syllables.
    const groups = word.match(/[aeiouy]+/g);
    let n = groups ? groups.length : 1;

    // Silent terminal 'e' ("make" is one syllable, not two).
    if (word.length > 2 && word.endsWith('e') && !/[aeiouy]e$/.test(word)) {
      n = Math.max(1, n - 1);
    }
    total += Math.max(1, n);
  }
  return total;
}

/**
 * Distributes lines across the loop so they land on musical boundaries.
 *
 * Lines start on bar beginnings rather than arbitrary beats: a lyric that
 * starts mid-bar reads as a mistake even when the timing is technically fine.
 */
export function layoutLines(
  texts: string[],
  bars: number,
  beatsPerBar = 4,
): LyricLine[] {
  if (texts.length === 0) return [];

  const totalBeats = bars * beatsPerBar;
  // One line per bar when they fit; otherwise spread evenly.
  const beatsPerLine = Math.max(beatsPerBar, totalBeats / texts.length);

  return texts.map((text, i) => ({
    text,
    beat: Math.min(totalBeats - 1, i * beatsPerLine),
    durationBeats: beatsPerLine,
    syllables: countSyllables(text),
  }));
}

/**
 * Builds the lyric-writing prompt.
 *
 * Names the actual objects so the song is about the user's room, and states
 * the syllable budget explicitly — without it, models write lines far too long
 * to sing in four beats.
 */
export function buildLyricPrompt(
  objects: WorldJamObject[],
  plan: ArrangementPlan,
  mood?: string,
): string {
  const names = objects.map((o) => o.label).join(', ');
  const syllableBudget = Math.round(plan.bpm / 30) + 4;

  return `You are writing song lyrics for WorldJam. The singer recorded the real sounds of objects in their room and those sounds are now the instruments.

ROOM: ${names || 'everyday objects'}
STYLE: ${plan.style}
TEMPO: ${plan.bpm} BPM${mood ? `\nMOOD: ${mood}` : ''}

RULES:
- Write exactly 4 short lines, plus 1 hook line.
- Each line must be singable in about ${syllableBudget} syllables. Short is better than clever.
- Write about THIS room and these objects. Make the ordinary feel worth singing about.
- No rhyme is required, but rhythm matters more than meaning.
- Plain words. Nothing abstract.

Reply with ONLY this JSON, no prose:
{"lines":["line one","line two","line three","line four"],"hook":"the repeated line","mood":"one word"}`;
}

/** Parses and repairs the model's lyric response. */
export function parseLyricResponse(
  raw: unknown,
  bars: number,
): LyricSet | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const rawLines = Array.isArray(obj.lines) ? obj.lines : [];
  const lines = rawLines
    .filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
    .map((l) => l.trim())
    // A model that ignores the length rule produces unsingable lines; cut
    // rather than display something nobody can keep up with.
    .map((l) => (l.length > 48 ? l.slice(0, 45).trimEnd() + '…' : l))
    .slice(0, 4);

  if (lines.length === 0) return null;

  const hook =
    typeof obj.hook === 'string' && obj.hook.trim() ? obj.hook.trim() : lines[0];
  const mood = typeof obj.mood === 'string' ? obj.mood.trim() : 'warm';

  return {
    lines: layoutLines(lines, bars),
    hook,
    mood,
    source: 'gemma',
  };
}

/**
 * Rule-based lyrics, used when the model is absent or slow.
 *
 * Not a placeholder: this must produce something genuinely singable, because
 * on a phone CPU the model will often miss its deadline. Templates are built
 * from the user's own object names so the result is still about their room.
 */
export function buildFallbackLyrics(
  objects: WorldJamObject[],
  plan: ArrangementPlan,
): LyricSet {
  const names = objects.map((o) => o.label.toLowerCase());
  const a = names[0] ?? 'this room';
  const b = names[1] ?? 'the table';
  const c = names[2] ?? 'everything';

  const byStyle: Record<string, string[]> = {
    chill: [
      `Nothing here but ${a} and me`,
      `${b} keeps the time`,
      `Slow down, let it breathe`,
      `This room is all I need`,
    ],
    jazz: [
      `${a} swings a little late`,
      `${b} answers back`,
      `We never played this straight`,
      `And that's the way I like it`,
    ],
    lofi: [
      `Rain outside, ${a} inside`,
      `${b} on repeat`,
      `Dust in the afternoon`,
      `Nowhere else to be`,
    ],
    cinematic: [
      `It starts with ${a}`,
      `Then ${b} rises`,
      `Everything was always here`,
      `We just never listened`,
    ],
    edm: [
      `${a} hit it, here we go`,
      `${b} drop`,
      `Turn the room up loud`,
      `We built this out of nothing`,
    ],
    rock: [
      `Grabbed ${a}, made it loud`,
      `${b} hits back`,
      `No one gave us a stage`,
      `So we took the room`,
    ],
  };

  const lines = byStyle[plan.style] ?? byStyle.chill;
  const hook = `Turn ${c} into a song`;

  return {
    lines: layoutLines(lines, plan.bars),
    hook,
    mood: plan.style,
    source: 'fallback',
  };
}

export interface LyricResult {
  lyrics: LyricSet;
  elapsedMs: number | null;
  usedFallback: boolean;
  error?: string;
}

/**
 * Lyrics are less urgent than arrangement, so they get a longer budget.
 * Measured: a 4.6B model on this phone's CPU needs tens of seconds even for
 * four short lines.
 */
const LYRIC_TIMEOUT_MS = 40000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * Writes lyrics for the current session. Always resolves with something
 * singable — it degrades to templates rather than failing.
 */
export async function generateLyrics(
  objects: WorldJamObject[],
  plan: ArrangementPlan,
  vocal: VocalTake | null,
  mood?: string,
): Promise<LyricResult> {
  const fallback = () => buildFallbackLyrics(objects, plan);

  const runtime = getGemmaRuntime();
  if (!runtime || !runtime.isReady()) {
    return {
      lyrics: fallback(),
      elapsedMs: null,
      usedFallback: true,
      error: 'no on-device model loaded',
    };
  }

  const started = Date.now();
  try {
    const raw = await withTimeout(
      runtime.generate(
        formatGemmaPrompt(buildLyricPrompt(objects, plan, mood)),
        256,
      ),
      LYRIC_TIMEOUT_MS,
    );
    const elapsedMs = Date.now() - started;

    const parsed = parseLyricResponse(extractJson(raw), plan.bars);
    if (!parsed) {
      return {
        lyrics: fallback(),
        elapsedMs,
        usedFallback: true,
        error: 'model returned no usable lyrics',
      };
    }

    return { lyrics: parsed, elapsedMs, usedFallback: false };
  } catch (err) {
    return {
      lyrics: fallback(),
      elapsedMs: Date.now() - started,
      usedFallback: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Finds the line that should be showing at a given beat.
 *
 * Returns the index, or -1 before the first line. Used for both the karaoke
 * highlight and for deciding what to speak aloud in accessibility mode.
 */
export function lineAtBeat(lyrics: LyricSet, beat: number, bars: number): number {
  const loopBeats = bars * 4;
  const pos = ((beat % loopBeats) + loopBeats) % loopBeats;

  for (let i = lyrics.lines.length - 1; i >= 0; i--) {
    if (pos >= lyrics.lines[i].beat) return i;
  }
  return -1;
}
