import type { ArrangementPlan, LoopEvent, WorldJamObject } from '@/types';

/**
 * The studio's step grid: one row per captured sound, one column per step of
 * a 4/4 bar. This is the user's own beat, programmed by tapping cells or
 * recorded by tapping sounds live — the raw material the AI producer then
 * builds a full track around.
 *
 * Pure functions only, so the grid <-> loop <-> plan conversions are tested
 * without an audio engine.
 */

export type GridSteps = 8 | 16;

export interface BeatGrid {
  steps: GridSteps;
  /** objectId -> one flag per step. Rows appear as sounds are captured. */
  cells: Record<string, boolean[]>;
}

export const EMPTY_GRID: BeatGrid = { steps: 8, cells: {} };

/** Beat length of one step. */
export function stepBeats(steps: GridSteps): number {
  return 4 / steps;
}

/** A row for every object, in capture order, sized to the grid. */
export function gridRows(grid: BeatGrid, objects: WorldJamObject[]): Array<{ object: WorldJamObject; row: boolean[] }> {
  return objects.map((object) => ({ object, row: rowOf(grid, object.id) }));
}

function rowOf(grid: BeatGrid, id: string): boolean[] {
  const row = grid.cells[id] ?? [];
  return Array.from({ length: grid.steps }, (_, i) => row[i] === true);
}

export function toggleStep(grid: BeatGrid, id: string, step: number): BeatGrid {
  if (step < 0 || step >= grid.steps) return grid;
  const row = rowOf(grid, id);
  row[step] = !row[step];
  return { ...grid, cells: { ...grid.cells, [id]: row } };
}

export function setStep(grid: BeatGrid, id: string, step: number, on: boolean): BeatGrid {
  if (step < 0 || step >= grid.steps) return grid;
  const row = rowOf(grid, id);
  if (row[step] === on) return grid;
  row[step] = on;
  return { ...grid, cells: { ...grid.cells, [id]: row } };
}

/**
 * Changes resolution while keeping every hit where it was in time. Going
 * 8 -> 16 spreads hits onto the even steps; 16 -> 8 folds each sixteenth
 * onto the eighth it belongs to, so nothing the user placed disappears.
 */
export function resizeGrid(grid: BeatGrid, steps: GridSteps): BeatGrid {
  if (steps === grid.steps) return grid;
  const cells: Record<string, boolean[]> = {};
  for (const [id, row] of Object.entries(grid.cells)) {
    const next = Array.from({ length: steps }, () => false);
    row.forEach((on, i) => {
      if (on) next[Math.floor((i * steps) / grid.steps)] = true;
    });
    cells[id] = next;
  }
  return { steps, cells };
}

export function removeRow(grid: BeatGrid, id: string): BeatGrid {
  if (!(id in grid.cells)) return grid;
  const { [id]: _gone, ...cells } = grid.cells;
  return { ...grid, cells };
}

export function gridHitCount(grid: BeatGrid): number {
  let n = 0;
  for (const row of Object.values(grid.cells)) for (const on of row) if (on) n++;
  return n;
}

/** Nearest step to a live tap, as a beat position anywhere in the loop. */
export function beatToStep(beat: number, steps: GridSteps): number {
  const inBar = ((beat % 4) + 4) % 4;
  return Math.round(inBar / stepBeats(steps)) % steps;
}

/**
 * Accent a drummer would play without thinking: downbeat strongest, the other
 * quarter notes next, eighth offbeats softer, sixteenths softest. A grid that
 * plays every cell at full level is what makes programmed beats sound robotic.
 */
export function stepVelocity(step: number, steps: GridSteps): number {
  const beat = step * stepBeats(steps);
  if (beat === 0) return 1;
  if (Number.isInteger(beat)) return beat === 2 ? 0.92 : 0.85;
  if (Number.isInteger(beat * 2)) return 0.72;
  return 0.6;
}

/** The user's beat, repeated across the loop, as scheduler events. */
export function gridToEvents(grid: BeatGrid, objects: WorldJamObject[], bars: number): LoopEvent[] {
  const events: LoopEvent[] = [];
  const unit = stepBeats(grid.steps);
  for (const { object, row } of gridRows(grid, objects)) {
    row.forEach((on, step) => {
      if (!on) return;
      for (let bar = 0; bar < bars; bar++) {
        events.push({
          objectId: object.id,
          beat: bar * 4 + step * unit,
          velocity: stepVelocity(step, grid.steps),
        });
      }
    });
  }
  return events.sort((a, b) => a.beat - b.beat);
}

/**
 * The beat in the arrangement plan's language: 1-indexed beats within one bar,
 * per object label. This is what Gemma is shown, and what the finished plan
 * must still contain.
 */
export function gridToPattern(
  grid: BeatGrid,
  objects: WorldJamObject[],
): ArrangementPlan['objectPattern'] {
  const unit = stepBeats(grid.steps);
  return gridRows(grid, objects)
    .map(({ object, row }) => ({
      object: object.label,
      beats: row.flatMap((on, step) => (on ? [1 + step * unit] : [])),
    }))
    .filter((p) => p.beats.length > 0);
}

/** The reverse, so an AI plan can be shown on the grid. */
export function patternToGrid(
  pattern: ArrangementPlan['objectPattern'],
  objects: WorldJamObject[],
  steps: GridSteps,
): BeatGrid {
  const byLabel = new Map(objects.map((o) => [o.label.toLowerCase(), o]));
  let grid: BeatGrid = { steps, cells: {} };
  for (const entry of pattern) {
    const obj = byLabel.get(entry.object.toLowerCase());
    if (!obj) continue;
    for (const b of entry.beats) {
      grid = setStep(grid, obj.id, beatToStep(b - 1, steps), true);
    }
  }
  return grid;
}

/**
 * Lays the user's beat into a producer's plan.
 *
 * Rows the user programmed are theirs and play exactly as written — a model
 * asked to "build around" a beat will otherwise quietly rewrite it. The
 * producer owns everything else: parts for the sounds the user left empty,
 * the accompaniment, the tempo, the form and the feel. Re-running this after
 * every grid edit is what lets the user keep changing their beat while the
 * AI's arrangement follows along instantly, without calling the model again.
 */
export function layerUserBeat(
  plan: ArrangementPlan,
  userPattern: ArrangementPlan['objectPattern'],
): ArrangementPlan {
  const owned = new Set(userPattern.map((u) => u.object.toLowerCase()));
  const producer = plan.objectPattern.filter((p) => !owned.has(p.object.toLowerCase()));
  return {
    ...plan,
    objectPattern: [...userPattern.map((u) => ({ object: u.object, beats: [...u.beats] })), ...producer],
  };
}

/** A one-line summary for the grid header and the toast. */
export function describeGrid(grid: BeatGrid, objects: WorldJamObject[]): string {
  const hits = gridHitCount(grid);
  const rows = gridRows(grid, objects).filter(({ row }) => row.some(Boolean)).length;
  if (hits === 0) return 'Tap cells to program your beat';
  return `${hits} hit${hits === 1 ? '' : 's'} · ${rows} sound${rows === 1 ? '' : 's'} · ${grid.steps} steps`;
}
