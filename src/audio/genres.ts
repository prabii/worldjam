import type { Style, WorldJamObject } from '@/types';

/**
 * Genres, described the way a music model understands them.
 *
 * The app used to know six styles, and anything else a user typed — phonk,
 * mass beat, Carnatic — was quietly turned into "chill". The words never
 * reached the model that makes the sound, so every description came back as
 * the same pad.
 *
 * This table is the fix. Each entry names the instruments and feel that make
 * a genre recognisable, which is exactly the vocabulary a text-to-music model
 * was trained on. It also names the nearest of the six legacy styles, so the
 * synthesised chords and groove underneath still have a table to read from.
 *
 * The table adds detail; it never limits. Text that matches nothing is sent
 * to the model exactly as typed.
 */

export interface GenreProfile {
  id: string;
  /** Shown to the user. */
  name: string;
  /** Lower-case words or phrases that select this genre. */
  keywords: string[];
  /** Instrumentation and feel, in the model's own vocabulary. */
  prompt: string;
  /** Tempo range the genre lives in. */
  bpm: [number, number];
  minor: boolean;
  /** Nearest legacy style, for the synth and groove tables. */
  style: Style;
  /**
   * Whether the generated bed may carry its own drums.
   *
   * Some genres are defined by their percussion — a phonk track without the
   * cowbell and 808 is not phonk. There the bed keeps its drums, mixed under
   * the user's objects. Everywhere else the objects are the only drums.
   */
  percussion: boolean;
}

export const GENRES: GenreProfile[] = [
  {
    id: 'phonk',
    name: 'Phonk',
    keywords: ['phonk', 'drift phonk', 'memphis', 'cowbell'],
    prompt:
      'dark drift phonk, distorted 808 bass, Memphis cowbell melody, chopped vocal samples, aggressive',
    bpm: [130, 150],
    minor: true,
    style: 'edm',
    percussion: true,
  },
  {
    id: 'mass',
    name: 'Mass beat',
    keywords: [
      'mass',
      // Longest keyword wins: "mass beat for a festival night" must not lose to EDM's "festival".
      'mass beat',
      'mass song',
      'dappankuthu',
      'kuthu',
      'teen maar',
      'teenmaar',
      'tamil folk',
      'telugu folk',
      'thappu',
      'parai',
    ],
    prompt:
      'South Indian mass dance beat, dappankuthu, loud thappu and parai drums, nadaswaram horn, festive and energetic',
    bpm: [96, 126],
    minor: false,
    style: 'rock',
    percussion: true,
  },
  {
    id: 'bhangra',
    name: 'Bhangra',
    keywords: ['bhangra', 'punjabi', 'dhol', 'tumbi'],
    prompt: 'Punjabi bhangra, driving dhol drum, tumbi riff, joyful dance energy',
    bpm: [96, 116],
    minor: false,
    style: 'rock',
    percussion: true,
  },
  {
    id: 'bollywood',
    name: 'Bollywood pop',
    keywords: ['bollywood', 'hindi', 'filmi', 'desi pop', 'hindi pop'],
    prompt:
      'Bollywood film pop, lush strings, tabla groove, harmonium, catchy melodic hook',
    bpm: [88, 112],
    minor: false,
    style: 'cinematic',
    percussion: true,
  },
  {
    id: 'carnatic',
    name: 'Carnatic',
    keywords: ['carnatic', 'veena', 'mridangam', 'south indian classical'],
    prompt: 'Carnatic classical, veena melody, mridangam rhythm, tanpura drone',
    bpm: [70, 100],
    minor: false,
    style: 'cinematic',
    percussion: false,
  },
  {
    id: 'indian-classical',
    name: 'Indian classical',
    keywords: [
      'indian classical',
      'hindustani',
      'raga',
      'sitar',
      'tabla',
      'tanpura',
      'bansuri',
      'indian',
    ],
    prompt: 'Indian classical raga, sitar melody, tabla, tanpura drone, bansuri flute',
    bpm: [70, 96],
    minor: true,
    style: 'cinematic',
    percussion: false,
  },
  {
    id: 'trap',
    name: 'Trap',
    keywords: ['trap', 'drill', '808'],
    prompt: 'modern trap, rolling hi-hats, deep 808 slides, dark bell melody',
    bpm: [130, 150],
    minor: true,
    style: 'edm',
    percussion: true,
  },
  {
    id: 'hiphop',
    name: 'Hip hop',
    keywords: ['hip hop', 'hiphop', 'boom bap', 'rap'],
    prompt: 'boom bap hip hop, dusty soul sample chop, warm bass, head-nod groove',
    bpm: [84, 98],
    minor: true,
    style: 'lofi',
    percussion: true,
  },
  {
    id: 'lofi',
    name: 'Lo-fi',
    keywords: ['lofi', 'lo-fi', 'lo fi', 'study', 'chillhop'],
    prompt: 'lofi chillhop, dusty Rhodes chords, vinyl crackle, mellow bass',
    bpm: [70, 88],
    minor: true,
    style: 'lofi',
    percussion: false,
  },
  {
    id: 'pop',
    name: 'Pop',
    keywords: ['pop', 'radio', 'catchy', 'k-pop', 'kpop'],
    prompt: 'bright modern pop, punchy synths, uplifting chords, catchy hook',
    bpm: [100, 124],
    minor: false,
    style: 'edm',
    percussion: false,
  },
  {
    id: 'edm',
    name: 'EDM',
    keywords: ['edm', 'house', 'techno', 'dance', 'club', 'rave', 'festival'],
    prompt: 'festival EDM, supersaw lead, pumping sidechained bass, big build and drop',
    bpm: [122, 130],
    minor: true,
    style: 'edm',
    percussion: true,
  },
  {
    id: 'afrobeat',
    name: 'Afrobeats',
    keywords: ['afro', 'afrobeat', 'afrobeats', 'amapiano'],
    prompt: 'afrobeats, syncopated percussion, log drum bass, bright guitar licks',
    bpm: [100, 115],
    minor: false,
    style: 'chill',
    percussion: true,
  },
  {
    id: 'reggaeton',
    name: 'Reggaeton',
    keywords: ['reggaeton', 'latin', 'dembow'],
    prompt: 'reggaeton, dembow rhythm, latin synth stabs, deep bass',
    bpm: [88, 100],
    minor: true,
    style: 'edm',
    percussion: true,
  },
  {
    id: 'jazz',
    name: 'Jazz',
    keywords: ['jazz', 'swing', 'bebop', 'smooth jazz'],
    prompt: 'smoky jazz trio, walking upright bass, brushed piano chords',
    bpm: [100, 136],
    minor: false,
    style: 'jazz',
    percussion: false,
  },
  {
    id: 'rock',
    name: 'Rock',
    keywords: ['rock', 'metal', 'punk', 'guitar', 'grunge'],
    prompt: 'driving rock, overdriven electric guitars, solid bass line',
    bpm: [100, 132],
    minor: false,
    style: 'rock',
    percussion: false,
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    keywords: ['cinematic', 'epic', 'film', 'movie', 'trailer', 'orchestra'],
    prompt: 'epic cinematic orchestra, soaring strings, brass swells, taiko hits',
    bpm: [62, 90],
    minor: true,
    style: 'cinematic',
    percussion: false,
  },
  {
    id: 'chill',
    name: 'Chill',
    keywords: ['chill', 'relax', 'calm', 'ambient', 'mellow'],
    prompt: 'chill ambient, soft electric piano, warm pad, gentle and airy',
    bpm: [84, 100],
    minor: false,
    style: 'chill',
    percussion: false,
  },
];

/**
 * The genre a piece of text asks for, or null when it names none.
 *
 * Longer keywords win: "south indian classical" must pick Carnatic, not the
 * generic "indian" that also appears inside it, and "drift phonk" must not be
 * outscored by some other entry's shorter word.
 */
export function matchGenre(text: string | null | undefined): GenreProfile | null {
  if (!text) return null;
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ')} `;

  let best: GenreProfile | null = null;
  let bestLen = 0;

  for (const g of GENRES) {
    for (const k of g.keywords) {
      // Whole-word match, so "pop" does not fire inside "popcorn".
      if (t.includes(` ${k} `) && k.length > bestLen) {
        best = g;
        bestLen = k.length;
      }
    }
  }
  return best;
}

/** Clamps a tempo into a genre's range. */
export function genreTempo(g: GenreProfile, bpm: number): number {
  const [lo, hi] = g.bpm;
  if (!Number.isFinite(bpm)) return Math.round((lo + hi) / 2);
  return Math.round(Math.min(hi, Math.max(lo, bpm)));
}

/**
 * Plain words for what the user's recordings sound like.
 *
 * The music model cannot hear the objects, so it is told about them: a set of
 * bright, short clicks wants a different bed from deep, ringing knocks. Taken
 * from the analysis every capture already carries.
 */
export function describeObjects(objects: WorldJamObject[]): string | null {
  const feats = objects.map((o) => o.features).filter((f) => f != null);
  if (feats.length === 0) return null;

  const avg = (k: 'brightness' | 'decay' | 'tonality') =>
    feats.reduce((a, f) => a + (f![k] ?? 0), 0) / feats.length;

  const brightness = avg('brightness');
  const decay = avg('decay');
  const tonality = avg('tonality');

  const tone = brightness > 3000 ? 'bright metallic' : brightness > 1200 ? 'crisp woody' : 'deep thuddy';
  const length = decay < 0.15 ? 'short percussive' : decay < 0.5 ? 'punchy' : 'ringing';
  const kind = tonality > 0.5 ? 'tonal' : 'found-sound';

  return `complements ${tone} ${length} ${kind} hits`;
}

// ── Genre grooves ───────────────────────────────────────────────────────────

/** Which part of a beat an object plays. */
export type GrooveRole = 'kick' | 'snare' | 'hat' | 'perc';

/**
 * One bar of each genre's signature rhythm, as 1-indexed beats (2.5 is the
 * "and" of two, 2.75 the last sixteenth before three).
 *
 * This is what makes phonk sound like phonk rather than lofi with a different
 * pad: the pattern the user's own objects play. Without it every genre fell
 * back to the same per-style pattern, so changing genre changed the backing
 * but never the beat.
 */
const GROOVES: Record<string, Record<GrooveRole, number[]>> = {
  // Half-time trap feel with the cowbell riding the offbeats.
  phonk: { kick: [1, 2.75, 3.5], snare: [3], hat: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5], perc: [1.5, 2.25, 3.5, 4.25] },
  // Bouncy dappankuthu: the kick skips ahead of the beat.
  mass: { kick: [1, 1.75, 2.5, 3, 3.75, 4.5], snare: [2, 4], hat: [1.5, 2.5, 3.5, 4.5], perc: [1, 1.25, 2.75, 3.25, 4] },
  // Dhol chaal: the heavy side on 1 and the and-of-2.
  bhangra: { kick: [1, 2.5, 3], snare: [2, 3.5, 4], hat: [1.5, 2, 2.5, 3.5, 4, 4.5], perc: [1.75, 3.75] },
  bollywood: { kick: [1, 2.5, 3], snare: [2, 4], hat: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5], perc: [1.75, 3.25, 4.5] },
  trap: {
    kick: [1, 2.75, 3.25],
    snare: [3],
    hat: [1, 1.25, 1.5, 1.75, 2, 2.5, 2.75, 3, 3.5, 3.75, 4, 4.25, 4.5],
    perc: [4.75],
  },
  hiphop: { kick: [1, 2.75, 3.5], snare: [2, 4], hat: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5], perc: [4.75] },
  lofi: { kick: [1, 2.75, 3.5], snare: [2, 4], hat: [1.5, 2.5, 3.5, 4.5], perc: [] },
  pop: { kick: [1, 2, 3, 4], snare: [2, 4], hat: [1.5, 2.5, 3.5, 4.5], perc: [4.75] },
  edm: { kick: [1, 2, 3, 4], snare: [2, 4], hat: [1.5, 2.5, 3.5, 4.5], perc: [1.75, 3.75] },
  afrobeat: { kick: [1, 2.5, 3], snare: [2.75, 4.25], hat: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5], perc: [1.25, 3.25] },
  reggaeton: { kick: [1, 2, 3, 4], snare: [1.75, 2.5, 3.75, 4.5], hat: [1.5, 2.5, 3.5, 4.5], perc: [] },
  rock: { kick: [1, 2.5, 3], snare: [2, 4], hat: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5], perc: [] },
  jazz: { kick: [1, 3], snare: [2, 4], hat: [1, 2, 2.75, 3, 4, 4.75], perc: [] },
  // Sparse, tabla-like: accents rather than a kit.
  'indian-classical': { kick: [1], snare: [], hat: [], perc: [1, 1.75, 2.5, 3, 3.75, 4.5] },
  carnatic: { kick: [1], snare: [], hat: [], perc: [1, 1.5, 2.25, 3, 3.5, 4.25] },
  cinematic: { kick: [1, 3.5], snare: [], hat: [], perc: [4, 4.5] },
  chill: { kick: [1, 3], snare: [2.5], hat: [1.5, 3.5], perc: [] },
};

/**
 * Casts the captured objects as a drum kit.
 *
 * An object's analysed role wins where it names a drum; otherwise the
 * darkest remaining sound takes the kick and the brightest the hats, because
 * that is how the ear hears weight and air.
 */
export function castKit(objects: WorldJamObject[]): Map<string, GrooveRole> {
  const cast = new Map<string, GrooveRole>();
  const rest: WorldJamObject[] = [];
  for (const o of objects) {
    // "perc" is the analyser's catch-all, so it is recast by brightness
    // rather than trusted; otherwise a whole kit lands on one part.
    if (o.role === 'kick' || o.role === 'snare' || o.role === 'hat') {
      cast.set(o.id, o.role);
    } else {
      rest.push(o);
    }
  }
  const taken = new Set(cast.values());
  const byDark = [...rest].sort(
    (a, b) => (a.features?.brightness ?? 0) - (b.features?.brightness ?? 0),
  );
  // Fill the kit in order of what a beat needs most.
  const wanted: GrooveRole[] = (['kick', 'hat', 'snare', 'perc'] as GrooveRole[]).filter(
    (r) => !taken.has(r),
  );
  for (const o of byDark) {
    let role: GrooveRole = 'perc';
    if (wanted.includes('kick') && o === byDark[0]) role = 'kick';
    else if (wanted.includes('hat') && o === byDark[byDark.length - 1] && byDark.length > 1) role = 'hat';
    else if (wanted.includes('snare') && ![...cast.values()].includes('snare')) role = 'snare';
    cast.set(o.id, role);
  }
  return cast;
}

/**
 * The genre's beat, played by the user's objects, as an arrangement pattern.
 *
 * Returns null when the genre has no groove on file, so the model's own
 * pattern stands.
 */
export function grooveFor(
  genre: GenreProfile,
  objects: WorldJamObject[],
): Array<{ object: string; beats: number[] }> | null {
  const groove = GROOVES[genre.id];
  if (!groove || objects.length === 0) return null;
  const cast = castKit(objects);
  const out: Array<{ object: string; beats: number[] }> = [];
  for (const o of objects) {
    const role = cast.get(o.id) ?? 'perc';
    let beats = groove[role];
    // A sparse genre with no part for this role still gives the object an
    // accent on the one, so nothing the user recorded goes silent.
    if (beats.length === 0) beats = role === 'hat' ? [] : [1];
    if (beats.length > 0) out.push({ object: o.label, beats: [...beats] });
  }
  return out.length > 0 ? out : null;
}
