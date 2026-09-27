import {
  SONG_BARS,
  buildSongForm,
  distinctKinds,
  renderSong,
  songBars,
  songSeconds,
} from '@/audio/song';
import type { Style, WorldJamObject } from '@/types';

const STYLES: Style[] = ['chill', 'jazz', 'lofi', 'cinematic', 'edm', 'rock'];

function obj(
  id: string,
  label: string,
  role: WorldJamObject['role'],
): WorldJamObject {
  return {
    id,
    label,
    category: 'cup',
    slot: 0,
    position: { x: 0.5, y: 0.5 },
    features: null,
    role,
    beatPattern: [],
    volume: 1,
    pan: 0.5,
    color: '#fff',
    createdAt: 0,
  } as WorldJamObject;
}

const KIT = [
  obj('k', 'Table', 'kick'),
  obj('s', 'Mug', 'snare'),
  obj('h', 'Keys', 'hat'),
];

const PATTERN = [
  { object: 'Table', beats: [1, 3] },
  { object: 'Mug', beats: [2, 4] },
  { object: 'Keys', beats: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5] },
];

describe('buildSongForm', () => {
  it.each(STYLES)('produces contiguous sections for %s', (style) => {
    const form = buildSongForm(style);
    expect(form.length).toBeGreaterThan(2);
    expect(form[0].startBar).toBe(0);
    for (let i = 1; i < form.length; i++) {
      expect(form[i].startBar).toBe(form[i - 1].startBar + form[i - 1].bars);
    }
  });

  it.each(STYLES)('opens with an intro and ends with an outro for %s', (style) => {
    const form = buildSongForm(style);
    expect(form[0].kind).toBe('intro');
    // The outro exists in arrangement.ts's tables but buildForm never emits
    // it; the song form is what finally uses it.
    expect(form[form.length - 1].kind).toBe('outro');
  });

  it.each(STYLES)('gives every section a positive length for %s', (style) => {
    for (const s of buildSongForm(style)) expect(s.bars).toBeGreaterThan(0);
  });

  it('lands near two minutes at a typical tempo', () => {
    const seconds = songSeconds(buildSongForm('chill'), 92);
    expect(seconds).toBeGreaterThan(90);
    expect(seconds).toBeLessThan(150);
  });

  it('states the chorus more than once, so the second is earned', () => {
    const form = buildSongForm('chill');
    expect(form.filter((s) => s.kind === 'chorus').length).toBeGreaterThanOrEqual(2);
  });

  it('gives edm a drop, because that is the genre', () => {
    expect(buildSongForm('edm').some((s) => s.kind === 'drop')).toBe(true);
  });

  it('does not give a drop to styles that have no use for one', () => {
    expect(buildSongForm('jazz').some((s) => s.kind === 'drop')).toBe(false);
  });

  it('gives cinematic a longer opening than chill', () => {
    expect(buildSongForm('cinematic')[0].bars).toBeGreaterThan(
      buildSongForm('chill')[0].bars,
    );
  });

  it('is deterministic', () => {
    expect(buildSongForm('lofi')).toEqual(buildSongForm('lofi'));
  });

  it('reports the standard length for the standard arc', () => {
    expect(songBars(buildSongForm('chill'))).toBe(SONG_BARS);
  });
});

describe('distinctKinds', () => {
  it('collapses repeats, so a bed is generated once per kind', () => {
    const form = buildSongForm('chill');
    const kinds = distinctKinds(form);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds.length).toBeLessThan(form.length);
  });

  it('lists kinds in first-appearance order', () => {
    expect(distinctKinds(buildSongForm('chill'))[0]).toBe('intro');
  });
});

describe('renderSong', () => {
  const form = buildSongForm('chill');

  it('spans the whole form', () => {
    const events = renderSong({ objects: KIT, objectPattern: PATTERN, form });
    const lastBeat = Math.max(...events.map((e) => e.beat));
    expect(lastBeat).toBeGreaterThan((songBars(form) - 2) * 4);
  });

  it('returns events in time order', () => {
    const events = renderSong({ objects: KIT, objectPattern: PATTERN, form });
    for (let i = 1; i < events.length; i++) {
      expect(events[i].beat).toBeGreaterThanOrEqual(events[i - 1].beat);
    }
  });

  it('plays the chorus louder than the intro', () => {
    const events = renderSong({ objects: KIT, objectPattern: PATTERN, form });
    const intro = form[0];
    const chorus = form.find((s) => s.kind === 'chorus')!;

    const peak = (s: typeof intro) =>
      Math.max(
        ...events
          .filter(
            (e) => e.beat >= s.startBar * 4 && e.beat < (s.startBar + s.bars) * 4,
          )
          .map((e) => e.velocity),
      );

    expect(peak(chorus)).toBeGreaterThan(peak(intro));
  });

  it('thins the intro, so it reads as an opening', () => {
    const events = renderSong({ objects: KIT, objectPattern: PATTERN, form });
    const intro = form[0];
    const chorus = form.find((s) => s.kind === 'chorus')!;

    const perBar = (s: typeof intro) =>
      events.filter(
        (e) => e.beat >= s.startBar * 4 && e.beat < (s.startBar + s.bars) * 4,
      ).length / s.bars;

    expect(perBar(intro)).toBeLessThan(perBar(chorus));
  });

  it('silences a part the section drops entirely', () => {
    // The intro density gives snare 0, so the snare must not sound there.
    const events = renderSong({ objects: KIT, objectPattern: PATTERN, form });
    const intro = form[0];
    const introSnare = events.filter(
      (e) =>
        e.objectId === 's' &&
        e.beat >= intro.startBar * 4 &&
        e.beat < (intro.startBar + intro.bars) * 4 &&
        // A turnaround fill is played by the snare object by design; only the
        // pattern itself is silenced.
        e.beat % 4 < 3,
    );
    expect(introSnare).toHaveLength(0);
  });

  it('keeps a user-programmed part intact where the section lets it sound', () => {
    const fixed = new Set(['keys']);
    const withFixed = renderSong({
      objects: KIT,
      objectPattern: PATTERN,
      form,
      fixed,
    });
    const without = renderSong({ objects: KIT, objectPattern: PATTERN, form });

    const hats = (es: typeof withFixed) => es.filter((e) => e.objectId === 'h').length;
    expect(hats(withFixed)).toBeGreaterThan(hats(without));
  });

  it('does not put a turnaround on the final bar, which leads nowhere', () => {
    const events = renderSong({ objects: KIT, objectPattern: PATTERN, form });
    const total = songBars(form);
    const lastBar = events.filter((e) => e.beat >= (total - 1) * 4);
    // Offbeat fill positions (x.5, x.75) must not appear in the closing bar.
    expect(lastBar.some((e) => e.beat % 1 === 0.75)).toBe(false);
  });

  it('never exceeds full velocity', () => {
    const events = renderSong({ objects: KIT, objectPattern: PATTERN, form });
    for (const e of events) {
      expect(e.velocity).toBeGreaterThan(0);
      expect(e.velocity).toBeLessThanOrEqual(1);
    }
  });

  it('ignores a pattern naming an object that is not there', () => {
    const events = renderSong({
      objects: KIT,
      objectPattern: [{ object: 'Trombone', beats: [1] }],
      form,
    });
    // Only turnaround fills remain.
    expect(events.every((e) => e.objectId === 's')).toBe(true);
  });

  it('matches object names case-insensitively', () => {
    const lower = renderSong({
      objects: KIT,
      objectPattern: [{ object: 'table', beats: [1] }],
      form,
    });
    expect(lower.some((e) => e.objectId === 'k')).toBe(true);
  });

  it('copes with a session of one object', () => {
    const events = renderSong({
      objects: [KIT[0]],
      objectPattern: [{ object: 'Table', beats: [1, 3] }],
      form,
    });
    expect(events.length).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const a = renderSong({ objects: KIT, objectPattern: PATTERN, form });
    const b = renderSong({ objects: KIT, objectPattern: PATTERN, form });
    expect(a).toEqual(b);
  });
});
