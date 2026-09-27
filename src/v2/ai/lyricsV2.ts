import { countSyllables } from '@/ai/syllables';
import { extractJson } from '@/ai/schema';

import type { MusicPlan, PlanLyrics, PlanLyricsSection, SectionKind, StyleId } from '../contracts/musicPlan';
import { lyricsSchema } from './context';
import type { PlannerCapture } from './fallback';
import { styleSpec } from './kb/styles';
import type { LlmClient } from './planner';
import { normalizeLyrics } from './validator';

export type RewriteAction = 'rewrite' | 'shorten' | 'emotional' | 'rhyme' | 'language';

export interface LyricsOutcome {
  lyrics: PlanLyrics;
  source: 'model' | 'fallback';
  error: string | null;
}

const SECTION_TYPES: PlanLyricsSection['type'][] = ['verse', 'chorus', 'pre-chorus', 'bridge', 'intro', 'outro', 'hook'];

/** Plain text (as typed) → sections. "[Chorus]" / "Chorus:" headers are honoured; blank lines split stanzas. */
export function textToLyrics(text: string, title = 'Untitled', language = 'en'): PlanLyrics {
  const sections: PlanLyricsSection[] = [];
  let current: PlanLyricsSection | null = null;
  let stanza = 0;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const header = line.match(/^\[?\s*(verse|chorus|pre-chorus|bridge|intro|outro|hook)\s*\d*\s*\]?:?$/i);
    if (header) {
      current = { type: header[1].toLowerCase() as PlanLyricsSection['type'], lines: [] };
      sections.push(current);
      continue;
    }
    if (!line) {
      if (current && current.lines.length) current = null;
      continue;
    }
    if (!current) {
      current = { type: stanza % 2 === 1 ? 'chorus' : 'verse', lines: [] };
      sections.push(current);
      stanza++;
    }
    current.lines.push(line);
  }
  return { title, language, theme: '', sections: sections.filter((s) => s.lines.length) };
}

export function lyricsToText(l: PlanLyrics): string {
  return l.sections.map((s) => `[${s.type[0].toUpperCase()}${s.type.slice(1)}]\n${s.lines.join('\n')}`).join('\n\n');
}

function sourceWords(captures: PlannerCapture[]): string {
  return captures.map((c) => `${c.name}${c.description ? ` (${c.description})` : ''}`).join('; ');
}

/** Track → lyrics: written about the user's own sounds, in the track's style and mood. */
export async function generateLyrics(
  args: { plan: MusicPlan | null; captures: PlannerCapture[]; theme: string; style: StyleId | null; mood?: string | null; language: string },
  llm: LlmClient | null,
): Promise<LyricsOutcome> {
  const style = args.style ?? args.plan?.style ?? 'pop';
  const spec = styleSpec(style);
  const form = args.plan ? args.plan.sections.filter((s) => s.kind !== 'intro' && s.kind !== 'outro').map((s) => s.kind) : (['verse', 'chorus', 'verse', 'chorus'] as SectionKind[]);
  const fallback = (error: string | null): LyricsOutcome => ({ lyrics: fallbackLyrics(args.captures, args.theme, style, args.language), source: 'fallback', error });
  if (!llm) return fallback('music director model not loaded');
  const prompt = [
    'You are WorldJam Studio AI, a lyricist. Write original, singable lyrics. No filler, no forced rhymes, no copying existing songs.',
    `Style: ${spec.label} — ${spec.lyrics}`,
    `Mood: ${args.mood ?? args.plan?.mood ?? 'match the style'}. Language: ${args.language}.`,
    args.theme ? `Theme: ${args.theme}` : 'Theme: the sounds of the listener\'s own world.',
    `The track is built from these real sounds — let them inspire imagery: ${sourceWords(args.captures) || 'everyday sounds'}.`,
    `Song form: ${form.slice(0, 6).join(', ')}. Short lines (4–9 words), a clear repeated hook in the chorus.`,
    'Reply with JSON: {title, language, theme, sections:[{type, lines}]}.',
  ].join('\n');
  try {
    const raw = await llm.complete(prompt, { jsonSchema: lyricsSchema(), maxTokens: 500, temperature: 0.85 });
    const lyrics = normalizeLyrics(extractJson(raw));
    return lyrics ? { lyrics: { ...lyrics, language: args.language || lyrics.language }, source: 'model', error: null } : fallback('model returned no lyrics');
  } catch (err) {
    return fallback(err instanceof Error ? err.message : String(err));
  }
}

const ACTION_TEXT: Record<RewriteAction, string> = {
  rewrite: 'Rewrite these lyrics with fresher imagery, keeping the structure and the hook idea.',
  shorten: 'Shorten these lyrics: fewer, tighter lines, same structure.',
  emotional: 'Make these lyrics more emotional and vivid while keeping them singable.',
  rhyme: 'Improve the rhymes (end rhymes and internal rhymes) without forcing them.',
  language: 'Translate these lyrics, keeping the meaning, rhythm and hook.',
};

/** Rewrites user-approved lyrics. Only runs when the user asks; the original is never touched otherwise. */
export async function rewriteLyrics(
  lyrics: PlanLyrics,
  action: RewriteAction,
  llm: LlmClient | null,
  opts: { language?: string; instruction?: string } = {},
): Promise<LyricsOutcome> {
  const deterministic = (error: string | null): LyricsOutcome => {
    if (action === 'shorten') {
      return {
        lyrics: { ...lyrics, sections: lyrics.sections.map((s) => ({ ...s, lines: s.lines.slice(0, Math.max(1, Math.ceil(s.lines.length / 2))) })) },
        source: 'fallback',
        error,
      };
    }
    // Rewriting words needs the model; without it the lyrics stay as they are.
    return { lyrics, source: 'fallback', error: error ?? 'needs the music director model' };
  };
  if (!llm) return deterministic('music director model not loaded');
  const prompt = [
    'You are WorldJam Studio AI, a lyricist.',
    ACTION_TEXT[action] + (action === 'language' ? ` Target language: ${opts.language ?? 'Hindi'}.` : ''),
    opts.instruction ? `Extra instruction from the user: ${opts.instruction}` : '',
    `LYRICS:\n${lyricsToText(lyrics)}`,
    'Reply with JSON: {title, language, theme, sections:[{type, lines}]}.',
  ]
    .filter(Boolean)
    .join('\n\n');
  try {
    const raw = await llm.complete(prompt, { jsonSchema: lyricsSchema(), maxTokens: 500, temperature: 0.7 });
    const out = normalizeLyrics(extractJson(raw));
    if (!out) return deterministic('model returned no lyrics');
    return { lyrics: { ...out, title: out.title || lyrics.title, language: action === 'language' ? opts.language ?? out.language : lyrics.language }, source: 'model', error: null };
  } catch (err) {
    return deterministic(err instanceof Error ? err.message : String(err));
  }
}

export interface LyricHints {
  /** Suggested tempo from how densely the lines are packed. */
  tempoBpm: number;
  /** Song form mirroring the lyric sections (intro/outro added around them). */
  sections: SectionKind[];
  durationSec: number;
  syllablesPerLine: number;
}

/**
 * Lyrics → music hints (04 KB "Lyrics → music"): syllable density picks a
 * tempo that lets the lines be sung, and the lyric sections become the song
 * sections that carry the vocal.
 */
export function lyricsToPlanHints(lyrics: PlanLyrics, style: StyleId | null): LyricHints {
  const lines = lyrics.sections.flatMap((s) => s.lines);
  const syllables = lines.reduce((n, l) => n + countSyllables(l), 0) / Math.max(1, lines.length);
  const spec = styleSpec(style ?? 'pop');
  // ~8 syllables/line fits one bar at the style's home tempo; denser lines need more time per bar.
  const tempo = Math.round(Math.min(spec.tempo.max, Math.max(spec.tempo.min, spec.tempo.home * (8 / Math.max(4, syllables)) ** 0.35)));
  const kinds: SectionKind[] = ['intro', ...lyrics.sections.map((s): SectionKind => (s.type === 'chorus' || s.type === 'hook' ? 'chorus' : s.type === 'bridge' ? 'bridge' : 'verse')), 'outro'];
  const bars = 2 + lines.length + 2;
  const durationSec = Math.min(90, Math.max(10, Math.round((bars * 240) / tempo)));
  return { tempoBpm: tempo, sections: kinds, durationSec, syllablesPerLine: +syllables.toFixed(1) };
}

/** A short, honest template when no model is available — built from the user's own sound names. */
export function fallbackLyrics(captures: PlannerCapture[], theme: string, style: StyleId, language: string): PlanLyrics {
  const names = captures.map((c) => c.name.toLowerCase()).filter(Boolean);
  const a = names[0] ?? 'the rain';
  const b = names[1] ?? 'my heartbeat';
  const subject = theme.trim() || 'this little world';
  return {
    title: theme.trim() ? theme.trim().slice(0, 40) : `Song of ${a}`,
    language,
    theme: subject,
    sections: [
      { type: 'verse', lines: [`I hear ${a} in the morning light`, `${b[0].toUpperCase()}${b.slice(1)} keeps the time tonight`, `Every sound around me has a name`, `Nothing in ${subject} sounds the same`] },
      { type: 'chorus', lines: [`This is my world, turn it up`, `${a[0].toUpperCase()}${a.slice(1)} and ${b}, fill the cup`, `This is my world, hear it play`, `Every little sound finds its way`] },
      { type: 'verse', lines: [`Footsteps and echoes, a quiet street`, `The room is a drum beneath my feet`] },
      { type: 'chorus', lines: [`This is my world, turn it up`, `This is my world, never stop`] },
    ].map((s) => ({ ...s, type: SECTION_TYPES.includes(s.type as PlanLyricsSection['type']) ? (s.type as PlanLyricsSection['type']) : 'verse' })),
  };
}
