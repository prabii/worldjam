import {
  buildArp,
  buildBassline,
  buildChordVoicing,
  buildPercPattern,
  chordForDegree,
  progressionFor,
  semitoneToFreq,
} from '@/audio/harmony';
import { renderKick, renderNoisePerc, renderNote } from '@/audio/instruments';

describe('chordForDegree', () => {
  it('builds a minor tonic in a minor key', () => {
    const c = chordForDegree(1, true, false);
    // Root, minor third, perfect fifth.
    expect(c.tones).toEqual([0, 3, 7]);
    expect(c.degree).toBe('i');
  });

  it('builds a major tonic in a major key', () => {
    const c = chordForDegree(1, false, false);
    expect(c.tones).toEqual([0, 4, 7]);
    expect(c.degree).toBe('I');
  });

  it('makes VI major in a minor key', () => {
    // In natural minor, the sixth degree carries a major triad.
    const c = chordForDegree(6, true, false);
    expect(c.tones[1]).toBe(4);
    expect(c.degree).toBe('VI');
  });

  it('makes ii minor in a major key', () => {
    const c = chordForDegree(2, false, false);
    expect(c.tones[1]).toBe(3);
    expect(c.degree).toBe('ii');
  });

  it('adds a seventh when asked', () => {
    const triad = chordForDegree(1, true, false);
    const seventh = chordForDegree(1, true, true);
    expect(seventh.tones).toHaveLength(4);
    expect(triad.tones).toHaveLength(3);
  });

  it('wraps degrees beyond the octave', () => {
    expect(chordForDegree(8, true, false).tones).toEqual(
      chordForDegree(1, true, false).tones,
    );
  });
});

describe('progressionFor', () => {
  it('returns one chord per bar', () => {
    expect(progressionFor('chill', 4)).toHaveLength(4);
    expect(progressionFor('jazz', 8)).toHaveLength(8);
  });

  it('gives different styles different progressions', () => {
    const chill = progressionFor('chill', 4).map((c) => c.degree).join('-');
    const rock = progressionFor('rock', 4).map((c) => c.degree).join('-');
    expect(chill).not.toBe(rock);
  });

  it('actually changes chord between bars', () => {
    const roots = progressionFor('chill', 4).map((c) => c.root);
    expect(new Set(roots).size).toBeGreaterThan(1);
  });

  it('repeats the cycle beyond its length', () => {
    const eight = progressionFor('chill', 8);
    expect(eight[0].root).toBe(eight[4].root);
  });

  it('uses sevenths for jazz', () => {
    expect(progressionFor('jazz', 4)[0].tones).toHaveLength(4);
  });
});

describe('buildBassline', () => {
  const chords = progressionFor('chill', 4);

  it('produces notes for every bar', () => {
    const bass = buildBassline(chords, 'chill');
    const bars = new Set(bass.map((n) => Math.floor(n.beat / 4)));
    expect(bars.size).toBe(4);
  });

  it('walks rather than repeating one note', () => {
    const jazz = buildBassline(progressionFor('jazz', 4), 'jazz');
    const pitches = new Set(jazz.map((n) => n.semitone));
    // A walking bass should touch several distinct pitches.
    expect(pitches.size).toBeGreaterThan(3);
  });

  it('gives EDM offbeat notes', () => {
    const edm = buildBassline(progressionFor('edm', 4), 'edm');
    const offbeats = edm.filter((n) => Math.abs((n.beat % 1) - 0.5) < 0.01);
    expect(offbeats.length).toBeGreaterThan(0);
  });

  it('keeps every note inside the loop', () => {
    for (const style of ['chill', 'jazz', 'lofi', 'cinematic', 'edm', 'rock'] as const) {
      const bass = buildBassline(progressionFor(style, 4), style);
      for (const n of bass) {
        expect(n.beat).toBeGreaterThanOrEqual(0);
        expect(n.beat).toBeLessThan(16);
        expect(n.velocity).toBeGreaterThan(0);
      }
    }
  });
});

describe('buildChordVoicing', () => {
  it('leads voices smoothly between bars', () => {
    const voicing = buildChordVoicing(progressionFor('chill', 4), 'chill');

    // Group by bar and compare each bar's top note to the next.
    const byBar = new Map<number, number[]>();
    for (const n of voicing) {
      const bar = Math.floor(n.beat / 4);
      byBar.set(bar, [...(byBar.get(bar) ?? []), n.semitone]);
    }

    const tops = [...byBar.values()].map((v) => Math.max(...v));
    for (let i = 1; i < tops.length; i++) {
      // Smooth leading means no octave leaps between bars.
      expect(Math.abs(tops[i] - tops[i - 1])).toBeLessThan(12);
    }
  });

  it('gives rock stabs rather than sustained chords', () => {
    const rock = buildChordVoicing(progressionFor('rock', 2), 'rock');
    expect(rock.every((n) => n.duration < 1)).toBe(true);
  });

  it('sustains chords for cinematic', () => {
    const cine = buildChordVoicing(progressionFor('cinematic', 2), 'cinematic');
    expect(cine.some((n) => n.duration > 2)).toBe(true);
  });
});

describe('buildArp', () => {
  it('produces continuous movement', () => {
    const arp = buildArp(progressionFor('chill', 2), 'chill');
    expect(arp.length).toBeGreaterThan(10);
  });

  it('accents the start of each group', () => {
    const arp = buildArp(progressionFor('chill', 2), 'chill');
    const accents = arp.filter((n) => n.velocity > 0.5);
    expect(accents.length).toBeGreaterThan(0);
  });

  it('runs faster for EDM', () => {
    const chill = buildArp(progressionFor('chill', 2), 'chill');
    const edm = buildArp(progressionFor('edm', 2), 'edm');
    expect(edm.length).toBeGreaterThan(chill.length);
  });
});

describe('buildPercPattern', () => {
  it('fills the whole loop', () => {
    const perc = buildPercPattern('chill', 4);
    const bars = new Set(perc.map((n) => Math.floor(n.beat / 4)));
    expect(bars.size).toBe(4);
  });

  it('adds a fill on the last bar', () => {
    const perc = buildPercPattern('chill', 4);
    const lastBar = perc.filter((n) => n.beat >= 12);
    const otherBar = perc.filter((n) => n.beat >= 4 && n.beat < 8);
    // The final bar should be busier than a middle one.
    expect(lastBar.length).toBeGreaterThan(otherBar.length);
  });

  it('accents downbeats', () => {
    const perc = buildPercPattern('chill', 2);
    const onBeat = perc.filter((n) => Math.abs(n.beat % 1) < 0.01);
    const offBeat = perc.filter((n) => Math.abs(n.beat % 1) > 0.1);
    expect(Math.max(...onBeat.map((n) => n.velocity))).toBeGreaterThan(
      Math.max(...offBeat.map((n) => n.velocity)),
    );
  });

  it('swings jazz', () => {
    const jazz = buildPercPattern('jazz', 1);
    // Triplet feel means notes land off the straight eighth grid.
    const offGrid = jazz.filter((n) => {
      const frac = n.beat % 0.5;
      return frac > 0.05 && frac < 0.45;
    });
    expect(offGrid.length).toBeGreaterThan(0);
  });
});

describe('semitoneToFreq', () => {
  it('maps the key root at octave 0 to middle C', () => {
    expect(semitoneToFreq(0, 0, 0)).toBeCloseTo(261.63, 1);
  });

  it('doubles frequency per octave', () => {
    const low = semitoneToFreq(0, 0, 0);
    const high = semitoneToFreq(0, 0, 1);
    expect(high / low).toBeCloseTo(2, 5);
  });

  it('respects the key root', () => {
    // A is 9 semitones above C.
    expect(semitoneToFreq(0, 9, 0)).toBeCloseTo(440, 0);
  });
});

describe('instruments', () => {
  const SR = 48000;

  it('renders a note with real harmonic content', () => {
    const note = renderNote({ freq: 220, duration: 0.3, sampleRate: SR, timbre: 'keys' });
    expect(note.length).toBeGreaterThan(SR * 0.3);
    expect(note.some((v) => v !== 0)).toBe(true);
  });

  it('keeps output within range', () => {
    for (const timbre of ['bass', 'keys', 'pad', 'pluck'] as const) {
      const note = renderNote({ freq: 110, duration: 0.2, sampleRate: SR, timbre });
      expect(note.every((v) => Math.abs(v) <= 1.05)).toBe(true);
    }
  });

  it('starts silent and fades in (no click)', () => {
    const note = renderNote({ freq: 220, duration: 0.2, sampleRate: SR, timbre: 'pad' });
    expect(Math.abs(note[0])).toBeLessThan(0.01);
  });

  it('loses brightness over time, as a real instrument does', () => {
    const note = renderNote({ freq: 440, duration: 0.5, sampleRate: SR, timbre: 'pluck' });

    // High-frequency energy via first-difference: a signal rich in harmonics
    // changes faster sample to sample. Normalised by amplitude so the overall
    // decay envelope does not mask the timbral change, which is the actual
    // claim under test.
    const brightness = (from: number, to: number) => {
      let diff = 0;
      let amp = 0;
      for (let i = from + 1; i < to; i++) {
        diff += Math.abs(note[i] - note[i - 1]);
        amp += Math.abs(note[i]);
      }
      return amp > 1e-9 ? diff / amp : 0;
    };

    const early = brightness(200, 200 + SR * 0.02);
    const late = brightness(Math.floor(SR * 0.25), Math.floor(SR * 0.27));
    expect(late).toBeLessThan(early);
  });

  it('never produces NaN', () => {
    const note = renderNote({ freq: 55, duration: 0.4, sampleRate: SR, timbre: 'bass' });
    expect(note.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('renders noise percussion that decays', () => {
    const hit = renderNoisePerc(SR, 0.1, 0.7, 1);
    const head = Math.abs(hit[10]);
    const tail = Math.abs(hit[hit.length - 10]);
    expect(head).toBeGreaterThan(tail);
  });

  it('renders a kick with a pitch sweep', () => {
    const kick = renderKick(SR, 0.25, 1);
    expect(kick.length).toBeGreaterThan(SR * 0.2);
    expect(kick.every((v) => Number.isFinite(v) && Math.abs(v) <= 1.2)).toBe(true);
  });
});
