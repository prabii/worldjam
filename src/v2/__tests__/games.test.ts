import type { FeatureVector } from '../contracts/library';
import { fallbackPlan, type PlannerCapture } from '../ai/fallback';
import { interpretPrompt } from '../ai/interpret';
import {
  addScore, chartDone, chartFromPlan, chartFromTake, defaultChart, echoCheck, gradeFor, growPattern, newTilesState, sweepMisses, tap, type Tile,
} from '../games/logic';

const feat = (o: Partial<FeatureVector>): FeatureVector => ({
  durationSec: 0.6, rms: 0.2, peak: 0.9, brightness: 2000, decay: 0.2, tonality: 0.2, pitchHz: null,
  transient: 0.8, sustained: 0.1, onsetCount: 1, tempoBpm: null, suggestedRole: 'percussion', ...o,
});
const caps: PlannerCapture[] = [
  { id: 'c1', name: 'Table thump', description: 'wooden desk hit', type: 'AUDIO', features: feat({ brightness: 600 }), detectedLabel: null },
  { id: 'c2', name: 'Glass tap', description: 'bright spoon on glass', type: 'AUDIO', features: feat({ brightness: 5000 }), detectedLabel: null },
  { id: 'c3', name: 'Keys', description: 'keys shaking', type: 'AUDIO', features: feat({ brightness: 8000 }), detectedLabel: null },
];

describe('Tiles grading', () => {
  it('grades by timing: 150 ms perfect, 300 good, 420 early / 320 late ok', () => {
    expect(gradeFor(0)).toBe('PERFECT');
    expect(gradeFor(-150)).toBe('PERFECT');
    expect(gradeFor(290)).toBe('GOOD');
    expect(gradeFor(-400)).toBe('OK');
    expect(gradeFor(310)).toBe('OK');
    expect(gradeFor(330)).toBeNull();
    expect(gradeFor(-430)).toBeNull();
  });

  it('multiplies by the combo, resets on a miss and ends after three misses', () => {
    const tiles: Tile[] = [0, 1, 2, 3, 4, 5].map((i) => ({ id: i, lane: i % 3, timeMs: 1000 + i * 500 }));
    const s = newTilesState();
    expect(tap(s, tiles, 0, 1000).points).toBe(30); // combo 1
    expect(tap(s, tiles, 1, 1520).points).toBe(60); // PERFECT x2
    expect(tap(s, tiles, 2, 2250).points).toBe(60); // GOOD (250 ms) x3
    expect(s.bestCombo).toBe(3);
    expect(tap(s, tiles, 2, 5000).tile).toBeNull(); // nothing near: plays, scores nothing
    sweepMisses(s, tiles, 3600); // tiles 3 (2500) and 4 (3000) slipped past the 320 ms window
    expect(s.misses).toBe(2);
    expect(s.combo).toBe(0);
    expect(s.over).toBe(false);
    sweepMisses(s, tiles, 3600);
    expect(s.misses).toBe(2); // counted once
    sweepMisses(s, tiles, 4000); // tile 5 (3500)
    expect(s.misses).toBe(3);
    expect(s.over).toBe(true);
    expect(chartDone(s, tiles)).toBe(true);
    expect(s.score).toBe(150);
  });

  it('builds playable charts from a take, a plan and the default groove', () => {
    const take = chartFromTake([0, 250, 500, 750, 900, 1000].map((t, i) => ({ padIndex: [5, 9, 5, 12, 20, 9][i], timeMs: t, velocity: 1 })));
    expect(take.lanePads).toEqual([5, 9, 12]);
    expect(take.tiles.every((t) => t.lane >= 0 && t.lane < 3)).toBe(true);
    const gaps = take.tiles.slice(1).map((t, i) => t.timeMs - take.tiles[i].timeMs);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(180);

    const plan = fallbackPlan({ captures: caps, intent: interpretPrompt('', []), style: 'hiphop', durationSec: 30 });
    const fromPlan = chartFromPlan(plan, 20);
    expect(fromPlan.tiles.length).toBeGreaterThan(12);
    expect(fromPlan.laneCaptures.length).toBeGreaterThan(0);
    expect(fromPlan.tiles[fromPlan.tiles.length - 1].timeMs).toBeLessThanOrEqual(22000);

    const def = defaultChart(90, 8);
    expect(def.length).toBeGreaterThan(20);
    expect(new Set(def.map((t) => t.lane))).toEqual(new Set([0, 1, 2]));
  });
});

describe('Echo', () => {
  it('grows by one and never repeats a pad three times in a row', () => {
    let p: number[] = [];
    const always0 = () => 0;
    for (let i = 0; i < 30; i++) p = growPattern(p, 4, always0);
    expect(p).toHaveLength(30);
    for (let i = 2; i < p.length; i++) expect(p[i] === p[i - 1] && p[i] === p[i - 2]).toBe(false);
    for (let i = 0; i < 200; i++) p = growPattern(p, 2);
    for (let i = 2; i < p.length; i++) expect(p[i] === p[i - 1] && p[i] === p[i - 2]).toBe(false);
  });

  it('checks taps in order', () => {
    expect(echoCheck([1, 2, 3], [1])).toBe('more');
    expect(echoCheck([1, 2, 3], [1, 2, 3])).toBe('done');
    expect(echoCheck([1, 2, 3], [1, 3])).toBe('wrong');
  });
});

describe('leaderboard', () => {
  it('keeps the best scores first', () => {
    let b = addScore([], { name: 'A', score: 100, bestCombo: 3, misses: 1, source: 'x', at: 1 });
    b = addScore(b, { name: 'B', score: 300, bestCombo: 9, misses: 0, source: 'x', at: 2 });
    b = addScore(b, { name: 'C', score: 200, bestCombo: 5, misses: 2, source: 'x', at: 3 }, 2);
    expect(b.map((e) => e.name)).toEqual(['B', 'C']);
  });
});
