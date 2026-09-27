import type { Section } from './arrangement';
import { songBars } from './song';

/**
 * Assembling the song's generated bed.
 *
 * Stable Audio makes at most ~11 s at a time and takes about 26 s to do it, so
 * a two-minute song cannot be one generation. It is instead one clip per
 * section KIND — four or five of them — laid end to end into a single buffer
 * that covers the whole song and plays from one slot.
 *
 * Per kind rather than per section because a form states most of its kinds
 * more than once: generating per section would mean seven waits instead of
 * four for the same audio. Two verses sounding identical is not a compromise
 * either — that is what a verse is.
 *
 * Pure: the buffers come from the caller, so the layout maths is testable
 * without a generator or a device.
 */

/** Crossfade between neighbouring sections, in seconds. */
const SEAM_FADE_S = 0.12;

export interface BedClip {
  /** Mono PCM at the engine's sample rate. */
  pcm: Float32Array | number[];
}

export interface BedLayout {
  /** Where each section begins in the assembled buffer, in frames. */
  offsets: number[];
  /** Total length of the assembled buffer, in frames. */
  totalFrames: number;
  /** Length of one bar, in frames. */
  framesPerBar: number;
}

/** Frames per bar at a tempo, for 4/4. */
export function framesPerBar(bpm: number, sampleRate: number): number {
  return Math.round((240 / Math.max(1, bpm)) * sampleRate);
}

/**
 * Where every section starts and how long the whole thing runs.
 *
 * Positions come from the form's bar numbers rather than from accumulated
 * clip lengths, so a clip that is short or long does not shift everything
 * after it out of time with the beat.
 */
export function bedLayout(
  form: Section[],
  bpm: number,
  sampleRate: number,
): BedLayout {
  const fpb = framesPerBar(bpm, sampleRate);
  return {
    offsets: form.map((s) => s.startBar * fpb),
    totalFrames: songBars(form) * fpb,
    framesPerBar: fpb,
  };
}

/**
 * Lays the section clips into one buffer covering the song.
 *
 * A clip shorter than its section is looped to fill it, which is what makes an
 * eight-bar chorus possible from an eleven-second generation. A clip longer
 * than its section is simply cut off at the boundary — the next section starts
 * on its bar whatever happens, because drifting off the grid is far more
 * audible than a truncated tail.
 *
 * Section joins are crossfaded. Butting two unrelated generations together
 * produces a click exactly on the downbeat, which is the worst place for one.
 */
export function assembleBed(
  form: Section[],
  clipFor: (index: number) => BedClip | null,
  bpm: number,
  sampleRate: number,
): Float32Array {
  const layout = bedLayout(form, bpm, sampleRate);
  const out = new Float32Array(layout.totalFrames);
  const fade = Math.max(1, Math.round(SEAM_FADE_S * sampleRate));

  form.forEach((section, i) => {
    const clip = clipFor(i);
    if (!clip || clip.pcm.length === 0) return;

    const start = layout.offsets[i];
    const length = Math.min(
      section.bars * layout.framesPerBar,
      layout.totalFrames - start,
    );
    if (length <= 0) return;

    const src = clip.pcm;

    for (let f = 0; f < length; f++) {
      // Loop the clip to fill the section.
      let v = src[f % src.length];

      // Fade in at the join, and out at the end of the section, so the seam
      // is a crossfade rather than a step.
      if (f < fade) v *= f / fade;
      const remaining = length - 1 - f;
      if (remaining < fade) v *= remaining / fade;

      out[start + f] += v;
    }
  });

  return out;
}

/**
 * Index of the clip a section should use.
 *
 * Sections of the same kind share one generation, so this maps a section to
 * the first section of its kind — which is the one that was generated.
 */
export function clipIndexFor(form: Section[], sectionIndex: number): number {
  const kind = form[sectionIndex].kind;
  return form.findIndex((s) => s.kind === kind);
}

/**
 * One trigger at the top of the song.
 *
 * The bed already spans the whole form, so unlike the looping texture it is
 * fired once and left to play. Re-firing it would stack a second copy over
 * the first.
 */
export function bedEvents(): Array<{ objectId: string; beat: number; velocity: number }> {
  return [{ objectId: 'texture', beat: 0, velocity: 1 }];
}
