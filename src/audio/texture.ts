import type { LoopEvent, Style } from '@/types';

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
export function textureBars(bpm: number): number {
  const barSeconds = 240 / Math.max(1, bpm);
  for (const bars of [4, 2, 1]) {
    if (bars * barSeconds <= MAX_TEXTURE_SECONDS) return bars;
  }
  return 1;
}

export function textureSeconds(bpm: number): number {
  return textureBars(bpm) * (240 / Math.max(1, bpm));
}

/** One trigger at the top of every texture-length block across the song. */
export function textureEvents(bpm: number, totalBars: number): LoopEvent[] {
  const every = textureBars(bpm);
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
): string {
  const base = sanitiseTexture(modelTexture) ?? STYLE_TEXTURE[style];
  const parts = [base];
  if (!/no drums/i.test(base)) parts.push('no drums');
  if (!/\bbpm\b/i.test(base)) parts.push(`${Math.round(bpm)} BPM`);
  if (key && !base.toLowerCase().includes(key.toLowerCase())) parts.push(key);
  return parts.join(', ');
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
