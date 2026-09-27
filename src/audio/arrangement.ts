import type { LoopEvent, MusicalRole, Style, WorldJamObject } from '@/types';

/**
 * Song structure.
 *
 * The arranger produces one bar of beats per object and the scheduler repeats
 * it, so every bar was identical — the reason a jam sounded like a loop rather
 * than a piece of music. Real arrangements move: they start sparse, add parts,
 * mark the turnaround, and leave gaps before a big moment.
 *
 * This module takes the per-object pattern and renders it across the whole
 * form, deciding for each bar which parts play, how hard, and where to put a
 * fill. Everything here is deterministic given the same inputs — rehearsing a
 * demo twice has to give the same song.
 */

/** What a bar is doing in the arc of the song. */
export type SectionKind = 'intro' | 'verse' | 'build' | 'chorus' | 'drop' | 'outro';

export interface Section {
  kind: SectionKind;
  /** First bar of the section, 0-indexed. */
  startBar: number;
  bars: number;
}

/**
 * How present each role is in a section, 0..1.
 *
 * 0 means the part sits out. These are densities rather than on/off switches
 * so a role can be thinned — playing its strong beats only — instead of
 * disappearing, which is what makes a verse sound like the same song as the
 * chorus rather than a different one.
 */
export type RoleDensity = Record<MusicalRole, number>;

export const SECTION_DENSITY: Record<SectionKind, RoleDensity> = {
  intro: { kick: 0.5, snare: 0, hat: 0.5, perc: 0.3, bass: 0, lead: 0.4, texture: 1 },
  verse: { kick: 1, snare: 0.5, hat: 0.8, perc: 0.6, bass: 1, lead: 1, texture: 0.8 },
  build: { kick: 1, snare: 0.8, hat: 1, perc: 1, bass: 1, lead: 1, texture: 0.6 },
  chorus: { kick: 1, snare: 1, hat: 1, perc: 1, bass: 1, lead: 1, texture: 1 },
  // Everything stops except the weight — the oldest trick in the book, and it
  // still lands.
  drop: { kick: 1, snare: 0, hat: 0, perc: 0, bass: 1, lead: 0.6, texture: 0.4 },
  outro: { kick: 0.5, snare: 0.3, hat: 0.4, perc: 0.3, bass: 0.6, lead: 0.5, texture: 1 },
};

/**
 * The form, by total length.
 *
 * Short loops get a simple statement-and-answer; longer ones earn a real
 * chorus. A 4-bar loop with an "intro" that eats a quarter of it would waste
 * the only bars there are, so short forms skip straight to the music.
 */
export function buildForm(totalBars: number, style: Style): Section[] {
  if (totalBars <= 2) {
    return [{ kind: 'verse', startBar: 0, bars: totalBars }];
  }

  if (totalBars <= 4) {
    // Three bars of groove and a lift at the end, so even the shortest loop
    // has somewhere to go.
    return [
      { kind: 'verse', startBar: 0, bars: totalBars - 1 },
      { kind: 'chorus', startBar: totalBars - 1, bars: 1 },
    ];
  }

  if (totalBars <= 8) {
    const verse = Math.ceil((totalBars - 1) / 2);
    return [
      { kind: 'verse', startBar: 0, bars: verse },
      { kind: 'build', startBar: verse, bars: 1 },
      { kind: 'chorus', startBar: verse + 1, bars: totalBars - verse - 1 },
    ];
  }

  // Full form. EDM gets a drop where other styles get a straight chorus,
  // because that silence-then-weight is the point of the genre.
  const quarter = Math.floor(totalBars / 4);
  const sections: Section[] = [
    { kind: 'intro', startBar: 0, bars: quarter },
    { kind: 'verse', startBar: quarter, bars: quarter },
    { kind: 'build', startBar: quarter * 2, bars: Math.max(1, quarter - 1) },
  ];

  if (style === 'edm') {
    sections.push({ kind: 'drop', startBar: quarter * 3 - 1, bars: 1 });
  }

  const usedBars = sections.reduce((a, s) => a + s.bars, 0);
  sections.push({ kind: 'chorus', startBar: usedBars, bars: totalBars - usedBars });

  return sections.filter((s) => s.bars > 0);
}

/** The section covering a given bar. */
export function sectionAt(form: Section[], bar: number): Section {
  for (const s of form) {
    if (bar >= s.startBar && bar < s.startBar + s.bars) return s;
  }
  return form[form.length - 1];
}

/**
 * Thins a bar's beats to a density.
 *
 * Keeps the strongest beats and drops the weakest, so a thinned part still
 * lands where the ear expects it. Downbeats survive first, then the backbeat,
 * then everything else — dropping beat 1 to keep an offbeat would make the bar
 * unreadable.
 */
export function thinBeats(beats: number[], density: number): number[] {
  // Sorted even when nothing is dropped: the scheduler walks events in order,
  // and an arranger that hands back an unsorted pattern would put a beat 4
  // before a beat 1 within the same bar.
  if (density >= 1) return [...beats].sort((a, b) => a - b);
  if (density <= 0) return [];

  const strength = (beat: number): number => {
    if (beat === 1) return 3;
    if (beat === 3) return 2;
    if (Number.isInteger(beat)) return 1;
    return 0;
  };

  const ranked = [...beats].sort((a, b) => strength(b) - strength(a) || a - b);
  const keep = Math.max(1, Math.round(beats.length * density));
  return ranked.slice(0, keep).sort((a, b) => a - b);
}

/**
 * Velocity for a beat, before section scaling.
 *
 * The downbeat is loudest, the backbeat next, offbeats lightest. A flat
 * velocity across a bar is the single clearest giveaway that something was
 * sequenced rather than played.
 */
export function velocityFor(beat: number): number {
  if (beat === 1) return 1;
  if (beat === 3) return 0.85;
  if (Number.isInteger(beat)) return 0.78;
  return 0.6;
}

/** Loudness multiplier per section, so the arc is audible as well as textural. */
export const SECTION_GAIN: Record<SectionKind, number> = {
  intro: 0.7,
  verse: 0.85,
  build: 0.95,
  chorus: 1,
  drop: 1,
  outro: 0.75,
};

/**
 * A fill on the last bar of a section.
 *
 * Marks the turnaround so the next section arrives rather than merely
 * happening. The fill is built from the object's own sound, not a borrowed
 * drum, because every sound in this app is one the user recorded.
 */
function fillBeats(kind: SectionKind): number[] {
  // A build ends with a rush; everything else gets a simpler turnaround.
  return kind === 'build' ? [3, 3.5, 4, 4.5, 4.75] : [4, 4.5];
}

export interface RenderOptions {
  objects: WorldJamObject[];
  /** One bar of beats per object label, as the arranger produces. */
  objectPattern: Array<{ object: string; beats: number[] }>;
  totalBars: number;
  style: Style;
  /**
   * Lower-cased labels of objects the user programmed themselves. Their beat
   * plays in full in every section — the form thins only the producer's parts.
   */
  fixed?: ReadonlySet<string>;
}

/**
 * Renders a one-bar pattern across the whole form.
 *
 * This is what turns a loop into a song: each bar is filtered by its section's
 * density, scaled by its gain, and the last bar of a section gets a fill from
 * whichever object is carrying the backbeat.
 */
export function renderArrangement({
  objects,
  objectPattern,
  totalBars,
  style,
  fixed,
}: RenderOptions): LoopEvent[] {
  const form = buildForm(totalBars, style);
  const events: LoopEvent[] = [];

  // Matched case-insensitively. The schema validator normalises pattern names
  // to the object's own label, but an exact-case lookup that ever drifted
  // would fail by producing silence rather than an error.
  const byLabel = new Map(objects.map((o) => [o.label.toLowerCase(), o]));

  // Whichever object plays the backbeat carries the fills. Falling back to the
  // first object means a session of one cup still gets a turnaround.
  const fillObject =
    objects.find((o) => o.role === 'snare') ??
    objects.find((o) => o.role === 'perc') ??
    objects[0];

  for (let bar = 0; bar < totalBars; bar++) {
    const section = sectionAt(form, bar);
    const density = SECTION_DENSITY[section.kind];
    const gain = SECTION_GAIN[section.kind];
    const isLastBarOfSection = bar === section.startBar + section.bars - 1;

    for (const pattern of objectPattern) {
      const obj = byLabel.get(pattern.object.toLowerCase());
      if (!obj) continue;

      const beats = fixed?.has(pattern.object.toLowerCase())
        ? pattern.beats
        : thinBeats(pattern.beats, density[obj.role] ?? 1);

      for (const beat of beats) {
        events.push({
          objectId: obj.id,
          beat: bar * 4 + (beat - 1),
          velocity: clamp(velocityFor(beat) * gain),
        });
      }
    }

    // Fill on the last bar of a section, except the very last bar of the song,
    // where a turnaround would point at nothing.
    if (isLastBarOfSection && bar < totalBars - 1 && fillObject) {
      for (const beat of fillBeats(section.kind)) {
        events.push({
          objectId: fillObject.id,
          beat: bar * 4 + (beat - 1),
          // Deliberately below the next downbeat's accent: a fill that is
          // louder than the beat it leads into swallows the arrival.
          velocity: clamp(0.55 + (beat % 1) * 0.2),
        });
      }
    }
  }

  return events.sort((a, b) => a.beat - b.beat);
}

function clamp(v: number): number {
  return Math.max(0.05, Math.min(1, v));
}
