import type { LoopEvent, Style } from '@/types';
import type { SectionKind } from './arrangement';
import { matchGenre } from './genres';

/**
 * The AI texture layer: a few seconds of generated atmosphere (a pad, vinyl
 * crackle, strings) that sits under the user's real sounds.
 *
 * Gemma decides WHAT it should be and writes the prompt; Stable Audio Open
 * Small, running on the phone, makes the sound. Everything rhythmic stays the
 * user's own recordings: the texture is air and colour, never the beat.
 *
 * Pure helpers only, so they are tested without the generator.
 */

/** Stable Audio Open Small makes at most ~11 s per call. */
export const MAX_TEXTURE_SECONDS = 11;

/**
 * Longest whole number of bars (1, 2 or 4) that fits in one generation.
 *
 * A texture cut to exact bars and re-fired on the bar line stays in time with
 * the loop however long the song is. At 80 BPM that is 2 bars (6 s); at 126
 * BPM, 4 bars (7.6 s).
 */
export function textureBars(bpm: number, maxSeconds = MAX_TEXTURE_SECONDS): number {
  const barSeconds = 240 / Math.max(1, bpm);
  // A longer-reaching engine gets a longer, less repetitive loop — up to eight
  // bars, which is a whole phrase rather than a fragment going round.
  for (const bars of [8, 4, 2, 1]) {
    if (bars * barSeconds <= maxSeconds) return bars;
  }
  return 1;
}

export function textureSeconds(bpm: number, maxSeconds = MAX_TEXTURE_SECONDS): number {
  return textureBars(bpm, maxSeconds) * (240 / Math.max(1, bpm));
}

/** One trigger at the top of every texture-length block across the song. */
export function textureEvents(
  bpm: number,
  totalBars: number,
  maxSeconds = MAX_TEXTURE_SECONDS,
): LoopEvent[] {
  // Must use the same length the clip was generated at, or re-triggers land
  // mid-clip and the texture stutters.
  const every = textureBars(bpm, maxSeconds);
  const events: LoopEvent[] = [];
  for (let bar = 0; bar < totalBars; bar += every) {
    events.push({ objectId: 'texture', beat: bar * 4, velocity: 1 });
  }
  return events;
}

/** What each style asks for when the model did not say. */
const STYLE_TEXTURE: Record<Style, string> = {
  chill: 'soft warm electric piano chords, mellow, airy, no drums',
  jazz: 'smoky upright bass and brushed jazz piano chords, late night, no drums',
  lofi: 'dusty lofi chord pad with vinyl crackle and tape hiss, no drums',
  cinematic: 'slow cinematic string swell, dark and emotional, no drums',
  edm: 'bright supersaw synth pad, uplifting, sidechained, no drums',
  rock: 'warm overdriven guitar chords sustaining, no drums',
};

/**
 * The final prompt sent to the generator.
 *
 * Tempo and key are appended because the model was trained on tagged audio
 * and follows them; "no drums" is kept because the user's objects ARE the
 * drums, and a second drum kit would bury them.
 */
export function buildTexturePrompt(
  style: Style,
  bpm: number,
  key: string | null,
  modelTexture?: string | null,
  intent?: MusicIntent,
): string {
  const { core, drums } = describeIntent(style, modelTexture, intent);
  const parts = [core];
  if (!/\bbpm\b/i.test(core)) parts.push(`${Math.round(bpm)} BPM`);
  if (key && !core.toLowerCase().includes(key.toLowerCase())) parts.push(key);
  if (!drums) parts.push('no drums');
  return fitPrompt(parts);
}

/**
 * What the user actually asked for, carried alongside the plan.
 *
 * `instruction` is the text they typed; `genre` is what Gemma decided the
 * genre was; `objects` describes their recordings. Any of them may be absent.
 */
export interface MusicIntent {
  instruction?: string | null;
  genre?: string | null;
  objects?: string | null;
}

/**
 * Words that mean the user wants a beat, even in a genre the table does not
 * know. "Give me a heavy beat" is a request for drums whatever the genre.
 */
const WANTS_DRUMS = /\b(beat|beats|drum|drums|groove|percussion|banger|bass drop)\b/i;

/**
 * The heart of every prompt: which sound, and whether it may have drums.
 *
 * Priority runs from the most specific signal to the least — the user's own
 * words, then the genre those words (or Gemma) name, then Gemma's texture,
 * then the style default. The user's text is kept verbatim as well as
 * expanded, because the model was trained on exactly this kind of plain
 * description and a genre table can never list everything someone might type.
 */
function describeIntent(
  style: Style,
  modelTexture: string | null | undefined,
  intent: MusicIntent | undefined,
): { core: string; drums: boolean } {
  const said = sanitiseTexture(intent?.instruction);
  const genre = matchGenre(said) ?? matchGenre(intent?.genre);

  const pieces: string[] = [];
  if (said) pieces.push(said);
  if (genre && !(said ?? '').toLowerCase().includes(genre.prompt.toLowerCase())) {
    pieces.push(genre.prompt);
  }
  if (pieces.length === 0) {
    pieces.push(sanitiseTexture(modelTexture) ?? STYLE_TEXTURE[style]);
  }
  if (intent?.objects) pieces.push(intent.objects);

  const drums = genre?.percussion === true || (said != null && WANTS_DRUMS.test(said));
  const core = pieces
    .join(', ')
    .replace(/,?\s*no drums/gi, '')
    .trim();
  return { core, drums };
}

/**
 * Keeps a prompt inside what the text encoder reads.
 *
 * The encoders take a few dozen tokens and silently drop the rest, and what
 * falls off the end is the tempo and key — the parts that keep separately
 * generated clips in agreement. So the descriptive head is trimmed instead,
 * and the tagging tail always survives.
 */
function fitPrompt(parts: string[], max = 220): string {
  const joined = parts.join(', ');
  if (joined.length <= max) return joined;
  const tail = parts.slice(1).join(', ');
  const room = Math.max(40, max - tail.length - 2);
  return `${parts[0].slice(0, room).replace(/[,\s]+\S*$/, '')}, ${tail}`;
}

/**
 * What each section wants from the bed, in the order it is asked for.
 *
 * A song's backing is not one sound held down for two minutes. The intro
 * hints, the verse supports, the chorus opens out, the outro lets go — and
 * because the generator is prompted in plain language, saying so is the whole
 * mechanism. Each entry is an adjective phrase and a density, which the
 * builder folds into the style's own description.
 */
const SECTION_COLOUR: Record<SectionKind, string> = {
  intro: 'sparse and distant, one held chord, lots of air',
  verse: 'steady and understated, sitting back in the mix',
  build: 'rising tension, thickening, pushing forward',
  chorus: 'full and bright, wide stereo, the biggest moment',
  drop: 'stripped to a deep sub and one stab, huge space',
  outro: 'thinning out, fading, the last chord ringing',
};

/**
 * The prompt for one section's musical bed.
 *
 * Key and tempo are named because the model was trained on tagged audio and
 * genuinely follows them — without the key, four beds generated separately
 * will not agree with each other or with the chord layers underneath.
 *
 * "no drums" survives every path: the user's objects ARE the drums, and a
 * generated kit on top buries the thing the whole app is about.
 */
export function buildSectionPrompt(
  kind: SectionKind,
  style: Style,
  bpm: number,
  key: string | null,
  modelTexture?: string | null,
  intent?: MusicIntent,
): string {
  const { core, drums } = describeIntent(style, modelTexture, intent);
  const parts = [core, SECTION_COLOUR[kind], `${Math.round(bpm)} BPM`];
  if (key) parts.push(key);
  // Stated once, at the end, where it reads as an instruction rather than an
  // aside — and only where the genre is not defined by its drums.
  if (!drums) parts.push('no drums');
  return fitPrompt(parts);
}

/**
 * Stable seed per section, derived from the prompt.
 *
 * Sections of the same kind must sound identical when reused, and two
 * different kinds must not — both fall out of seeding from the prompt text.
 */
export function sectionSeed(prompt: string): number {
  return textureSeed(prompt);
}

/** Accepts a model-written texture only if it is a short plain description. */
export function sanitiseTexture(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/[\r\n"`{}<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length < 4) return null;
  return text.slice(0, 100);
}

/** Stable seed per prompt, so the same arrangement gets the same texture. */
export function textureSeed(prompt: string): number {
  let h = 2166136261;
  for (let i = 0; i < prompt.length; i++) {
    h ^= prompt.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1_000_000;
}
