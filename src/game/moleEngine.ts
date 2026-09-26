/**
 * The whack-a-mole game, as pure functions.
 *
 * Nothing here touches React, the camera or the audio engine, so the timing
 * and scoring rules can be tested without a device — the same split that
 * keeps `src/vision/footTracker.ts` testable.
 *
 * Positions are never stored. A mole knows only the moment it is due, and
 * everything visible is derived from the clock on demand. A dropped frame
 * therefore cannot drift the visuals away from the hit test, which is the
 * bug that made the first version of the rhythm game unplayable.
 */

/** Targets are laid out on a 3x3 grid, numbered left-to-right, top-to-bottom. */
export const CELL_COUNT = 9;
export const GRID_COLS = 3;
export const GRID_ROWS = 3;

/**
 * Timing windows, in milliseconds either side of the beat.
 *
 * Copied from the lane game rather than imported: these are tuned for a
 * whole arm swinging at a target in the air, and the two games should be
 * free to drift apart without one silently retuning the other.
 */
export const EARLY_MS = 420;
export const LATE_MS = 320;
export const PERFECT_MS = 150;
export const GOOD_MS = 300;

export type Judgement = 'PERFECT' | 'GOOD' | 'OK';

export interface Mole {
  id: number;
  /** 0..8, left-to-right then top-to-bottom. */
  cell: number;
  /** Which captured sound this mole plays when hit. */
  objectId: string;
  label: string;
  /** Clock reading at which this mole is exactly on the beat. */
  dueAt: number;
  hit: boolean;
  /**
   * Set once the mole can no longer be scored, whether it was hit or missed.
   * Distinct from `hit` so a miss is never mistaken for a strike.
   */
  resolved: boolean;
  judgement: Judgement | null;
}

/** One entry of a beat pattern, as the lane game already builds them. */
export interface BeatHit {
  objectId: string;
  label: string;
  /** Beat position within the loop, 0-indexed. */
  beatTime: number;
}

/**
 * Chooses a cell for each hit.
 *
 * Two rules, both about playability rather than fairness. A given sound
 * always lands in the same column, so the player can learn "the mug is on
 * the left" — but successive moles never repeat a cell, because two hits in
 * the same place cannot be told apart at speed and read as one missed hit.
 */
export function assignCells(hits: BeatHit[], objectOrder: string[]): number[] {
  const out: number[] = [];
  let previous = -1;

  hits.forEach((hit, i) => {
    const objIndex = objectOrder.indexOf(hit.objectId);
    const column = (objIndex >= 0 ? objIndex : i) % GRID_COLS;

    // Walk the rows of this object's column until a cell that is not the
    // previous one is found.
    let cell = column;
    for (let row = 0; row < GRID_ROWS; row++) {
      const candidate = ((i + row) % GRID_ROWS) * GRID_COLS + column;
      if (candidate !== previous) {
        cell = candidate;
        break;
      }
    }

    previous = cell;
    out.push(cell);
  });

  return out;
}

/**
 * Expands a beat pattern into moles across several repeats of the loop.
 *
 * `startAt` is the clock reading at which beat zero of the first repeat is
 * due, so the caller can schedule the whole round in advance and let the
 * render loop simply ask what is visible.
 */
export function spawnPlan(
  hits: BeatHit[],
  bpm: number,
  loopBeats: number,
  repeats: number,
  startAt: number,
  objectOrder: string[] = [],
): Mole[] {
  if (hits.length === 0 || repeats <= 0) return [];

  const beatMs = 60000 / bpm;
  const loopMs = loopBeats * beatMs;
  const cells = assignCells(hits, objectOrder);
  const moles: Mole[] = [];
  let id = 0;

  for (let rep = 0; rep < repeats; rep++) {
    hits.forEach((hit, i) => {
      moles.push({
        id: id++,
        cell: cells[i],
        objectId: hit.objectId,
        label: hit.label,
        dueAt: startAt + rep * loopMs + hit.beatTime * beatMs,
        hit: false,
        resolved: false,
        judgement: null,
      });
    });
  }

  return moles.sort((a, b) => a.dueAt - b.dueAt);
}

/**
 * The moles a player can currently see and hit.
 *
 * A mole surfaces one early-window before it is due and disappears one
 * late-window after, which is exactly the span in which `whack` will accept
 * it. Drawing and hitting therefore agree by construction.
 */
export function activeMoles(moles: Mole[], now: number): Mole[] {
  return moles.filter(
    (m) => !m.resolved && now >= m.dueAt - EARLY_MS && now <= m.dueAt + LATE_MS,
  );
}

/**
 * How far out of its hole a mole is, 0 at the edges of the window and 1 on
 * the beat. Gives the caller a rise-and-fall to animate without needing to
 * know the timing rules.
 */
export function moleRise(mole: Mole, now: number): number {
  const offset = now - mole.dueAt;
  if (offset < -EARLY_MS || offset > LATE_MS) return 0;
  const span = offset < 0 ? EARLY_MS : LATE_MS;
  return 1 - Math.abs(offset) / span;
}

export interface WhackResult {
  mole: Mole;
  judgement: Judgement;
  /** Points before the combo multiplier. */
  base: number;
  /** Points actually scored, combo applied. */
  points: number;
  /** Signed error in ms: negative early, positive late. */
  offsetMs: number;
}

function judge(absOffset: number): Judgement {
  if (absOffset < PERFECT_MS) return 'PERFECT';
  if (absOffset < GOOD_MS) return 'GOOD';
  return 'OK';
}

function pointsFor(j: Judgement): number {
  return j === 'PERFECT' ? 30 : j === 'GOOD' ? 20 : 10;
}

/**
 * Resolves a strike at one cell.
 *
 * Mutates the matched mole's `hit` flag, so a second strike in the same
 * window cannot score twice. Returns null when nothing was there — the
 * caller still plays a sound for the feel of it, but scores nothing.
 */
export function whack(
  moles: Mole[],
  cell: number,
  now: number,
  combo: number,
): WhackResult | null {
  let best: Mole | null = null;
  let bestAbs = Infinity;

  for (const m of moles) {
    if (m.resolved || m.cell !== cell) continue;
    const offset = now - m.dueAt;
    if (offset < -EARLY_MS || offset > LATE_MS) continue;
    const abs = Math.abs(offset);
    if (abs < bestAbs) {
      bestAbs = abs;
      best = m;
    }
  }

  if (!best) return null;

  const judgement = judge(bestAbs);
  const base = pointsFor(judgement);

  best.hit = true;
  best.resolved = true;
  best.judgement = judgement;

  return {
    mole: best,
    judgement,
    base,
    points: base * (combo + 1),
    offsetMs: now - best.dueAt,
  };
}

/**
 * Collects moles whose window has closed unhit.
 *
 * Mutates them so each is only ever counted once, and returns how many were
 * newly missed this call. The caller drives this from its frame loop.
 */
export function collectMisses(moles: Mole[], now: number): number {
  let missed = 0;
  for (const m of moles) {
    if (m.resolved) continue;
    if (now > m.dueAt + LATE_MS) {
      // Marked on the mole itself so a later frame cannot count it twice.
      m.resolved = true;
      missed++;
    }
  }
  return missed;
}

/** Whether every mole in the round has been resolved. */
export function roundComplete(moles: Mole[], now: number): boolean {
  return moles.every((m) => m.resolved || now > m.dueAt + LATE_MS);
}

/**
 * Turns a normalised camera position into a grid cell.
 *
 * The tracker reports where the hand is as a fraction of the frame; this is
 * the only place that mapping lives, so the camera and the grid cannot
 * disagree about which cell is which.
 */
export function cellAt(x: number, y: number): number {
  const col = Math.min(GRID_COLS - 1, Math.max(0, Math.floor(x * GRID_COLS)));
  const row = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor(y * GRID_ROWS)));
  return row * GRID_COLS + col;
}

/**
 * Edge-triggered strike detection for a 3x3 grid.
 *
 * The lane game's StampDetector answers the same question for three lanes;
 * this is its nine-cell sibling. A hand held over a cell must fire once, not
 * once per frame, so a strike is the rising edge of coverage — and the gap
 * between `enter` and `exit` is hysteresis, without which a hand hovering
 * near the threshold would machine-gun the cell.
 *
 * Moving to a different cell without withdrawing counts as a fresh strike,
 * because a player sweeping across targets expects each one to register.
 */
export class WhackDetector {
  private armed = true;
  private lastCell: number | null = null;
  private lastFiredAt = -Infinity;

  constructor(
    private readonly enter = 0.05,
    private readonly exit = 0.03,
    private readonly refractoryMs = 110,
  ) {}

  /**
   * Feeds one tracker reading. Returns the cell struck, or null.
   *
   * `now` is a parameter rather than read from the clock so the behaviour is
   * deterministic under test.
   */
  push(
    reading: { coverage: number; x: number | null; y: number | null },
    now: number,
  ): number | null {
    if (reading.x == null || reading.y == null || reading.coverage < this.exit) {
      this.armed = true;
      this.lastCell = null;
      return null;
    }

    if (reading.coverage < this.enter) return null;

    const cell = cellAt(reading.x, reading.y);

    if (!this.armed) {
      if (cell !== this.lastCell && now - this.lastFiredAt >= this.refractoryMs) {
        this.lastCell = cell;
        this.lastFiredAt = now;
        return cell;
      }
      return null;
    }

    if (now - this.lastFiredAt < this.refractoryMs) return null;

    this.armed = false;
    this.lastCell = cell;
    this.lastFiredAt = now;
    return cell;
  }

  reset(): void {
    this.armed = true;
    this.lastCell = null;
    this.lastFiredAt = -Infinity;
  }
}
