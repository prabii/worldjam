import {
  centreOctave,
  cleanMelody,
  describeMelody,
  inferTempo,
  quantizeMelody,
  refineMelody,
  snapToScale,
} from '@/dsp/melody';
import type { NoteEvent } from '@/types';

const note = (midi: number, time: number, duration = 0.4, confidence = 0.8): NoteEvent => ({
  midi,
  time,
  duration,
  confidence,
});

describe('snapToScale', () => {
  it('pulls a flat note onto the scale', () => {
    // F# (66) is not in C major; it should move to either F (65) or G (67).
    const { notes } = snapToScale([note(66, 0)], 'C major');
    expect([65, 67]).toContain(notes[0].midi);
  });

  it('leaves notes that are already in the scale alone', () => {
    const input = [note(60, 0), note(62, 0.5), note(64, 1)];
    const { notes, tuningApplied } = snapToScale(input, 'C major');
    expect(notes.map((n) => n.midi)).toEqual([60, 62, 64]);
    expect(tuningApplied).toBe(0);
  });

  it('snaps B up to C across the octave boundary rather than down the scale', () => {
    // C# (61) in C major sits between B (59) and D (62); the nearest scale
    // tones are C (60) and D (62), both one semitone away. Neither answer may
    // be a large leap — that would mean the circular distance is wrong.
    const { notes } = snapToScale([note(61, 0)], 'C major');
    expect(Math.abs(notes[0].midi - 61)).toBeLessThanOrEqual(1);
  });

  it('respects the maximum shift', () => {
    // With maxShift 0 nothing may move at all.
    const { notes } = snapToScale([note(66, 0)], 'C major', 0);
    expect(notes[0].midi).toBe(66);
  });

  it('uses the minor scale when the key is minor', () => {
    // E natural (64) is not in C minor; Eb (63) is.
    const { notes } = snapToScale([note(64, 0)], 'C minor');
    expect([63, 65]).toContain(notes[0].midi);
  });

  it('leaves everything untouched when the key is unknown', () => {
    const input = [note(61, 0), note(66, 0.5)];
    const { notes, tuningApplied } = snapToScale(input, null);
    expect(notes.map((n) => n.midi)).toEqual([61, 66]);
    expect(tuningApplied).toBe(0);
  });

  it('never moves a note more than a semitone by default', () => {
    for (let midi = 48; midi < 84; midi++) {
      const { notes } = snapToScale([note(midi, 0)], 'C major');
      expect(Math.abs(notes[0].midi - midi)).toBeLessThanOrEqual(1);
    }
  });

  it('handles an empty melody', () => {
    expect(snapToScale([], 'C major').notes).toEqual([]);
  });
});

describe('inferTempo', () => {
  it('reads a steady 120 BPM quarter-note hum', () => {
    const notes = Array.from({ length: 8 }, (_, i) => note(60, i * 0.5));
    expect(inferTempo(notes)).toBe(120);
  });

  it('folds an implausibly fast reading into a musical range', () => {
    // 0.125s between onsets is 480 BPM read literally; as sixteenths it is 120.
    const notes = Array.from({ length: 8 }, (_, i) => note(60, i * 0.125));
    const bpm = inferTempo(notes);
    expect(bpm).toBeGreaterThanOrEqual(70);
    expect(bpm).toBeLessThanOrEqual(150);
  });

  it('folds an implausibly slow reading up', () => {
    const notes = Array.from({ length: 6 }, (_, i) => note(60, i * 1.6));
    const bpm = inferTempo(notes);
    expect(bpm).toBeGreaterThanOrEqual(70);
    expect(bpm).toBeLessThanOrEqual(150);
  });

  it('falls back when there is too little to go on', () => {
    expect(inferTempo([note(60, 0)], 101)).toBe(101);
  });
});

describe('quantizeMelody', () => {
  it('moves a late note toward the grid', () => {
    // At 120 BPM a sixteenth-note step is 0.125s, so a note at 0.14 pulls
    // back to 0.125.
    const [q] = quantizeMelody([note(60, 0.14)], 120, 16, 1);
    expect(q.time).toBeCloseTo(0.125, 3);
  });

  it('uses the musician meaning of division', () => {
    // 4 means quarter notes: 0.5s at 120 BPM. 0.14 is nearest to 0.
    const [quarter] = quantizeMelody([note(60, 0.14)], 120, 4, 1);
    expect(quarter.time).toBeCloseTo(0, 3);
    // 8 means eighths: 0.25s. 0.14 is nearest to 0.25 — not to 0.125.
    const [eighth] = quantizeMelody([note(60, 0.14)], 120, 8, 1);
    expect(eighth.time).toBeCloseTo(0.25, 3);
  });

  it('strength 0 leaves the performance untouched', () => {
    const [q] = quantizeMelody([note(60, 0.14)], 120, 16, 0);
    expect(q.time).toBeCloseTo(0.14, 5);
  });

  it('partial strength lands between the performance and the grid', () => {
    // 0.2s at a 0.125s grid is nearest 0.25, so half strength lands at 0.225 —
    // between where it was played and where the grid wants it.
    const [q] = quantizeMelody([note(60, 0.2)], 120, 16, 0.5);
    expect(q.time).toBeGreaterThan(0.2);
    expect(q.time).toBeLessThan(0.25);
  });

  it('never produces a negative start time', () => {
    const [q] = quantizeMelody([note(60, 0.01)], 120, 16, 1);
    expect(q.time).toBeGreaterThanOrEqual(0);
  });

  it('gives every note at least one grid step of duration', () => {
    const [q] = quantizeMelody([note(60, 0, 0.01)], 120, 16, 1);
    expect(q.duration).toBeGreaterThan(0);
  });
});

describe('cleanMelody', () => {
  it('drops notes too short to be intentional', () => {
    const out = cleanMelody([note(60, 0, 0.4), note(62, 0.5, 0.02)]);
    expect(out).toHaveLength(1);
    expect(out[0].midi).toBe(60);
  });

  it('drops notes the tracker was not confident about', () => {
    const out = cleanMelody([note(60, 0, 0.4, 0.05)]);
    expect(out).toHaveLength(0);
  });

  it('merges a held note the tracker split in two', () => {
    const out = cleanMelody([note(60, 0, 0.3), note(60, 0.31, 0.3)]);
    expect(out).toHaveLength(1);
    expect(out[0].duration).toBeCloseTo(0.61, 2);
  });

  it('keeps a repeated note that has a real gap between it', () => {
    const out = cleanMelody([note(60, 0, 0.3), note(60, 0.9, 0.3)]);
    expect(out).toHaveLength(2);
  });
});

describe('centreOctave', () => {
  it('lifts a melody hummed an octave low', () => {
    const out = centreOctave([note(41, 0), note(43, 0.5)], 65);
    expect(out[0].midi).toBeGreaterThan(50);
    // The shape must survive the move.
    expect(out[1].midi - out[0].midi).toBe(2);
  });

  it('only ever shifts by whole octaves, so the key is preserved', () => {
    const out = centreOctave([note(48, 0)], 65);
    expect((out[0].midi - 48) % 12).toBe(0);
  });

  it('leaves an already-centred melody alone', () => {
    const out = centreOctave([note(64, 0), note(67, 0.5)], 65);
    expect(out.map((n) => n.midi)).toEqual([64, 67]);
  });
});

describe('refineMelody', () => {
  const hum: NoteEvent[] = [
    note(60, 0.02, 0.45),
    note(62, 0.51, 0.45),
    note(66, 1.02, 0.45), // off-key F#
    note(67, 1.49, 0.45),
  ];

  it('produces a melody in the scale', () => {
    const m = refineMelody(hum, 'C major');
    const pcs = m.notes.map((n) => ((n.midi % 12) + 12) % 12);
    for (const pc of pcs) expect([0, 2, 4, 5, 7, 9, 11]).toContain(pc);
  });

  it('reports the key, a tempo and a range', () => {
    const m = refineMelody(hum, 'C major');
    expect(m.key).toBe('C major');
    expect(m.bpm).toBeGreaterThanOrEqual(70);
    expect(m.range).not.toBeNull();
    expect(m.range!.high).toBeGreaterThanOrEqual(m.range!.low);
  });

  it('preserves the melodic shape', () => {
    const m = refineMelody(hum, 'C major', { centre: false });
    // The hum rises throughout; the refined version must too.
    expect(m.notes[m.notes.length - 1].midi).toBeGreaterThan(m.notes[0].midi);
  });

  it('survives an empty recording', () => {
    const m = refineMelody([], null);
    expect(m.notes).toEqual([]);
    expect(m.range).toBeNull();
  });

  it('survives a recording with nothing usable in it', () => {
    const m = refineMelody([note(60, 0, 0.01, 0.01)], 'C major');
    expect(m.notes).toEqual([]);
  });
});

describe('describeMelody', () => {
  it('describes a rising line', () => {
    const m = refineMelody(
      [note(60, 0, 0.45), note(64, 0.5, 0.45), note(67, 1, 0.45)],
      'C major',
    );
    expect(describeMelody(m)).toMatch(/rises/);
  });

  it('describes a falling line', () => {
    const m = refineMelody(
      [note(67, 0, 0.45), note(64, 0.5, 0.45), note(60, 1, 0.45)],
      'C major',
    );
    expect(describeMelody(m)).toMatch(/falls/);
  });

  it('says so plainly when there is no melody', () => {
    expect(describeMelody(refineMelody([], null))).toMatch(/No clear melody/);
  });

  it('mentions the key and tempo, which the model needs', () => {
    const m = refineMelody(
      [note(60, 0, 0.45), note(62, 0.5, 0.45), note(64, 1, 0.45)],
      'C major',
    );
    const text = describeMelody(m);
    expect(text).toMatch(/C major/);
    expect(text).toMatch(/BPM/);
  });
});
