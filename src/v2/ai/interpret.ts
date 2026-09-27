import type { Capture } from '../contracts/library';
import { STYLE_IDS, type StyleId } from '../contracts/musicPlan';
import { STYLES } from './kb/styles';

/**
 * Deterministic reading of a prompt (04_MUSIC_KNOWLEDGE_BASE "Prompt
 * interpretation"): style, mood, energy, tempo, duration, featured/excluded
 * sources, lyrics wanted. Feeds the model context and drives the fallback, so
 * the app responds to the words even with no model loaded.
 */
export interface Intent {
  style: StyleId | null;
  mood: string | null;
  energy: 'low' | 'medium' | 'high' | null;
  tempoBpm: number | null;
  tempoHint: 'faster' | 'slower' | null;
  durationSec: number | null;
  featured: string[];
  excluded: string[];
  wantsLyrics: boolean;
}

const STYLE_WORDS: Array<[RegExp, StyleId]> = [
  [/\b(lo-?fi|lofi|chillhop|study beats?)\b/, 'lofi'],
  [/\b(edm|electro|festival|big drop|dubstep|techno)\b/, 'edm'],
  [/\b(house|deep house|disco)\b/, 'house'],
  [/\b(trap|808s?|drill)\b/, 'trap'],
  [/\b(hip ?-?hop|boom ?bap|rap)\b/, 'hiphop'],
  [/\b(d(rum)? ?(and|&|n) ?b(ass)?|dnb|jungle)\b/, 'dnb'],
  [/\b(jazz\w*|swing\w*|bebop|bossa)\b/, 'jazz'],
  [/\b(rock\w*|punk|grunge|metal)\b/, 'rock'],
  [/\b(pop|catchy|radio)\b/, 'pop'],
  [/\b(cinematic|epic|film|movie|orchestral|trailer)\b/, 'cinematic'],
  [/\b(ambient|drone|atmospher\w*|soundscape)\b/, 'ambient'],
  [/\b(acoustic|folk|unplugged|campfire)\b/, 'acoustic'],
  [/\b(chill|chilled|relax\w*|calm|downtempo|mellow)\b/, 'chill'],
];

const MOODS = ['dark', 'happy', 'sad', 'dreamy', 'energetic', 'calm', 'mysterious', 'romantic', 'angry', 'nostalgic', 'uplifting', 'melancholic', 'playful', 'tense', 'warm'];

export function interpretPrompt(prompt: string, captures: Pick<Capture, 'id' | 'name'>[] = []): Intent {
  const p = ` ${prompt.toLowerCase()} `;
  let style: StyleId | null = null;
  for (const [re, id] of STYLE_WORDS) {
    if (re.test(p)) {
      style = id;
      break;
    }
  }
  if (!style) style = STYLE_IDS.find((id) => p.includes(` ${STYLES[id].label.toLowerCase()} `)) ?? null;

  const mood = MOODS.find((m) => p.includes(m)) ?? null;
  const energy: Intent['energy'] = /\b(energetic|hype|intense|hard|banger|party|fast|driving|upbeat)\b/.test(p)
    ? 'high'
    : /\b(calm|soft|gentle|sleepy|quiet|slow|chill|mellow|relax)/.test(p)
      ? 'low'
      : null;

  const bpmMatch = p.match(/(\d{2,3})\s*(bpm|beats per minute)/);
  const tempoBpm = bpmMatch ? Math.min(200, Math.max(50, Number(bpmMatch[1]))) : null;
  const tempoHint = /\b(faster|fast|quick|uptempo)\b/.test(p) ? 'faster' : /\b(slower|slow|half ?time)\b/.test(p) ? 'slower' : null;

  const secMatch = p.match(/(\d{2,3})\s*(s|sec|secs|seconds)\b/);
  const minMatch = p.match(/(\d(?:\.\d)?)\s*(min|minute|minutes)\b/);
  const durationSec = secMatch ? Number(secMatch[1]) : minMatch ? Math.round(Number(minMatch[1]) * 60) : null;

  const featured: string[] = [];
  const excluded: string[] = [];
  for (const c of captures) {
    const name = c.name.toLowerCase().trim();
    if (!name) continue;
    const words = name.split(/\s+/).filter((w) => w.length > 2);
    const mentioned = p.includes(name) || words.some((w) => new RegExp(`\\b${w.replace(/[^a-z0-9]/g, '')}\\b`).test(p));
    if (!mentioned) continue;
    const around = p.slice(Math.max(0, p.indexOf(words[0] ?? name) - 24), p.indexOf(words[0] ?? name));
    if (/\b(no|without|remove|drop|mute|skip|not)\b[^.]*$/.test(around)) excluded.push(c.id);
    else featured.push(c.id);
  }

  const wantsLyrics = /\b(lyric\w*|words|song about|verse|chorus|sing along|write)\b/.test(p);
  return { style, mood, energy, tempoBpm, tempoHint, durationSec, featured, excluded, wantsLyrics };
}
