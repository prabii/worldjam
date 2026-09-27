import type { LoopEvent, MusicalRole, Style, WorldJamObject } from '@/types';
import {
  SECTION_DENSITY,
  SECTION_GAIN,
  sectionAt,
  thinBeats,
  velocityFor,
  type Section,
  type SectionKind,
} from './arrangement';

/**
 * The song, as opposed to the loop.
 *
 * `buildForm` in ./arrangement.ts shapes one pass of the loop — a handful of
 * bars with a lift at the end — and that is the right thing while someone is
 * jamming. A song is a different object: it opens, states an idea, answers it,
 * says it again louder, and stops. It has to end rather than simply cease.
 *
 * This module builds that longer arc and renders a pattern across it. It is
 * deliberately separate from `buildForm`, which is load-bearing for live play:
 * a song is additive, and nothing here changes how the loop behaves.
 *
 * Deterministic throughout — rehearsing a demo twice must give the same song.
 */

/** Bars in the standard arc, which is what the timings below assume. */
export const SONG_BARS = 48;

/**
 * The arc.
 *
 * Eight-bar verses and choruses because that is the length at which a phrase
 * reads as a statement rather than a fragment; four-bar bookends because an
 * intro that outstays its welcome is worse than no intro. Repeating the
 * verse–chorus pair is what makes the second chorus feel earned instead of
 * merely next.
 *
 * At 92 BPM this is about two minutes.
 */
const STANDARD: Array<{ kind: SectionKind; bars: number }> = [
  { kind: 'intro', bars: 4 },
  { kind: 'verse', bars: 8 },
  { kind: 'chorus', bars: 8 },
  { kind: 'verse', bars: 8 },
  { kind: 'build', bars: 4 },
  { kind: 'chorus', bars: 12 },
  { kind: 'outro', bars: 4 },
];

/**
 * EDM trades the second verse for tension and release.
 *
 * The genre is built around the moment everything stops and then lands, so a
 * form without a drop is not really the genre.
 */
const EDM: Array<{ kind: SectionKind; bars: number }> = [
  { kind: 'intro', bars: 4 },
  { kind: 'verse', bars: 8 },
  { kind: 'build', bars: 4 },
  { kind: 'drop', bars: 8 },
  { kind: 'verse', bars: 8 },
  { kind: 'build', bars: 4 },
  { kind: 'drop', bars: 8 },
  { kind: 'outro', bars: 4 },
];

/**
 * Cinematic earns a longer opening and no sudden stop.
 *
 * The style is about arrival, so the form spends more of itself getting there
 * and then leaves properly rather than cutting.
 */
const CINEMATIC: Array<{ kind: SectionKind; bars: number }> = [
  { kind: 'intro', bars: 8 },
  { kind: 'verse', bars: 8 },
  { kind: 'build', bars: 8 },
  { kind: 'chorus', bars: 12 },
  { kind: 'outro', bars: 8 },
];

/**
 * Builds the song's sections, in order, with absolute bar positions.
 *
 * Sections are contiguous by construction: each one starts where the previous
 * ended, so there can be no gap or overlap for the renderer to trip over.
 */
export function buildSongForm(style: Style): Section[] {
  const shape =
    style === 'edm' ? EDM : style === 'cinematic' ? CINEMATIC : STANDARD;

  let startBar = 0;
  return shape.map((s) => {
    const section = { kind: s.kind, startBar, bars: s.bars };
    startBar += s.bars;
    return section;
  });
}

/** Total length of a form, in bars. */
export function songBars(form: Section[]): number {
  return form.reduce((total, s) => total + s.bars, 0);
}

/** Length of a form in seconds, for showing the user before they commit. */
export function songSeconds(form: Section[], bpm: number): number {
  return (songBars(form) * 4 * 60) / Math.max(1, bpm);
}

/**
 * A fill on the last bar of a section.
 *
 * Marks the turnaround so the next section arrives rather than merely
 * happening. Kept local rather than imported because a song's turnarounds are
 * longer than a loop's: there is more distance to travel between an eight-bar
 * verse and its chorus than between two bars of a loop.
 */
function fillBeats(kind: SectionKind, isFinal: boolean): number[] {
  if (isFinal) return [];
  if (kind === 'build') return [3, 3.5, 4, 4.25, 4.5, 4.75];
  if (kind === 'intro') return [4, 4.5];
  return [4, 4.5, 4.75];
}

export interface SongRenderOptions {
  objects: WorldJamObject[];
  /** One bar of beats per object label, as the arranger produces. */
  objectPattern: Array<{ object: string; beats: number[] }>;
  form: Section[];
  /**
   * Lower-cased labels of objects the user programmed themselves. Their beat
   * plays in full wherever the section lets the part sound at all.
   */
  fixed?: ReadonlySet<string>;
}

/**
 * Renders a one-bar pattern across the whole song.
 *
 * Each bar is filtered by its section's density, scaled by its gain, and the
 * last bar of a section gets a fill. This is the same idea as
 * `renderArrangement`, applied to a form long enough to have an argument.
 */
export function renderSong({
  objects,
  objectPattern,
  form,
  fixed,
}: SongRenderOptions): LoopEvent[] {
  const events: LoopEvent[] = [];
  const total = songBars(form);

  // Matched case-insensitively: the schema normalises pattern names to the
  // object's own label, but a drift here would fail as silence, not an error.
  const byLabel = new Map(objects.map((o) => [o.label.toLowerCase(), o]));

  const fillObject =
    objects.find((o) => o.role === 'snare') ??
    objects.find((o) => o.role === 'perc') ??
    objects[0];

  for (let bar = 0; bar < total; bar++) {
    const section = sectionAt(form, bar);
    const density = SECTION_DENSITY[section.kind];
    const gain = SECTION_GAIN[section.kind];
    const isLastBarOfSection = bar === section.startBar + section.bars - 1;

    for (const pattern of objectPattern) {
      const obj = byLabel.get(pattern.object.toLowerCase());
      if (!obj) continue;

      const roleDensity = density[obj.role as MusicalRole] ?? 1;
      // A part the section silences stays silent even when the user
      // programmed it: an intro where everything plays is not an intro.
      if (roleDensity <= 0) continue;

      const beats = fixed?.has(pattern.object.toLowerCase())
        ? pattern.beats
        : thinBeats(pattern.beats, roleDensity);

      for (const beat of beats) {
        events.push({
          objectId: obj.id,
          beat: bar * 4 + (beat - 1),
          velocity: clamp(velocityFor(beat) * gain),
        });
      }
    }

    if (isLastBarOfSection && fillObject) {
      for (const beat of fillBeats(section.kind, bar >= total - 1)) {
        events.push({
          objectId: fillObject.id,
          beat: bar * 4 + (beat - 1),
          // Under the downbeat it leads into: a fill louder than its arrival
          // swallows the arrival.
          velocity: clamp(0.5 + (beat % 1) * 0.25),
        });
      }
    }
  }

  return events.sort((a, b) => a.beat - b.beat);
}

/**
 * The distinct section kinds in a form, in first-appearance order.
 *
 * Generating a musical bed costs tens of seconds, and a form states most of
 * its kinds more than once. Generating per kind rather than per section is
 * what keeps a two-minute song to four generations instead of seven.
 */
export function distinctKinds(form: Section[]): SectionKind[] {
  const seen: SectionKind[] = [];
  for (const s of form) {
    if (!seen.includes(s.kind)) seen.push(s.kind);
  }
  return seen;
}

function clamp(v: number): number {
  return Math.max(0.05, Math.min(1, v));
}
