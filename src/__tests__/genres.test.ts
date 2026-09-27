import { GENRES, describeObjects, genreTempo, matchGenre } from '@/audio/genres';
import { buildSectionPrompt, buildTexturePrompt } from '@/audio/texture';
import { validatePlan } from '@/ai/schema';
import type { WorldJamObject } from '@/types';

function obj(label: string, brightness: number, decay: number, tonality = 0.2): WorldJamObject {
  return {
    id: label,
    label,
    category: 'cup',
    slot: 0,
    position: { x: 0.5, y: 0.5 },
    features: { duration: 0.4, energy: 0.5, brightness, decay, pitch: null, tonality },
    role: 'perc',
    beatPattern: [],
    volume: 1,
    pan: 0.5,
    color: '#fff',
    createdAt: 0,
  } as WorldJamObject;
}

describe('matchGenre', () => {
  it.each([
    ['make me a phonk beat', 'phonk'],
    ['drift phonk with my cup', 'phonk'],
    ['mass beat', 'mass'],
    ['tamil dappankuthu', 'mass'],
    ['teen maar dance', 'mass'],
    ['Indian music', 'indian-classical'],
    ['sitar and tabla', 'indian-classical'],
    ['south indian classical', 'carnatic'],
    ['bollywood song', 'bollywood'],
    ['punjabi bhangra', 'bhangra'],
    ['pop', 'pop'],
    ['trap banger', 'trap'],
    ['lo-fi study beats', 'lofi'],
    ['afrobeats', 'afrobeat'],
  ])('reads "%s" as %s', (text, id) => {
    expect(matchGenre(text)?.id).toBe(id);
  });

  it('prefers the longer, more specific keyword', () => {
    // "south indian classical" contains "indian"; Carnatic must win.
    expect(matchGenre('south indian classical')?.id).toBe('carnatic');
  });

  it('matches whole words only', () => {
    expect(matchGenre('popcorn')).toBeNull();
  });

  it('returns null for text that names no genre', () => {
    expect(matchGenre('something with my coffee mug')).toBeNull();
    expect(matchGenre('')).toBeNull();
    expect(matchGenre(null)).toBeNull();
  });

  it('is case-insensitive and ignores punctuation', () => {
    expect(matchGenre('PHONK!!!')?.id).toBe('phonk');
  });
});

describe('the table', () => {
  it('gives every genre a legal style, tempo range and prompt', () => {
    const styles = ['chill', 'jazz', 'lofi', 'cinematic', 'edm', 'rock'];
    for (const g of GENRES) {
      expect(styles).toContain(g.style);
      expect(g.bpm[0]).toBeLessThan(g.bpm[1]);
      expect(g.prompt.length).toBeGreaterThan(10);
    }
  });

  it('has unique ids', () => {
    expect(new Set(GENRES.map((g) => g.id)).size).toBe(GENRES.length);
  });
});

describe('genreTempo', () => {
  const phonk = matchGenre('phonk')!;
  it('pulls a slow tempo up into the genre', () => {
    expect(genreTempo(phonk, 92)).toBeGreaterThanOrEqual(130);
  });
  it('leaves a tempo already in range alone', () => {
    expect(genreTempo(phonk, 140)).toBe(140);
  });
  it('survives a nonsense tempo', () => {
    expect(Number.isFinite(genreTempo(phonk, NaN))).toBe(true);
  });
});

describe('describeObjects', () => {
  it('calls bright short sounds metallic and percussive', () => {
    expect(describeObjects([obj('Keys', 5000, 0.08)])).toMatch(/bright metallic short percussive/);
  });
  it('calls dark long sounds deep and ringing', () => {
    expect(describeObjects([obj('Table', 400, 0.9)])).toMatch(/deep thuddy ringing/);
  });
  it('returns null with nothing captured', () => {
    expect(describeObjects([])).toBeNull();
  });
});

describe('the user\'s words reach the music prompt', () => {
  it('puts the typed text in the prompt', () => {
    const p = buildTexturePrompt('chill', 92, 'F minor', null, { instruction: 'mass beat' });
    expect(p).toMatch(/mass beat/i);
    expect(p).toMatch(/thappu|nadaswaram/i);
  });

  it('gives different descriptions different prompts', () => {
    const prompts = ['phonk', 'mass beat', 'Indian classical', 'pop'].map((t) =>
      buildTexturePrompt('chill', 92, null, null, { instruction: t }),
    );
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it('lets a drum-led genre keep its drums', () => {
    const p = buildTexturePrompt('chill', 140, null, null, { instruction: 'phonk' });
    expect(p).not.toMatch(/no drums/i);
  });

  it('keeps "no drums" for a genre that is not drum-led', () => {
    const p = buildTexturePrompt('chill', 80, null, null, { instruction: 'Carnatic' });
    expect(p).toMatch(/no drums/i);
  });

  it('treats "beat" as a request for drums even in an unknown genre', () => {
    const p = buildTexturePrompt('chill', 100, null, null, { instruction: 'heavy beat' });
    expect(p).not.toMatch(/no drums/i);
  });

  it('passes an unknown description through as typed', () => {
    const p = buildTexturePrompt('chill', 100, null, null, {
      instruction: 'underwater temple bells',
    });
    expect(p).toMatch(/underwater temple bells/);
  });

  it('describes the captured objects to the model', () => {
    const p = buildTexturePrompt('chill', 100, null, null, {
      instruction: 'pop',
      objects: describeObjects([obj('Keys', 5000, 0.08)]),
    });
    expect(p).toMatch(/metallic/);
  });

  it('carries the genre into section prompts', () => {
    const p = buildSectionPrompt('chorus', 'chill', 140, 'C minor', null, { genre: 'phonk' });
    expect(p).toMatch(/808|cowbell/i);
    expect(p).toContain('140 BPM');
  });

  it('keeps tempo and key when a long description is trimmed', () => {
    const p = buildTexturePrompt('chill', 92, 'F minor', null, {
      instruction: 'a very long description '.repeat(10),
      objects: describeObjects([obj('Keys', 5000, 0.08)]),
    });
    expect(p.length).toBeLessThanOrEqual(220);
    expect(p).toContain('92 BPM');
    expect(p).toContain('F minor');
  });

  it('falls back to the style default when nothing was said', () => {
    const p = buildTexturePrompt('jazz', 110, null);
    expect(p).toMatch(/jazz|upright|smoky/i);
  });
});

describe('validatePlan keeps the genre', () => {
  const objects = [obj('Mug', 2000, 0.2)];
  const base = {
    bpm: 140,
    bars: 8,
    objectPattern: [{ object: 'Mug', beats: [1, 3] }],
    voiceRole: 'none',
    accompaniment: ['bass'],
  };

  it('no longer turns phonk into chill', () => {
    const { plan } = validatePlan({ ...base, style: 'phonk' }, objects, 92);
    expect(plan?.style).toBe('edm');
    expect(plan?.genre).toBe('phonk');
  });

  it('keeps an explicit genre alongside a legal style', () => {
    const { plan } = validatePlan({ ...base, style: 'rock', genre: 'mass beat' }, objects, 92);
    expect(plan?.style).toBe('rock');
    expect(plan?.genre).toBe('mass beat');
  });

  it('rejects the prompt placeholder echoed back', () => {
    const { plan } = validatePlan(
      { ...base, style: 'edm', genre: '<genre>', texture: '<backing music for that genre>' },
      objects,
      92,
    );
    expect(plan?.genre).toBeUndefined();
    expect(plan?.texture).toBeUndefined();
  });

  it('still defaults a meaningless style to chill', () => {
    const { plan } = validatePlan({ ...base, style: 'zzzz' }, objects, 92);
    expect(plan?.style).toBe('chill');
  });
});

describe('genre grooves', () => {
  const { grooveFor, castKit } = require('@/audio/genres');
  const kit = [obj('Table', 400, 0.5), obj('Mug', 1800, 0.2), obj('Keys', 6000, 0.05)];

  it('gives different genres different beats', () => {
    const beats = ['phonk', 'mass beat', 'bhangra', 'pop', 'trap'].map((g) =>
      JSON.stringify(grooveFor(matchGenre(g)!, kit)),
    );
    expect(new Set(beats).size).toBe(beats.length);
  });

  it('puts the darkest sound on the kick and the brightest on the hats', () => {
    const cast = castKit(kit);
    expect(cast.get('Table')).toBe('kick');
    expect(cast.get('Keys')).toBe('hat');
  });

  it('respects an object that already knows its role', () => {
    const snare = { ...obj('Pan', 300, 0.3), role: 'snare' as const };
    expect(castKit([snare, ...kit]).get('Pan')).toBe('snare');
  });

  it('leaves no recorded object silent', () => {
    for (const g of ['phonk', 'carnatic', 'indian classical', 'pop']) {
      const pattern = grooveFor(matchGenre(g)!, kit)!;
      expect(pattern.map((p: { object: string }) => p.object).sort()).toEqual(['Keys', 'Mug', 'Table'].sort().filter((l) => pattern.some((p: { object: string }) => p.object === l)));
      expect(pattern.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps every beat inside one bar', () => {
    const pattern = grooveFor(matchGenre('trap')!, kit)!;
    for (const p of pattern) for (const b of p.beats) {
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThan(5);
    }
  });
});
