import {
  buildFallbackLyrics,
  buildLyricPrompt,
  countSyllables,
  generateLyrics,
  layoutLines,
  lineAtBeat,
  parseLyricResponse,
} from '@/ai/lyrics';
import { registerGemmaRuntime } from '@/ai/gemma';
import type { ArrangementPlan, WorldJamObject } from '@/types';

jest.mock('llama.rn', () => ({ initLlama: jest.fn() }));

function obj(label: string): WorldJamObject {
  return {
    id: `id-${label}`,
    label,
    category: 'cup',
    slot: 0,
    position: { x: 0.5, y: 0.5 },
    features: null,
    role: 'perc',
    beatPattern: [],
    volume: 1,
    pan: 0.5,
    color: '#fff',
    createdAt: 0,
  };
}

const PLAN: ArrangementPlan = {
  bpm: 90,
  bars: 4,
  objectPattern: [{ object: 'Mug', beats: [1, 3] }],
  voiceRole: 'lead',
  accompaniment: ['bass'],
  style: 'chill',
  source: 'fallback',
};

const OBJECTS = [obj('Mug'), obj('Table')];

describe('countSyllables', () => {
  it.each([
    ['hello', 2],
    ['cat', 1],
    ['beautiful', 3],
    ['make', 1],
  ])('counts %s', (word, expected) => {
    expect(countSyllables(word)).toBe(expected);
  });

  it('counts a phrase', () => {
    expect(countSyllables('turn the room into a song')).toBeGreaterThanOrEqual(6);
  });

  it('returns 0 for empty input', () => {
    expect(countSyllables('')).toBe(0);
  });

  it('never returns 0 for a real word', () => {
    expect(countSyllables('rhythm')).toBeGreaterThan(0);
  });
});

describe('layoutLines', () => {
  it('starts the first line at the top of the loop', () => {
    const lines = layoutLines(['a', 'b', 'c', 'd'], 4);
    expect(lines[0].beat).toBe(0);
  });

  it('spaces lines evenly across the loop', () => {
    const lines = layoutLines(['a', 'b', 'c', 'd'], 4);
    const gaps = lines.slice(1).map((l, i) => l.beat - lines[i].beat);
    expect(new Set(gaps).size).toBe(1);
  });

  it('keeps every line inside the loop', () => {
    const lines = layoutLines(['a', 'b', 'c', 'd'], 2);
    for (const l of lines) {
      expect(l.beat).toBeLessThan(2 * 4);
    }
  });

  it('records syllable counts', () => {
    const [line] = layoutLines(['hello world'], 4);
    expect(line.syllables).toBeGreaterThan(2);
  });

  it('handles an empty list', () => {
    expect(layoutLines([], 4)).toEqual([]);
  });
});

describe('parseLyricResponse', () => {
  it('parses a well-formed response', () => {
    const set = parseLyricResponse(
      { lines: ['one', 'two', 'three', 'four'], hook: 'the hook', mood: 'warm' },
      4,
    );
    expect(set).not.toBeNull();
    expect(set!.lines).toHaveLength(4);
    expect(set!.hook).toBe('the hook');
    expect(set!.source).toBe('gemma');
  });

  it('truncates lines too long to sing', () => {
    const long = 'a'.repeat(80);
    const set = parseLyricResponse({ lines: [long] }, 4)!;
    expect(set.lines[0].text.length).toBeLessThanOrEqual(48);
  });

  it('caps at four lines', () => {
    const set = parseLyricResponse({ lines: ['1', '2', '3', '4', '5', '6'] }, 4)!;
    expect(set.lines).toHaveLength(4);
  });

  it('falls back to the first line when no hook is given', () => {
    const set = parseLyricResponse({ lines: ['first', 'second'] }, 4)!;
    expect(set.hook).toBe('first');
  });

  it('drops empty lines', () => {
    const set = parseLyricResponse({ lines: ['real', '', '   ', 'also real'] }, 4)!;
    expect(set.lines).toHaveLength(2);
  });

  it('returns null when nothing usable is present', () => {
    expect(parseLyricResponse({ lines: [] }, 4)).toBeNull();
    expect(parseLyricResponse(null, 4)).toBeNull();
    expect(parseLyricResponse('nope', 4)).toBeNull();
  });
});

describe('buildFallbackLyrics', () => {
  it('writes about the captured objects', () => {
    const set = buildFallbackLyrics(OBJECTS, PLAN);
    const all = set.lines.map((l) => l.text).join(' ').toLowerCase();
    expect(all).toContain('mug');
  });

  it('gives different styles different words', () => {
    const chill = buildFallbackLyrics(OBJECTS, PLAN);
    const rock = buildFallbackLyrics(OBJECTS, { ...PLAN, style: 'rock' });
    expect(chill.lines[0].text).not.toBe(rock.lines[0].text);
  });

  it('always produces four singable lines', () => {
    for (const style of ['chill', 'jazz', 'lofi', 'cinematic', 'edm', 'rock'] as const) {
      const set = buildFallbackLyrics(OBJECTS, { ...PLAN, style });
      expect(set.lines).toHaveLength(4);
      for (const l of set.lines) {
        expect(l.text.length).toBeGreaterThan(0);
        expect(l.syllables).toBeLessThan(20);
      }
    }
  });

  it('works with no objects captured', () => {
    const set = buildFallbackLyrics([], PLAN);
    expect(set.lines).toHaveLength(4);
  });
});

describe('buildLyricPrompt', () => {
  it('names the real objects', () => {
    const p = buildLyricPrompt(OBJECTS, PLAN);
    expect(p).toContain('Mug');
    expect(p).toContain('Table');
  });

  it('states a syllable budget', () => {
    expect(buildLyricPrompt(OBJECTS, PLAN)).toMatch(/\d+ syllables/);
  });

  it('demands JSON only', () => {
    expect(buildLyricPrompt(OBJECTS, PLAN).toLowerCase()).toContain('only this json');
  });
});

describe('lineAtBeat', () => {
  const set = buildFallbackLyrics(OBJECTS, PLAN);

  it('returns the first line at the loop start', () => {
    expect(lineAtBeat(set, 0, 4)).toBe(0);
  });

  it('advances as the loop progresses', () => {
    const early = lineAtBeat(set, 1, 4);
    const late = lineAtBeat(set, 13, 4);
    expect(late).toBeGreaterThanOrEqual(early);
  });

  it('wraps around the loop', () => {
    expect(lineAtBeat(set, 16, 4)).toBe(lineAtBeat(set, 0, 4));
  });
});

describe('generateLyrics', () => {
  afterEach(() => registerGemmaRuntime(null));

  it('falls back when no model is loaded', async () => {
    const r = await generateLyrics(OBJECTS, PLAN, null);
    expect(r.usedFallback).toBe(true);
    expect(r.lyrics.lines).toHaveLength(4);
    expect(r.error).toContain('no on-device model');
  });

  it('uses a valid model response', async () => {
    registerGemmaRuntime({
      name: 'mock',
      isReady: () => true,
      generate: async () =>
        '{"lines":["one","two","three","four"],"hook":"hooky","mood":"bright"}',
    });
    const r = await generateLyrics(OBJECTS, PLAN, null);
    expect(r.usedFallback).toBe(false);
    expect(r.lyrics.hook).toBe('hooky');
  });

  it('falls back when the model returns prose', async () => {
    registerGemmaRuntime({
      name: 'mock',
      isReady: () => true,
      generate: async () => 'Here are some lovely lyrics for you!',
    });
    const r = await generateLyrics(OBJECTS, PLAN, null);
    expect(r.usedFallback).toBe(true);
    expect(r.lyrics.lines).toHaveLength(4);
  });

  it('falls back when the model throws', async () => {
    registerGemmaRuntime({
      name: 'mock',
      isReady: () => true,
      generate: async () => {
        throw new Error('oom');
      },
    });
    const r = await generateLyrics(OBJECTS, PLAN, null);
    expect(r.usedFallback).toBe(true);
  });
});
