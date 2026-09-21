import {
  buildForm,
  renderArrangement,
  sectionAt,
  thinBeats,
  velocityFor,
} from '@/audio/arrangement';
import type { MusicalRole, WorldJamObject } from '@/types';

function obj(label: string, role: MusicalRole, id = label): WorldJamObject {
  return {
    id,
    label,
    category: 'unknown',
    slot: 0,
    position: { x: 0.5, y: 0.5 },
    features: null,
    role,
    beatPattern: [],
    volume: 0.8,
    pan: 0.5,
    color: '#FFFFFF',
    createdAt: 0,
  };
}

describe('buildForm', () => {
  it('does not waste a short loop on an intro', () => {
    const form = buildForm(4, 'chill');
    expect(form.some((s) => s.kind === 'intro')).toBe(false);
  });

  it('gives even the shortest loop somewhere to go', () => {
    const form = buildForm(4, 'chill');
    expect(form.length).toBeGreaterThan(1);
  });

  it('covers every bar exactly once, with no gap or overlap', () => {
    for (const bars of [1, 2, 3, 4, 6, 8, 12, 16, 32]) {
      const form = buildForm(bars, 'chill');
      const total = form.reduce((a, s) => a + s.bars, 0);
      expect(total).toBe(bars);

      // Sections must be contiguous from 0.
      let expectedStart = 0;
      for (const s of form) {
        expect(s.startBar).toBe(expectedStart);
        expectedStart += s.bars;
      }
    }
  });

  it('never emits an empty section', () => {
    for (const bars of [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 16, 32]) {
      for (const s of buildForm(bars, 'edm')) {
        expect(s.bars).toBeGreaterThan(0);
      }
    }
  });

  it('gives EDM a drop where other styles get a chorus', () => {
    const edm = buildForm(16, 'edm');
    const chill = buildForm(16, 'chill');
    expect(edm.some((s) => s.kind === 'drop')).toBe(true);
    expect(chill.some((s) => s.kind === 'drop')).toBe(false);
  });

  it('builds a full form for a long song', () => {
    const kinds = buildForm(16, 'chill').map((s) => s.kind);
    expect(kinds).toContain('intro');
    expect(kinds).toContain('chorus');
  });
});

describe('sectionAt', () => {
  const form = buildForm(16, 'chill');

  it('finds the section for every bar', () => {
    for (let bar = 0; bar < 16; bar++) {
      const s = sectionAt(form, bar);
      expect(bar).toBeGreaterThanOrEqual(s.startBar);
      expect(bar).toBeLessThan(s.startBar + s.bars);
    }
  });

  it('clamps past the end rather than returning undefined', () => {
    expect(sectionAt(form, 999)).toBeDefined();
  });
});

describe('thinBeats', () => {
  it('keeps everything at full density', () => {
    expect(thinBeats([1, 2, 3, 4], 1)).toEqual([1, 2, 3, 4]);
  });

  it('drops everything at zero', () => {
    expect(thinBeats([1, 2, 3, 4], 0)).toEqual([]);
  });

  it('keeps the downbeat when thinning hard', () => {
    // Beat 1 is what makes a bar readable; losing it to keep an offbeat would
    // leave the listener unable to find the pulse.
    expect(thinBeats([1, 2, 3, 4], 0.25)).toContain(1);
  });

  it('prefers strong beats over offbeats', () => {
    const kept = thinBeats([1, 2.5, 3, 4.5], 0.5);
    expect(kept).toContain(1);
    expect(kept).not.toContain(4.5);
  });

  it('returns beats in time order, whatever the ranking did', () => {
    const kept = thinBeats([4, 1, 3, 2], 1);
    expect(kept).toEqual([...kept].sort((a, b) => a - b));
  });

  it('never returns more beats than it was given', () => {
    expect(thinBeats([1, 3], 1).length).toBeLessThanOrEqual(2);
  });

  it('keeps at least one beat for any non-zero density', () => {
    expect(thinBeats([1, 2, 3, 4], 0.01).length).toBeGreaterThanOrEqual(1);
  });

  it('handles an empty pattern', () => {
    expect(thinBeats([], 0.5)).toEqual([]);
  });
});

describe('velocityFor', () => {
  it('accents the downbeat hardest', () => {
    expect(velocityFor(1)).toBeGreaterThan(velocityFor(3));
    expect(velocityFor(3)).toBeGreaterThan(velocityFor(2.5));
  });

  it('plays offbeats lighter than any on-beat', () => {
    expect(velocityFor(2.5)).toBeLessThan(velocityFor(2));
  });
});

describe('renderArrangement', () => {
  const objects = [
    obj('Table', 'kick'),
    obj('Bottle', 'snare'),
    obj('Keys', 'hat'),
  ];
  const objectPattern = [
    { object: 'Table', beats: [1, 3] },
    { object: 'Bottle', beats: [2, 4] },
    { object: 'Keys', beats: [1, 2, 3, 4] },
  ];

  it('spreads events across every bar, not just the first', () => {
    const events = renderArrangement({ objects, objectPattern, totalBars: 8, style: 'chill' });
    const lastBeat = Math.max(...events.map((e) => e.beat));
    expect(lastBeat).toBeGreaterThanOrEqual(7 * 4);
  });

  it('makes bars differ — this is the whole point', () => {
    const events = renderArrangement({ objects, objectPattern, totalBars: 16, style: 'chill' });

    const countInBar = (bar: number) =>
      events.filter((e) => e.beat >= bar * 4 && e.beat < (bar + 1) * 4).length;

    // An intro bar and a chorus bar must not be identical.
    const bars = Array.from({ length: 16 }, (_, i) => countInBar(i));
    expect(new Set(bars).size).toBeGreaterThan(1);
  });

  it('builds toward the chorus rather than starting at full tilt', () => {
    const events = renderArrangement({ objects, objectPattern, totalBars: 16, style: 'chill' });
    const energy = (bar: number) =>
      events
        .filter((e) => e.beat >= bar * 4 && e.beat < (bar + 1) * 4)
        .reduce((a, e) => a + e.velocity, 0);

    // The last bar belongs to the chorus; the first to the intro.
    expect(energy(15)).toBeGreaterThan(energy(0));
  });

  it('returns events in time order, which the scheduler requires', () => {
    const events = renderArrangement({ objects, objectPattern, totalBars: 8, style: 'chill' });
    for (let i = 1; i < events.length; i++) {
      expect(events[i].beat).toBeGreaterThanOrEqual(events[i - 1].beat);
    }
  });

  it('keeps every velocity in range', () => {
    const events = renderArrangement({ objects, objectPattern, totalBars: 16, style: 'edm' });
    for (const e of events) {
      expect(e.velocity).toBeGreaterThan(0);
      expect(e.velocity).toBeLessThanOrEqual(1);
    }
  });

  it('only references objects that exist', () => {
    const ids = new Set(objects.map((o) => o.id));
    const events = renderArrangement({ objects, objectPattern, totalBars: 8, style: 'chill' });
    for (const e of events) expect(ids.has(e.objectId)).toBe(true);
  });

  it('ignores a pattern naming an object that was deleted', () => {
    const events = renderArrangement({
      objects,
      objectPattern: [...objectPattern, { object: 'Ghost', beats: [1, 2, 3, 4] }],
      totalBars: 4,
      style: 'chill',
    });
    expect(events.every((e) => e.objectId !== 'Ghost')).toBe(true);
  });

  it('puts no fill on the final bar, which would point at nothing', () => {
    const events = renderArrangement({ objects, objectPattern, totalBars: 8, style: 'chill' });
    const finalBarStart = 7 * 4;
    const tail = events.filter((e) => e.beat >= finalBarStart + 3.4);
    // The last bar may still have its own beat 4, but no 4.5/4.75 fill.
    expect(tail.every((e) => Number.isInteger(e.beat))).toBe(true);
  });

  it('never lets a fill outshine the downbeat it leads into', () => {
    const events = renderArrangement({ objects, objectPattern, totalBars: 8, style: 'chill' });
    const downbeats = events.filter((e) => e.beat % 4 === 0);
    const strongestDownbeat = Math.max(...downbeats.map((e) => e.velocity));
    const offbeats = events.filter((e) => !Number.isInteger(e.beat));
    for (const e of offbeats) expect(e.velocity).toBeLessThanOrEqual(strongestDownbeat);
  });

  it('survives a session with a single object', () => {
    const one = [obj('Cup', 'perc')];
    const events = renderArrangement({
      objects: one,
      objectPattern: [{ object: 'Cup', beats: [1, 3] }],
      totalBars: 8,
      style: 'lofi',
    });
    expect(events.length).toBeGreaterThan(0);
  });

  it('matches object names regardless of case', () => {
    const events = renderArrangement({
      objects,
      objectPattern: [{ object: 'TABLE', beats: [1, 3] }],
      totalBars: 4,
      style: 'chill',
    });
    // Fills come from the backbeat object, so not every event is the Table —
    // what matters is that the uppercase name resolved at all.
    expect(events.some((e) => e.objectId === 'Table')).toBe(true);
  });

  it('survives having nothing to arrange', () => {
    expect(
      renderArrangement({ objects: [], objectPattern: [], totalBars: 4, style: 'chill' }),
    ).toEqual([]);
  });

  it('is deterministic — the same session rehearses the same', () => {
    const a = renderArrangement({ objects, objectPattern, totalBars: 16, style: 'edm' });
    const b = renderArrangement({ objects, objectPattern, totalBars: 16, style: 'edm' });
    expect(a).toEqual(b);
  });
});
