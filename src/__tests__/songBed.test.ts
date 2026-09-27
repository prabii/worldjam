import {
  assembleBed,
  bedEvents,
  bedLayout,
  clipIndexFor,
  framesPerBar,
} from '@/audio/songBed';
import { buildSongForm, songBars } from '@/audio/song';

const SR = 44100;

/** A clip of a constant value, so contributions are identifiable by amplitude. */
function flat(value: number, frames: number) {
  return { pcm: new Float32Array(frames).fill(value) };
}

describe('framesPerBar', () => {
  it('is four beats at the given tempo', () => {
    // 120 BPM: a beat is 0.5 s, a bar 2 s.
    expect(framesPerBar(120, SR)).toBe(SR * 2);
  });

  it('gets longer as the tempo slows', () => {
    expect(framesPerBar(60, SR)).toBeGreaterThan(framesPerBar(140, SR));
  });

  it('does not divide by zero on a nonsense tempo', () => {
    expect(Number.isFinite(framesPerBar(0, SR))).toBe(true);
  });
});

describe('bedLayout', () => {
  const form = buildSongForm('chill');

  it('starts the first section at zero', () => {
    expect(bedLayout(form, 92, SR).offsets[0]).toBe(0);
  });

  it('places each section on its own bar line', () => {
    const l = bedLayout(form, 92, SR);
    form.forEach((s, i) => {
      expect(l.offsets[i]).toBe(s.startBar * l.framesPerBar);
    });
  });

  it('covers the whole form', () => {
    const l = bedLayout(form, 92, SR);
    expect(l.totalFrames).toBe(songBars(form) * l.framesPerBar);
  });

  it('is about two minutes at a typical tempo', () => {
    const seconds = bedLayout(form, 92, SR).totalFrames / SR;
    expect(seconds).toBeGreaterThan(90);
    expect(seconds).toBeLessThan(150);
  });
});

describe('clipIndexFor', () => {
  const form = buildSongForm('chill');

  it('points a section at the first section of its kind', () => {
    form.forEach((_, i) => {
      const src = clipIndexFor(form, i);
      expect(form[src].kind).toBe(form[i].kind);
      expect(src).toBeLessThanOrEqual(i);
    });
  });

  it('makes repeated kinds share one clip', () => {
    const choruses = form
      .map((s, i) => ({ s, i }))
      .filter((x) => x.s.kind === 'chorus');
    expect(choruses.length).toBeGreaterThan(1);
    const indices = choruses.map((x) => clipIndexFor(form, x.i));
    expect(new Set(indices).size).toBe(1);
  });
});

describe('assembleBed', () => {
  const form = buildSongForm('chill');

  it('produces a buffer covering the whole song', () => {
    const out = assembleBed(form, () => flat(0.5, SR), 92, SR);
    expect(out.length).toBe(bedLayout(form, 92, SR).totalFrames);
  });

  it('fills a section from a clip shorter than it', () => {
    // One second of audio under an eight-bar section.
    const out = assembleBed(form, () => flat(0.5, SR), 92, SR);
    const l = bedLayout(form, 92, SR);
    // Sample well inside the second section, past any seam fade.
    const probe = l.offsets[1] + l.framesPerBar * 2;
    expect(Math.abs(out[probe])).toBeGreaterThan(0.4);
  });

  it('leaves silence where a clip is missing', () => {
    const out = assembleBed(form, (i) => (i === 0 ? null : flat(0.5, SR)), 92, SR);
    // Inside the first section, which had no clip.
    expect(out[100]).toBe(0);
  });

  it('survives every clip being missing', () => {
    const out = assembleBed(form, () => null, 92, SR);
    expect(out.length).toBeGreaterThan(0);
    let peak = 0;
    for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
    expect(peak).toBe(0);
  });

  it('fades in at a section start rather than stepping', () => {
    const out = assembleBed(form, () => flat(0.5, SR), 92, SR);
    const start = bedLayout(form, 92, SR).offsets[1];
    // The first frame of a section must be quieter than its middle.
    expect(Math.abs(out[start])).toBeLessThan(0.1);
  });

  it('does not run past the end of the song', () => {
    // Clips far longer than their sections must still be cut at the boundary.
    const out = assembleBed(form, () => flat(0.5, SR * 200), 92, SR);
    expect(out.length).toBe(bedLayout(form, 92, SR).totalFrames);
  });

  it('never clips the output', () => {
    const out = assembleBed(form, () => flat(0.9, SR), 92, SR);
    // Reduced rather than asserted per frame: the buffer is millions of
    // samples and a per-frame matcher turns a unit test into a minute.
    let peak = 0;
    for (let i = 0; i < out.length; i++) {
      const a = Math.abs(out[i]);
      if (a > peak) peak = a;
    }
    expect(peak).toBeLessThanOrEqual(1);
  });

  it('is deterministic', () => {
    const a = assembleBed(form, () => flat(0.5, SR), 92, SR);
    const b = assembleBed(form, () => flat(0.5, SR), 92, SR);
    expect(Array.from(a.slice(0, 5000))).toEqual(Array.from(b.slice(0, 5000)));
  });

  it('handles an empty clip without producing NaN', () => {
    const out = assembleBed(form, () => ({ pcm: new Float32Array(0) }), 92, SR);
    let allFinite = true;
    for (let i = 0; i < out.length; i++) {
      if (!Number.isFinite(out[i])) { allFinite = false; break; }
    }
    expect(allFinite).toBe(true);
  });

  it('works for every style form', () => {
    for (const style of ['chill', 'edm', 'cinematic'] as const) {
      const f = buildSongForm(style);
      const out = assembleBed(f, () => flat(0.4, SR), 100, SR);
      expect(out.length).toBe(bedLayout(f, 100, SR).totalFrames);
    }
  });
});

describe('bedEvents', () => {
  it('fires once at the top, since the bed spans the song', () => {
    const e = bedEvents();
    expect(e).toHaveLength(1);
    expect(e[0].beat).toBe(0);
  });
});
