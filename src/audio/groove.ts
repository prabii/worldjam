import type { LoopEvent, Style, WorldJamObject } from '@/types';

/**
 * The music director's pass: tempo, feel and breathing room.
 *
 * The arrangement decides WHAT plays and WHEN on the grid. This decides HOW it
 * sits — the difference between a sequence and a performance. Three things a
 * producer does to every beat, applied here to the user's recordings:
 *
 *   1. Pick a tempo the genre actually lives at, and fold a model's odd choice
 *      (EDM at 64) into it rather than obeying it.
 *   2. Give the grid a feel: swing where the genre swings, and tiny, repeatable
 *      timing and velocity variation so nothing sounds like a metronome.
 *   3. Stop ringing objects from stepping on themselves. A bowl that rings for
 *      a second, retriggered every sixteenth, is mud — not rhythm.
 *
 * Everything is deterministic for the same session, so a rehearsed demo plays
 * back identically.
 */

export interface StyleFeel {
  /** Comfortable tempo range for the genre, BPM. */
  minBpm: number;
  maxBpm: number;
  /** Where to land when nothing better is known. */
  homeBpm: number;
  /**
   * Swing ratio: 0.5 is straight, 0.66 is full triplet swing. Applied to the
   * off-note of each pair at `swingUnit`.
   */
  swing: number;
  /** Beat length of one swung note: 0.5 = swung eighths, 0.25 = sixteenths. */
  swingUnit: 0.5 | 0.25;
  /** Maximum timing drift, in milliseconds, for humanisation. */
  humanizeMs: number;
  /** Maximum velocity drift, as a fraction. */
  humanizeVel: number;
}

export const STYLE_FEEL: Record<Style, StyleFeel> = {
  // Laid back, gently swung sixteenths.
  chill: { minBpm: 84, maxBpm: 100, homeBpm: 92, swing: 0.56, swingUnit: 0.25, humanizeMs: 9, humanizeVel: 0.07 },
  // Swung eighths, the loosest timing of all.
  jazz: { minBpm: 104, maxBpm: 136, homeBpm: 120, swing: 0.64, swingUnit: 0.5, humanizeMs: 12, humanizeVel: 0.1 },
  // Heavy "drunk" sixteenth swing is the whole sound of lo-fi.
  lofi: { minBpm: 70, maxBpm: 88, homeBpm: 80, swing: 0.6, swingUnit: 0.25, humanizeMs: 14, humanizeVel: 0.1 },
  // Straight, slow, weighty.
  cinematic: { minBpm: 62, maxBpm: 84, homeBpm: 70, swing: 0.5, swingUnit: 0.5, humanizeMs: 6, humanizeVel: 0.05 },
  // Dance music is quantised on purpose: tight grid, barely any drift.
  edm: { minBpm: 120, maxBpm: 130, homeBpm: 126, swing: 0.5, swingUnit: 0.25, humanizeMs: 2, humanizeVel: 0.03 },
  // Straight eighths with a drummer's push and pull.
  rock: { minBpm: 100, maxBpm: 128, homeBpm: 112, swing: 0.5, swingUnit: 0.5, humanizeMs: 7, humanizeVel: 0.07 },
};

/**
 * Chooses the tempo like a director would.
 *
 * A requested tempo (from the model, or the user's own playing) is respected
 * in spirit: it is folded by octaves into the genre's range first — 64 for EDM
 * becomes 128, because the model meant the half-time feel — and only then
 * clamped. With no request, the sounds themselves decide: a room full of long,
 * ringing objects wants air and sits low in the range, a handful of tight
 * clicks can drive at the top of it.
 */
export function directTempo(
  style: Style,
  objects: Pick<WorldJamObject, 'features'>[],
  requested?: number | null,
): number {
  const feel = STYLE_FEEL[style];

  if (requested != null && Number.isFinite(requested) && requested > 0) {
    let bpm = requested;
    // Fold by octaves toward the range before clamping, so the intent (half or
    // double time) survives instead of being flattened onto the edge.
    for (let i = 0; i < 4 && bpm < feel.minBpm; i++) bpm *= 2;
    for (let i = 0; i < 4 && bpm > feel.maxBpm; i++) bpm /= 2;
    return Math.round(clamp(bpm, feel.minBpm, feel.maxBpm));
  }

  const decays = objects
    .map((o) => o.features?.decay)
    .filter((d): d is number => typeof d === 'number' && Number.isFinite(d));
  if (decays.length === 0) return feel.homeBpm;

  const avgDecay = decays.reduce((a, b) => a + b, 0) / decays.length;
  // 0 at very tight (≤0.15s), 1 at long ring (≥1s).
  const ringiness = clamp((avgDecay - 0.15) / 0.85, 0, 1);
  const span = feel.maxBpm - feel.minBpm;
  // Tight sounds sit a little above home, ringing ones slide toward the floor.
  const bpm = feel.homeBpm + span * (0.15 - ringiness * 0.55);
  return Math.round(clamp(bpm, feel.minBpm, feel.maxBpm));
}

/**
 * A stable pseudo-random value in [-1, 1] for a given event.
 *
 * Deterministic on purpose: humanisation that changes on every play sounds
 * like a glitch, and a demo must rehearse identically.
 */
export function jitter(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Map the 32-bit hash to [-1, 1].
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/**
 * Moves swung off-notes late.
 *
 * Within each pair of `unit`-length notes, the second one is pushed from the
 * halfway point to `ratio` of the pair. On-beat notes never move — that is what
 * keeps a swung groove anchored.
 */
export function swingBeat(beat: number, ratio: number, unit: 0.5 | 0.25): number {
  if (ratio <= 0.5) return beat;
  const pair = unit * 2;
  const within = ((beat % pair) + pair) % pair;
  // Only the exact off-note of the pair swings.
  if (Math.abs(within - unit) > 1e-6) return beat;
  return beat + (ratio - 0.5) * pair;
}

export interface GrooveOptions {
  style: Style;
  bpm: number;
  objects: WorldJamObject[];
  /** Loop length in beats, so nothing is nudged past the end or before 0. */
  totalBeats: number;
  /**
   * Objects whose hits the user placed by hand. They still get swing and
   * humanisation, but are never dropped for ringing: every cell they lit plays.
   */
  fixedIds?: ReadonlySet<string>;
}

/**
 * Applies the director's feel to a rendered arrangement.
 *
 * Order matters: spacing is decided on the grid (before any drift, so two
 * events a sixteenth apart are judged as a sixteenth apart), then swing, then
 * humanisation on top.
 */
export function applyGroove(events: LoopEvent[], opts: GrooveOptions): LoopEvent[] {
  const feel = STYLE_FEEL[opts.style];
  const beatsPerMs = opts.bpm / 60000;
  const byId = new Map(opts.objects.map((o) => [o.id, o]));

  const spaced = spaceRingingObjects(events, byId, opts.bpm, opts.fixedIds);

  const out = spaced.map((e) => {
    const obj = byId.get(e.objectId);
    // Accompaniment layers and the vocal are rendered audio, already in time.
    if (!obj) return e;

    let beat = swingBeat(e.beat, feel.swing, feel.swingUnit);

    // Downbeats stay tighter than everything else: the pulse has to be
    // unmistakable for the drift around it to read as feel, not sloppiness.
    const onDownbeat = Math.abs(e.beat - Math.round(e.beat)) < 1e-6 && Math.round(e.beat) % 4 === 0;
    const timeAmount = onDownbeat ? 0.35 : 1;
    const seed = `${e.objectId}:${e.beat.toFixed(4)}`;
    beat += jitter(`t${seed}`) * feel.humanizeMs * beatsPerMs * timeAmount;

    const velocity = clamp(e.velocity * (1 + jitter(`v${seed}`) * feel.humanizeVel), 0.05, 1);

    // Never pushed out of the loop — an event at -0.001 would be skipped.
    beat = clamp(beat, 0, Math.max(0, opts.totalBeats - 0.001));
    return { ...e, beat, velocity };
  });

  return out.sort((a, b) => a.beat - b.beat);
}

/**
 * Stops a long-ringing object from retriggering on top of its own tail.
 *
 * Each object gets a minimum gap between hits proportional to how long it
 * rings — capped at one beat, so even a gong can still play quarter notes.
 * Short, dry sounds (a click, a tap) are left alone: they can play every
 * sixteenth and it sounds like a shaker, which is exactly right.
 */
export function spaceRingingObjects(
  events: LoopEvent[],
  byId: Map<string, WorldJamObject>,
  bpm: number,
  fixedIds?: ReadonlySet<string>,
): LoopEvent[] {
  const lastBeat = new Map<string, number>();
  const kept: LoopEvent[] = [];

  for (const e of [...events].sort((a, b) => a.beat - b.beat)) {
    const obj = byId.get(e.objectId);
    const decay = obj?.features?.decay;
    if (!obj || decay == null || decay < 0.35 || fixedIds?.has(e.objectId)) {
      kept.push(e);
      continue;
    }

    const minGapBeats = Math.min(1, decay * 0.6 * (bpm / 60));
    const prev = lastBeat.get(e.objectId);
    if (prev != null && e.beat - prev < minGapBeats - 1e-6) continue;

    lastBeat.set(e.objectId, e.beat);
    kept.push(e);
  }
  return kept;
}

/** A one-line description of the feel, for the studio's director chip. */
export function describeFeel(style: Style, bpm: number, bars: number): string {
  const feel = STYLE_FEEL[style];
  const groove =
    feel.swing <= 0.5
      ? feel.humanizeMs <= 3
        ? 'locked grid'
        : 'straight'
      : `swung ${feel.swingUnit === 0.5 ? 'eighths' : 'sixteenths'}`;
  return `${bpm} BPM · ${groove} · ${bars} bars`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
