import {
  CELL_COUNT,
  EARLY_MS,
  GRID_COLS,
  LATE_MS,
  WhackDetector,
  activeMoles,
  assignCells,
  cellAt,
  collectMisses,
  moleRise,
  roundComplete,
  spawnPlan,
  whack,
  type BeatHit,
  type Mole,
} from '@/game/moleEngine';

const hits = (...beats: number[]): BeatHit[] =>
  beats.map((b, i) => ({
    objectId: `obj-${i % 3}`,
    label: `Sound ${i % 3}`,
    beatTime: b,
  }));

/** One mole, due at a known moment, for hit-test cases. */
function moleAt(dueAt: number, cell = 0): Mole {
  return {
    id: 1,
    cell,
    objectId: 'obj-0',
    label: 'Mug',
    dueAt,
    hit: false,
    resolved: false,
    judgement: null,
  };
}

describe('cellAt', () => {
  it('maps the corners of the frame to the corner cells', () => {
    expect(cellAt(0, 0)).toBe(0);
    expect(cellAt(0.99, 0)).toBe(2);
    expect(cellAt(0, 0.99)).toBe(6);
    expect(cellAt(0.99, 0.99)).toBe(8);
  });

  it('maps the middle of the frame to the middle cell', () => {
    expect(cellAt(0.5, 0.5)).toBe(4);
  });

  it('clamps rather than returning an off-grid cell', () => {
    expect(cellAt(1, 1)).toBe(CELL_COUNT - 1);
    expect(cellAt(-0.5, -0.5)).toBe(0);
    expect(cellAt(2, 2)).toBe(CELL_COUNT - 1);
  });
});

describe('assignCells', () => {
  it('keeps one sound in one column, so it can be learned', () => {
    const order = ['obj-0', 'obj-1', 'obj-2'];
    const seq: BeatHit[] = [
      { objectId: 'obj-1', label: 'b', beatTime: 0 },
      { objectId: 'obj-1', label: 'b', beatTime: 2 },
      { objectId: 'obj-1', label: 'b', beatTime: 4 },
    ];
    const cells = assignCells(seq, order);
    for (const c of cells) expect(c % GRID_COLS).toBe(1);
  });

  it('never places two consecutive moles in the same cell', () => {
    const order = ['obj-0', 'obj-1', 'obj-2'];
    const cells = assignCells(hits(0, 1, 2, 3, 4, 5, 6, 7), order);
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i]).not.toBe(cells[i - 1]);
    }
  });

  it('still assigns a valid cell when the object is unknown', () => {
    const cells = assignCells(hits(0, 1, 2), []);
    for (const c of cells) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(CELL_COUNT);
    }
  });
});

describe('spawnPlan', () => {
  it('places the first mole at the start time', () => {
    const moles = spawnPlan(hits(0), 120, 4, 1, 5000);
    expect(moles[0].dueAt).toBe(5000);
  });

  it('spaces moles by the tempo', () => {
    // 120 BPM = 500ms per beat.
    const moles = spawnPlan(hits(0, 1, 2), 120, 4, 1, 0);
    expect(moles.map((m) => m.dueAt)).toEqual([0, 500, 1000]);
  });

  it('repeats the loop end to end', () => {
    const moles = spawnPlan(hits(0, 2), 120, 4, 2, 0);
    // Loop is 4 beats = 2000ms, so the second repeat starts there.
    expect(moles.map((m) => m.dueAt)).toEqual([0, 1000, 2000, 3000]);
  });

  it('returns moles in time order', () => {
    const moles = spawnPlan(hits(3, 0, 2, 1), 100, 4, 2, 0);
    for (let i = 1; i < moles.length; i++) {
      expect(moles[i].dueAt).toBeGreaterThanOrEqual(moles[i - 1].dueAt);
    }
  });

  it('gives every mole a distinct id', () => {
    const moles = spawnPlan(hits(0, 1, 2), 120, 4, 3, 0);
    expect(new Set(moles.map((m) => m.id)).size).toBe(moles.length);
  });

  it('returns nothing for an empty pattern', () => {
    expect(spawnPlan([], 120, 4, 4, 0)).toEqual([]);
  });

  it('returns nothing for zero repeats', () => {
    expect(spawnPlan(hits(0, 1), 120, 4, 0, 0)).toEqual([]);
  });
});

describe('activeMoles', () => {
  const moles = [moleAt(10000)];

  it('hides a mole that is not yet due', () => {
    expect(activeMoles(moles, 10000 - EARLY_MS - 1)).toHaveLength(0);
  });

  it('shows a mole across its whole window', () => {
    expect(activeMoles(moles, 10000 - EARLY_MS)).toHaveLength(1);
    expect(activeMoles(moles, 10000)).toHaveLength(1);
    expect(activeMoles(moles, 10000 + LATE_MS)).toHaveLength(1);
  });

  it('hides a mole once its window closes', () => {
    expect(activeMoles(moles, 10000 + LATE_MS + 1)).toHaveLength(0);
  });

  it('hides a mole that has been resolved', () => {
    const resolved = [{ ...moleAt(10000), resolved: true }];
    expect(activeMoles(resolved, 10000)).toHaveLength(0);
  });
});

describe('moleRise', () => {
  it('peaks exactly on the beat', () => {
    expect(moleRise(moleAt(1000), 1000)).toBe(1);
  });

  it('is zero at both edges of the window', () => {
    expect(moleRise(moleAt(1000), 1000 - EARLY_MS)).toBe(0);
    expect(moleRise(moleAt(1000), 1000 + LATE_MS)).toBe(0);
  });

  it('is zero outside the window', () => {
    expect(moleRise(moleAt(1000), 0)).toBe(0);
    expect(moleRise(moleAt(1000), 99999)).toBe(0);
  });

  it('rises and then falls', () => {
    const m = moleAt(1000);
    expect(moleRise(m, 800)).toBeGreaterThan(moleRise(m, 700));
    expect(moleRise(m, 1100)).toBeGreaterThan(moleRise(m, 1200));
  });
});

describe('whack', () => {
  it('scores a strike on the beat as perfect', () => {
    const moles = [moleAt(1000)];
    const r = whack(moles, 0, 1000, 0);
    expect(r?.judgement).toBe('PERFECT');
    expect(r?.base).toBe(30);
  });

  it('grades a slightly late strike as good', () => {
    const moles = [moleAt(1000)];
    expect(whack(moles, 0, 1200, 0)?.judgement).toBe('GOOD');
  });

  it('grades a very late strike as ok', () => {
    const moles = [moleAt(1000)];
    expect(whack(moles, 0, 1310, 0)?.judgement).toBe('OK');
  });

  it('multiplies by the combo', () => {
    const moles = [moleAt(1000)];
    expect(whack(moles, 0, 1000, 4)?.points).toBe(30 * 5);
  });

  it('returns nothing when the cell is empty', () => {
    const moles = [moleAt(1000, 3)];
    expect(whack(moles, 7, 1000, 0)).toBeNull();
  });

  it('returns nothing when the strike is too early', () => {
    const moles = [moleAt(1000)];
    expect(whack(moles, 0, 1000 - EARLY_MS - 1, 0)).toBeNull();
  });

  it('returns nothing when the strike is too late', () => {
    const moles = [moleAt(1000)];
    expect(whack(moles, 0, 1000 + LATE_MS + 1, 0)).toBeNull();
  });

  it('cannot score the same mole twice', () => {
    const moles = [moleAt(1000)];
    expect(whack(moles, 0, 1000, 0)).not.toBeNull();
    expect(whack(moles, 0, 1010, 0)).toBeNull();
  });

  it('picks the nearest mole when two share a cell', () => {
    const near = moleAt(1000);
    const far = { ...moleAt(1250), id: 2 };
    const r = whack([far, near], 0, 1010, 0);
    expect(r?.mole.id).toBe(near.id);
  });

  it('reports the signed timing error', () => {
    const moles = [moleAt(1000)];
    expect(whack(moles, 0, 900, 0)?.offsetMs).toBe(-100);
  });
});

describe('collectMisses', () => {
  it('counts a mole whose window has closed', () => {
    const moles = [moleAt(1000)];
    expect(collectMisses(moles, 1000 + LATE_MS + 1)).toBe(1);
  });

  it('counts each miss exactly once', () => {
    const moles = [moleAt(1000)];
    collectMisses(moles, 5000);
    expect(collectMisses(moles, 6000)).toBe(0);
  });

  it('does not count a mole still in its window', () => {
    const moles = [moleAt(1000)];
    expect(collectMisses(moles, 1000)).toBe(0);
  });

  it('does not count a mole that was hit', () => {
    const moles = [moleAt(1000)];
    whack(moles, 0, 1000, 0);
    expect(collectMisses(moles, 9999)).toBe(0);
  });

  it('never marks a miss as a hit', () => {
    const moles = [moleAt(1000)];
    collectMisses(moles, 9999);
    expect(moles[0].hit).toBe(false);
    expect(moles[0].resolved).toBe(true);
    expect(moles[0].judgement).toBeNull();
  });
});

describe('roundComplete', () => {
  it('is false while a mole is still live', () => {
    expect(roundComplete([moleAt(1000)], 1000)).toBe(false);
  });

  it('is true once every window has closed', () => {
    expect(roundComplete([moleAt(1000)], 1000 + LATE_MS + 1)).toBe(true);
  });

  it('is true for an empty round', () => {
    expect(roundComplete([], 0)).toBe(true);
  });
});

describe('WhackDetector', () => {
  const over = (x: number, y: number, coverage = 0.1) => ({ coverage, x, y });
  const away = { coverage: 0, x: null, y: null };

  it('fires when a hand arrives over a cell', () => {
    const d = new WhackDetector();
    expect(d.push(over(0.5, 0.5), 1000)).toBe(4);
  });

  it('fires once while the hand stays put', () => {
    const d = new WhackDetector();
    d.push(over(0.5, 0.5), 1000);
    expect(d.push(over(0.5, 0.5), 1016)).toBeNull();
    expect(d.push(over(0.5, 0.5), 1500)).toBeNull();
  });

  it('fires again after the hand is withdrawn and returns', () => {
    const d = new WhackDetector();
    expect(d.push(over(0.5, 0.5), 1000)).toBe(4);
    d.push(away, 1200);
    expect(d.push(over(0.5, 0.5), 1400)).toBe(4);
  });

  it('fires the new cell when the hand sweeps across', () => {
    const d = new WhackDetector();
    expect(d.push(over(0.1, 0.1), 1000)).toBe(0);
    expect(d.push(over(0.9, 0.9), 1200)).toBe(8);
  });

  it('ignores a hand too faint to count', () => {
    const d = new WhackDetector();
    expect(d.push(over(0.5, 0.5, 0.04), 1000)).toBeNull();
  });

  it('does not machine-gun when coverage jitters on the threshold', () => {
    const d = new WhackDetector();
    expect(d.push(over(0.5, 0.5, 0.055), 1000)).toBe(4);
    expect(d.push(over(0.5, 0.5, 0.04), 1016)).toBeNull();
    expect(d.push(over(0.5, 0.5, 0.06), 1032)).toBeNull();
    expect(d.push(over(0.5, 0.5, 0.04), 1048)).toBeNull();
    expect(d.push(over(0.5, 0.5, 0.06), 1064)).toBeNull();
  });

  it('honours the refractory gap between strikes', () => {
    const d = new WhackDetector(0.05, 0.03, 200);
    expect(d.push(over(0.1, 0.1), 1000)).toBe(0);
    d.push(away, 1050);
    expect(d.push(over(0.9, 0.9), 1100)).toBeNull();
    expect(d.push(over(0.9, 0.9), 1250)).toBe(8);
  });

  it('re-arms after reset', () => {
    const d = new WhackDetector();
    d.push(over(0.5, 0.5), 1000);
    d.reset();
    expect(d.push(over(0.5, 0.5), 1016)).toBe(4);
  });
});
