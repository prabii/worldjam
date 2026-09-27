import type { PerformanceEvent } from '../contracts/library';
import type { MusicPlan } from '../contracts/musicPlan';

// ---------------------------------------------------------------- Tiles

export const LANES = 3;
export const PERFECT_MS = 150;
export const GOOD_MS = 300;
export const EARLY_MS = 420;
export const LATE_MS = 320;
export const MAX_MISSES = 3;
/** Tiles never land closer than this in time — keeps charts playable with one thumb. */
const MIN_GAP_MS = 180;

export interface Tile {
  id: number;
  lane: number;
  timeMs: number;
}

export type Grade = 'PERFECT' | 'GOOD' | 'OK';

export const GRADE_POINTS: Record<Grade, number> = { PERFECT: 30, GOOD: 20, OK: 10 };

/** How a tap `deltaMs` away from its tile scores (negative = early); null = too far to count. */
export function gradeFor(deltaMs: number): Grade | null {
  const a = Math.abs(deltaMs);
  if (a <= PERFECT_MS) return 'PERFECT';
  if (a <= GOOD_MS) return 'GOOD';
  if (deltaMs >= -EARLY_MS && deltaMs <= LATE_MS) return 'OK';
  return null;
}

function thin(hits: Array<{ lane: number; timeMs: number }>, leadMs: number): Tile[] {
  const sorted = [...hits].sort((a, b) => a.timeMs - b.timeMs);
  const out: Tile[] = [];
  for (const h of sorted) {
    if (out.length && h.timeMs + leadMs - out[out.length - 1].timeMs < MIN_GAP_MS) continue;
    out.push({ id: out.length, lane: ((h.lane % LANES) + LANES) % LANES, timeMs: Math.round(h.timeMs + leadMs) });
  }
  return out;
}

/** The Studio take (your beat grid): each pad becomes a lane, in the order the pads first play. */
export function chartFromTake(events: PerformanceEvent[], leadMs = 2000): { tiles: Tile[]; lanePads: number[] } {
  const pads: number[] = [];
  for (const e of [...events].filter((x) => !x.stop).sort((a, b) => a.timeMs - b.timeMs)) if (!pads.includes(e.padIndex)) pads.push(e.padIndex);
  const lanePads = pads.slice(0, LANES);
  // Pads beyond the third share lanes round-robin.
  const hits = events.filter((e) => !e.stop).map((e) => ({ lane: pads.indexOf(e.padIndex) % LANES, timeMs: e.timeMs }));
  return { tiles: thin(hits, leadMs), lanePads };
}

/**
 * An arranged jam (AI beat or a saved track): the plan's patterned layers, in
 * song order, become lanes (up to three, rhythm first); accents always fall,
 * ornaments only in the livelier sections. Capped at `maxSec`.
 */
export function chartFromPlan(plan: MusicPlan, maxSec = 40, leadMs = 2000): { tiles: Tile[]; laneCaptures: string[]; bpm: number } {
  const order = ['kick', 'snare', 'percussion', 'hat', 'bass', 'chords', 'lead', 'pad', 'texture', 'fx', 'vocal'];
  const patterned = plan.layers
    .filter((l) => l.pattern && l.source.kind === 'capture')
    .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role))
    .slice(0, LANES);
  const laneCaptures = patterned.map((l) => (l.source.kind === 'capture' ? l.source.captureId : ''));
  const stepMs = 60000 / plan.tempoBpm / 4;
  const collect = (dense: boolean) => {
    const hits: Array<{ lane: number; timeMs: number }> = [];
    let bar0 = 0;
    for (const s of plan.sections) {
      for (let bar = 0; bar < s.bars; bar++) {
        const barStart = (bar0 + bar) * 16 * stepMs;
        if (barStart > maxSec * 1000) break;
        patterned.forEach((l, lane) => {
          // Sparse songs still give every lane something to play.
          if (!dense && !s.layers.includes(l.id)) return;
          const p = l.pattern ?? '';
          for (let step = 0; step < 16; step++) {
            const ch = p[step];
            if (ch === 'X' || (ch === 'x' && (dense || s.energy >= 0.8 || (s.energy >= 0.45 && step % 2 === 0)))) hits.push({ lane, timeMs: barStart + step * stepMs });
          }
        });
      }
      bar0 += s.bars;
    }
    return thin(hits.filter((h) => h.timeMs <= maxSec * 1000), leadMs);
  };
  let tiles = collect(false);
  const span = Math.min(maxSec, plan.durationSec);
  if (tiles.length < span * 0.9) tiles = collect(true);
  return { tiles, laneCaptures, bpm: plan.tempoBpm };
}

/** With no beat at all: a steady practice groove (kick / snare / hat) at `bpm`. */
export function defaultChart(bpm = 90, bars = 8, leadMs = 2000): Tile[] {
  const beat = 60000 / bpm;
  const hits: Array<{ lane: number; timeMs: number }> = [];
  for (let b = 0; b < bars * 4; b++) {
    const t = b * beat;
    if (b % 4 === 0 || b % 4 === 2) hits.push({ lane: 0, timeMs: t });
    if (b % 4 === 1 || b % 4 === 3) hits.push({ lane: 1, timeMs: t });
    if (b >= 8) hits.push({ lane: 2, timeMs: t + beat / 2 });
  }
  return thin(hits, leadMs);
}

export interface TilesState {
  score: number;
  combo: number;
  bestCombo: number;
  misses: number;
  hit: Set<number>;
  missed: Set<number>;
  over: boolean;
}

export const newTilesState = (): TilesState => ({ score: 0, combo: 0, bestCombo: 0, misses: 0, hit: new Set(), missed: new Set(), over: false });

/**
 * A tap anywhere in `lane` at `nowMs`: scores the closest open tile of that
 * lane inside the window. Every hit in a row raises the multiplier by one.
 */
export function tap(state: TilesState, tiles: Tile[], lane: number, nowMs: number): { grade: Grade | null; points: number; tile: Tile | null } {
  if (state.over) return { grade: null, points: 0, tile: null };
  let best: Tile | null = null;
  for (const t of tiles) {
    if (t.lane !== lane || state.hit.has(t.id) || state.missed.has(t.id)) continue;
    const d = nowMs - t.timeMs;
    if (d < -EARLY_MS || d > LATE_MS) continue;
    if (!best || Math.abs(d) < Math.abs(nowMs - best.timeMs)) best = t;
  }
  if (!best) return { grade: null, points: 0, tile: null };
  const grade = gradeFor(nowMs - best.timeMs)!;
  state.hit.add(best.id);
  state.combo += 1;
  state.bestCombo = Math.max(state.bestCombo, state.combo);
  const points = GRADE_POINTS[grade] * state.combo;
  state.score += points;
  return { grade, points, tile: best };
}

/** Tiles that slid past the late window: each is a miss (combo resets); three ends the game. */
export function sweepMisses(state: TilesState, tiles: Tile[], nowMs: number): Tile[] {
  const fresh: Tile[] = [];
  for (const t of tiles) {
    if (state.hit.has(t.id) || state.missed.has(t.id) || nowMs - t.timeMs <= LATE_MS) continue;
    state.missed.add(t.id);
    state.misses += 1;
    state.combo = 0;
    fresh.push(t);
  }
  if (state.misses >= MAX_MISSES) state.over = true;
  return fresh;
}

export function chartDone(state: TilesState, tiles: Tile[]): boolean {
  return state.over || tiles.every((t) => state.hit.has(t.id) || state.missed.has(t.id));
}

// ---------------------------------------------------------------- Echo

/** Grows a pattern by one pad; a pad never sounds three times in a row. */
export function growPattern(pattern: number[], pads: number, rand: () => number = Math.random): number[] {
  let next = Math.floor(rand() * pads);
  const n = pattern.length;
  if (n >= 2 && pattern[n - 1] === next && pattern[n - 2] === next) next = (next + 1 + Math.floor(rand() * (pads - 1))) % pads;
  return [...pattern, next];
}

/** Checks the player's taps so far against the pattern. */
export function echoCheck(pattern: number[], taps: number[]): 'wrong' | 'more' | 'done' {
  for (let i = 0; i < taps.length; i++) if (taps[i] !== pattern[i]) return 'wrong';
  return taps.length === pattern.length ? 'done' : 'more';
}

// ---------------------------------------------------------------- leaderboard

export interface ScoreEntry {
  name: string;
  score: number;
  bestCombo: number;
  misses: number;
  source: string;
  at: number;
}

export function addScore(board: ScoreEntry[], entry: ScoreEntry, keep = 20): ScoreEntry[] {
  return [...board, entry].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, keep);
}
