import {
  EMPTY_GRID,
  beatToStep,
  describeGrid,
  gridHitCount,
  gridRows,
  gridToEvents,
  gridToPattern,
  layerUserBeat,
  patternToGrid,
  removeRow,
  resizeGrid,
  setStep,
  stepVelocity,
  toggleStep,
  type BeatGrid,
} from '@/audio/beatGrid';
import { applyGroove } from '@/audio/groove';
import { renderArrangement } from '@/audio/arrangement';
import type { ArrangementPlan, WorldJamObject } from '@/types';

function obj(id: string, label = id, decay = 0.2): WorldJamObject {
  return {
    id,
    label,
    category: 'unknown',
    slot: 0,
    position: { x: 0.5, y: 0.5 },
    features: { duration: 1, energy: 0.3, brightness: 1500, decay, pitch: null, tonality: 0.2 },
    role: 'perc',
    beatPattern: [],
    volume: 1,
    pan: 0.5,
    color: '#fff',
    createdAt: 0,
  };
}

const MUG = obj('m', 'Mug');
const TABLE = obj('t', 'Table');

function beat(cells: Record<string, number[]>, steps: 8 | 16 = 8): BeatGrid {
  let g: BeatGrid = { steps, cells: {} };
  for (const [id, on] of Object.entries(cells)) for (const i of on) g = setStep(g, id, i, true);
  return g;
}

describe('grid editing', () => {
  it('grows a row for every captured sound', () => {
    expect(gridRows(EMPTY_GRID, [MUG])).toHaveLength(1);
    expect(gridRows(EMPTY_GRID, [MUG, TABLE])).toHaveLength(2);
    expect(gridRows(EMPTY_GRID, [MUG])[0].row).toHaveLength(8);
  });

  it('toggles a step on and off without touching the original', () => {
    const on = toggleStep(EMPTY_GRID, 'm', 3);
    expect(on.cells.m[3]).toBe(true);
    expect(EMPTY_GRID.cells.m).toBeUndefined();
    expect(toggleStep(on, 'm', 3).cells.m[3]).toBe(false);
  });

  it('ignores steps outside the bar', () => {
    expect(toggleStep(EMPTY_GRID, 'm', 8)).toBe(EMPTY_GRID);
    expect(toggleStep(EMPTY_GRID, 'm', -1)).toBe(EMPTY_GRID);
  });

  it('counts hits and forgets removed sounds', () => {
    const g = beat({ m: [0, 4], t: [2] });
    expect(gridHitCount(g)).toBe(3);
    expect(gridHitCount(removeRow(g, 'm'))).toBe(1);
  });
});

describe('resizeGrid', () => {
  it('keeps hits in time going 8 -> 16', () => {
    const g = resizeGrid(beat({ m: [0, 3] }), 16);
    expect(g.steps).toBe(16);
    expect(g.cells.m.flatMap((on, i) => (on ? [i] : []))).toEqual([0, 6]);
  });

  it('folds sixteenths onto their eighth going 16 -> 8, dropping nothing', () => {
    const g = resizeGrid(beat({ m: [1, 5] }, 16), 8);
    expect(g.cells.m.flatMap((on, i) => (on ? [i] : []))).toEqual([0, 2]);
  });
});

describe('beatToStep', () => {
  it('snaps a live tap to the nearest step in the bar', () => {
    expect(beatToStep(0.02, 8)).toBe(0);
    expect(beatToStep(0.48, 8)).toBe(1);
    expect(beatToStep(5.5, 8)).toBe(3); // bar 2, beat 2.5
    expect(beatToStep(3.9, 8)).toBe(0); // late on the last step wraps to the downbeat
    expect(beatToStep(0.26, 16)).toBe(1);
  });
});

describe('gridToEvents', () => {
  it('repeats the beat in every bar at the right positions', () => {
    const events = gridToEvents(beat({ m: [0, 4] }), [MUG], 2);
    expect(events.map((e) => e.beat)).toEqual([0, 2, 4, 6]);
  });

  it('accents like a drummer: downbeat loudest, offbeats softer', () => {
    expect(stepVelocity(0, 8)).toBe(1);
    expect(stepVelocity(2, 8)).toBeLessThan(1);
    expect(stepVelocity(1, 8)).toBeLessThan(stepVelocity(2, 8));
    expect(stepVelocity(1, 16)).toBeLessThan(stepVelocity(2, 16));
  });

  it('skips rows for sounds that were removed', () => {
    const g = beat({ gone: [0], m: [4] });
    expect(gridToEvents(g, [MUG], 1)).toEqual([{ objectId: 'm', beat: 2, velocity: stepVelocity(4, 8) }]);
  });
});

describe('grid <-> plan pattern', () => {
  it('speaks the planner language: labels and 1-indexed beats', () => {
    const p = gridToPattern(beat({ m: [0, 4], t: [2, 6] }), [MUG, TABLE]);
    expect(p).toEqual([
      { object: 'Mug', beats: [1, 3] },
      { object: 'Table', beats: [2, 4] },
    ]);
  });

  it('round-trips through patternToGrid', () => {
    const g = beat({ m: [0, 3, 5], t: [2] }, 16);
    const back = patternToGrid(gridToPattern(g, [MUG, TABLE]), [MUG, TABLE], 16);
    expect(back.cells.m).toEqual(g.cells.m);
    expect(back.cells.t).toEqual(g.cells.t);
  });

  it('leaves empty rows out of the pattern', () => {
    expect(gridToPattern(beat({ m: [0] }), [MUG, TABLE])).toHaveLength(1);
  });
});

describe('layerUserBeat', () => {
  const producer: ArrangementPlan = {
    bpm: 92,
    bars: 8,
    objectPattern: [
      { object: 'mug', beats: [1, 2, 3, 4] },
      { object: 'Table', beats: [2.5, 4.5] },
    ],
    voiceRole: 'none',
    accompaniment: ['bass'],
    style: 'chill',
    source: 'gemma',
  };

  it('plays the user rows exactly as programmed, overriding the model', () => {
    const out = layerUserBeat(producer, [{ object: 'Mug', beats: [1, 3] }]);
    expect(out.objectPattern.find((p) => p.object.toLowerCase() === 'mug')!.beats).toEqual([1, 3]);
    expect(out.objectPattern.filter((p) => p.object.toLowerCase() === 'mug')).toHaveLength(1);
  });

  it('keeps the producer parts for sounds the user left empty', () => {
    const out = layerUserBeat(producer, [{ object: 'Mug', beats: [1, 3] }]);
    expect(out.objectPattern.find((p) => p.object === 'Table')!.beats).toEqual([2.5, 4.5]);
    expect(out.accompaniment).toEqual(['bass']);
  });

  it('lets the user remove a hit the producer had', () => {
    const first = layerUserBeat(producer, [{ object: 'Mug', beats: [1, 3] }]);
    const edited = layerUserBeat(producer, [{ object: 'Mug', beats: [1] }]);
    expect(first.objectPattern[0].beats).toEqual([1, 3]);
    expect(edited.objectPattern[0].beats).toEqual([1]);
  });
});

describe('user rows survive the arrangement and groove passes', () => {
  it('are never thinned by the form or dropped for ringing', () => {
    const bowl = obj('b', 'Bowl', 1.5);
    const pattern = [{ object: 'Bowl', beats: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5] }];
    const fixed = new Set(['bowl']);
    const rendered = renderArrangement({
      objects: [bowl],
      objectPattern: pattern,
      totalBars: 8,
      style: 'chill',
      fixed,
    }).filter((e) => e.objectId === 'b');
    const grooved = applyGroove(rendered, {
      style: 'chill',
      bpm: 92,
      objects: [bowl],
      totalBeats: 32,
      fixedIds: new Set(['b']),
    }).filter((e) => e.objectId === 'b');

    // Eight hits in each of eight bars, plus any fills the arranger adds.
    expect(rendered.length).toBeGreaterThanOrEqual(64);
    expect(grooved.length).toBe(rendered.length);
  });
});

describe('describeGrid', () => {
  it('prompts when empty and summarises when not', () => {
    expect(describeGrid(EMPTY_GRID, [MUG])).toMatch(/tap cells/i);
    expect(describeGrid(beat({ m: [0, 4] }), [MUG])).toBe('2 hits · 1 sound · 8 steps');
  });
});
