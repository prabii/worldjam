import type { LoopEvent } from '@/types';

/**
 * Auto-quantize — feature A1, which HLD v2 §5 calls both the technical-depth
 * proof and the reason a non-musician's take sounds produced.
 *
 * The trick is that naive snapping sounds robotic and, worse, it silently
 * moves a hit across a beat boundary when the player is dragging. So we snap
 * with a strength control and a guard rail.
 */

export type Grid = 1 | 2 | 4 | 8 | 16;

export interface QuantizeOptions {
  /** Grid subdivision: 4 = sixteenths in 4/4, 2 = eighths, 1 = quarters. */
  grid: Grid;
  /** 0 = leave untouched, 1 = snap hard to the grid. */
  strength: number;
  /**
   * Hits further than this fraction of a grid step from any line are treated
   * as intentional (a flam, a swung note) and left alone.
   */
  tolerance: number;
  /** Positive values delay off-beats for a swing feel. */
  swing: number;
}

export const DEFAULT_QUANTIZE: QuantizeOptions = {
  grid: 4,
  strength: 0.85,
  tolerance: 0.5,
  swing: 0,
};

/**
 * Snaps a single beat position to the grid.
 * @param beat fractional beats from the loop start
 */
export function quantizeBeat(beat: number, opts: QuantizeOptions): number {
  const step = 1 / opts.grid;
  const nearest = Math.round(beat / step) * step;
  const distance = Math.abs(beat - nearest);

  // Far from every line: the player probably meant it. Leave it.
  if (distance > step * opts.tolerance) return beat;

  let target = nearest;

  // Swing delays every second subdivision, the standard shuffle feel.
  if (opts.swing > 0) {
    const index = Math.round(beat / step);
    if (index % 2 === 1) target += step * opts.swing * 0.33;
  }

  // Interpolating rather than replacing preserves a little human push/pull.
  return beat + (target - beat) * opts.strength;
}

/** Quantizes a whole loop, keeping events ordered. */
export function quantizeLoop(
  events: LoopEvent[],
  opts: QuantizeOptions = DEFAULT_QUANTIZE,
): LoopEvent[] {
  return events
    .map((e) => ({ ...e, beat: quantizeBeat(e.beat, opts) }))
    .sort((a, b) => a.beat - b.beat);
}

/**
 * Measures how far a performance sits off the grid, 0..1 where 1 is perfect.
 * The UI shows this before and after so the quantize win is *visible*, not
 * just audible — a judge can watch "62% → 97%" on screen.
 */
export function timingAccuracy(events: LoopEvent[], grid: Grid): number {
  if (events.length === 0) return 1;
  const step = 1 / grid;
  let totalError = 0;
  for (const e of events) {
    const nearest = Math.round(e.beat / step) * step;
    // Normalised against the worst possible error (half a step).
    totalError += Math.min(1, Math.abs(e.beat - nearest) / (step / 2));
  }
  return Math.max(0, 1 - totalError / events.length);
}

/**
 * Wraps events into a fixed loop length, so a hit recorded just past the end
 * of the last bar folds back to the top instead of being lost.
 */
export function wrapToLoop(events: LoopEvent[], beatsPerLoop: number): LoopEvent[] {
  if (beatsPerLoop <= 0) return events;
  return events
    .map((e) => {
      let beat = e.beat % beatsPerLoop;
      if (beat < 0) beat += beatsPerLoop;
      // A hit a hair before the loop point belongs on the downbeat, not at
      // the very end where it would sound like a late stumble.
      if (beatsPerLoop - beat < 0.08) beat = 0;
      return { ...e, beat };
    })
    .sort((a, b) => a.beat - b.beat);
}

/** Converts a beat position to an absolute engine frame for scheduling. */
export function beatToFrame(
  beat: number,
  bpm: number,
  sampleRate: number,
  originFrame: number,
): number {
  const framesPerBeat = (60 / bpm) * sampleRate;
  return Math.round(originFrame + beat * framesPerBeat);
}

export function frameToBeat(
  frame: number,
  bpm: number,
  sampleRate: number,
  originFrame: number,
): number {
  const framesPerBeat = (60 / bpm) * sampleRate;
  return (frame - originFrame) / framesPerBeat;
}
