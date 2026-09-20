import { planToLoopEvents } from '@/audio/planEvents';

/**
 * The transport class itself drives the native engine, so it is exercised on
 * device. What is worth testing here is the pure translation from an
 * arrangement plan into scheduled loop events — an off-by-one in the beat
 * indexing would silently shift the whole arrangement by a beat.
 */

describe('planToLoopEvents', () => {
  const labelToId = new Map([
    ['cup', 'id-cup'],
    ['table', 'id-table'],
  ]);

  it('converts 1-indexed bar beats to 0-indexed loop beats', () => {
    const events = planToLoopEvents([{ object: 'cup', beats: [1, 3] }], labelToId, 1);
    expect(events.map((e) => e.beat)).toEqual([0, 2]);
  });

  it('repeats the pattern across every bar of the loop', () => {
    const events = planToLoopEvents([{ object: 'cup', beats: [1] }], labelToId, 4);
    // Beat 1 of each of 4 bars → loop beats 0, 4, 8, 12.
    expect(events.map((e) => e.beat)).toEqual([0, 4, 8, 12]);
  });

  it('returns events sorted by beat across multiple objects', () => {
    const events = planToLoopEvents(
      [
        { object: 'cup', beats: [1, 3] },
        { object: 'table', beats: [2, 4] },
      ],
      labelToId,
      1,
    );
    const beats = events.map((e) => e.beat);
    expect(beats).toEqual([...beats].sort((a, b) => a - b));
    expect(beats).toEqual([0, 1, 2, 3]);
  });

  it('preserves fractional offbeats', () => {
    const events = planToLoopEvents([{ object: 'cup', beats: [1.5, 2.5] }], labelToId, 1);
    expect(events.map((e) => e.beat)).toEqual([0.5, 1.5]);
  });

  it('skips objects that are not in the session', () => {
    const events = planToLoopEvents(
      [
        { object: 'cup', beats: [1] },
        { object: 'ghost', beats: [2] },
      ],
      labelToId,
      1,
    );
    expect(events).toHaveLength(1);
    expect(events[0].objectId).toBe('id-cup');
  });

  it('matches object names case-insensitively', () => {
    const events = planToLoopEvents([{ object: 'CUP', beats: [1] }], labelToId, 1);
    expect(events[0].objectId).toBe('id-cup');
  });

  it('gives every event full velocity', () => {
    const events = planToLoopEvents([{ object: 'cup', beats: [1, 2] }], labelToId, 1);
    expect(events.every((e) => e.velocity === 1)).toBe(true);
  });

  it('returns nothing for an empty pattern', () => {
    expect(planToLoopEvents([], labelToId, 4)).toEqual([]);
  });
});
