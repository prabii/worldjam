import { extractJson, validatePlan } from '@/ai/schema';
import { buildFallbackPlan, restylePlan } from '@/ai/fallbackArranger';
import { buildPrompt, generatePlan, parseStyleCommand, registerGemmaRuntime } from '@/ai/gemma';
import type { GemmaRuntime } from '@/ai/gemma';
import type { WorldJamObject } from '@/types';

function obj(label: string, role: WorldJamObject['role'] = 'perc'): WorldJamObject {
  return {
    id: `id-${label}`,
    label,
    category: 'unknown',
    slot: 0,
    position: { x: 0.5, y: 0.5 },
    features: {
      duration: 0.3,
      energy: 0.5,
      brightness: 1200,
      decay: 0.2,
      pitch: null,
      tonality: 0.1,
    },
    role,
    beatPattern: [],
    volume: 1,
    pan: 0.5,
    color: '#fff',
    createdAt: 0,
  };
}

const OBJECTS = [obj('Cup', 'hat'), obj('Table', 'kick')];

describe('extractJson', () => {
  it('parses a bare object', () => {
    expect(extractJson('{"bpm":90}')).toEqual({ bpm: 90 });
  });

  it('pulls JSON out of a fenced code block', () => {
    expect(extractJson('Here you go:\n```json\n{"bpm":100}\n```\nEnjoy!')).toEqual({
      bpm: 100,
    });
  });

  it('pulls JSON out of surrounding prose', () => {
    expect(extractJson('Sure! {"bpm":110} That should swing.')).toEqual({ bpm: 110 });
  });

  it('handles nested objects', () => {
    const out = extractJson('{"a":{"b":[1,2]},"c":3}');
    expect(out).toEqual({ a: { b: [1, 2] }, c: 3 });
  });

  it('is not fooled by braces inside strings', () => {
    expect(extractJson('{"note":"a } brace","bpm":90}')).toEqual({
      note: 'a } brace',
      bpm: 90,
    });
  });

  it('returns null when there is no JSON at all', () => {
    expect(extractJson('I cannot help with that.')).toBeNull();
  });

  it('returns null for malformed JSON rather than throwing', () => {
    expect(extractJson('{"bpm": }')).toBeNull();
  });
});

describe('validatePlan', () => {
  const good = {
    bpm: 92,
    bars: 4,
    objectPattern: [
      { object: 'cup', beats: [1, 3] },
      { object: 'table', beats: [2, 4] },
    ],
    voiceRole: 'lead',
    accompaniment: ['bass'],
    style: 'jazz',
  };

  it('accepts a well-formed plan', () => {
    const { plan, repairs } = validatePlan(good, OBJECTS, 92);
    expect(plan).not.toBeNull();
    expect(plan!.bpm).toBe(92);
    expect(plan!.objectPattern).toHaveLength(2);
    expect(repairs).toHaveLength(0);
  });

  it('resolves object names case-insensitively to real labels', () => {
    const { plan } = validatePlan(good, OBJECTS, 92);
    expect(plan!.objectPattern.map((p) => p.object).sort()).toEqual(['Cup', 'Table']);
  });

  it('drops a hallucinated object instead of trying to play it', () => {
    const { plan, repairs } = validatePlan(
      { ...good, objectPattern: [...good.objectPattern, { object: 'drum kit', beats: [1] }] },
      OBJECTS,
      92,
    );
    expect(plan!.objectPattern).toHaveLength(2);
    expect(repairs.some((r) => r.includes('drum kit'))).toBe(true);
  });

  it('folds an out-of-range tempo into a musical range', () => {
    const { plan, repairs } = validatePlan({ ...good, bpm: 240 }, OBJECTS, 92);
    expect(plan!.bpm).toBe(120);
    expect(repairs.some((r) => r.includes('240'))).toBe(true);
  });

  it('substitutes the hint when bpm is missing', () => {
    const { bpm, ...noBpm } = good;
    const { plan, repairs } = validatePlan(noBpm, OBJECTS, 105);
    expect(plan!.bpm).toBe(105);
    expect(repairs.some((r) => r.includes('bpm'))).toBe(true);
  });

  it('clamps beats to inside the bar', () => {
    const { plan } = validatePlan(
      { ...good, objectPattern: [{ object: 'cup', beats: [0, 2, 9] }] },
      OBJECTS,
      92,
    );
    for (const b of plan!.objectPattern[0].beats) {
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(4);
    }
  });

  it('rejects an unusable bar count', () => {
    const { plan, repairs } = validatePlan({ ...good, bars: 7 }, OBJECTS, 92);
    expect(plan!.bars).toBe(4);
    expect(repairs.some((r) => r.includes('bars'))).toBe(true);
  });

  it('strips unsupported accompaniment layers', () => {
    const { plan, repairs } = validatePlan(
      { ...good, accompaniment: ['bass', 'didgeridoo'] },
      OBJECTS,
      92,
    );
    expect(plan!.accompaniment).toEqual(['bass']);
    expect(repairs.length).toBeGreaterThan(0);
  });

  it('defaults an unknown style to natural', () => {
    const { plan } = validatePlan({ ...good, style: 'polka' }, OBJECTS, 92);
    expect(plan!.style).toBe('chill');
  });

  it('returns null when nothing playable survives', () => {
    const { plan } = validatePlan(
      { ...good, objectPattern: [{ object: 'nonexistent', beats: [1] }] },
      OBJECTS,
      92,
    );
    expect(plan).toBeNull();
  });

  it('returns null for a non-object response', () => {
    expect(validatePlan('nope', OBJECTS, 92).plan).toBeNull();
    expect(validatePlan(null, OBJECTS, 92).plan).toBeNull();
  });

  it('marks a validated plan as coming from the model', () => {
    expect(validatePlan(good, OBJECTS, 92).plan!.source).toBe('gemma');
  });
});

describe('buildFallbackPlan', () => {
  it('produces a playable plan for every object with a role pattern', () => {
    const plan = buildFallbackPlan(OBJECTS, 'chill');
    expect(plan.objectPattern.length).toBeGreaterThan(0);
    expect(plan.source).toBe('fallback');
    expect(plan.bpm).toBeGreaterThanOrEqual(60);
    expect(plan.bpm).toBeLessThanOrEqual(180);
  });

  it('is deterministic, so a rehearsed demo repeats exactly', () => {
    expect(buildFallbackPlan(OBJECTS, 'jazz')).toEqual(buildFallbackPlan(OBJECTS, 'jazz'));
  });

  it('gives different styles different feels', () => {
    const natural = buildFallbackPlan(OBJECTS, 'chill');
    const jazz = buildFallbackPlan(OBJECTS, 'jazz');
    expect(jazz.bpm).not.toBe(natural.bpm);
  });

  it('offsets two objects sharing a role so they do not play in unison', () => {
    const twins = [obj('Cup A', 'hat'), obj('Cup B', 'hat')];
    const plan = buildFallbackPlan(twins, 'chill');
    const [a, b] = plan.objectPattern;
    expect(a.beats).not.toEqual(b.beats);
  });

  it('keeps offset beats inside the bar', () => {
    const many = [obj('A', 'hat'), obj('B', 'hat'), obj('C', 'hat')];
    for (const entry of buildFallbackPlan(many, 'rock').objectPattern) {
      for (const beat of entry.beats) {
        expect(beat).toBeGreaterThanOrEqual(1);
        expect(beat).toBeLessThan(5);
      }
    }
  });

  it('honours a tempo hint when it is musical', () => {
    expect(buildFallbackPlan(OBJECTS, 'chill', 104).bpm).toBe(104);
  });

  it('ignores an absurd tempo hint', () => {
    expect(buildFallbackPlan(OBJECTS, 'chill', 900).bpm).toBeLessThanOrEqual(180);
  });

  it('copes with no objects at all', () => {
    expect(buildFallbackPlan([], 'chill').objectPattern).toEqual([]);
  });
});

describe('restylePlan', () => {
  it('changes the feel while keeping the same objects', () => {
    const base = buildFallbackPlan(OBJECTS, 'chill');
    const jazzed = restylePlan(base, OBJECTS, 'jazz');

    expect(jazzed.style).toBe('jazz');
    expect(jazzed.objectPattern.map((p) => p.object).sort()).toEqual(
      base.objectPattern.map((p) => p.object).sort(),
    );
    // The whole point of a restyle: the rhythm actually differs.
    expect(jazzed.objectPattern).not.toEqual(base.objectPattern);
  });
});

describe('parseStyleCommand', () => {
  it.each([
    ['make it jazz', 'jazz'],
    ['can you make this more lo-fi', 'lofi'],
    ['give it a cinematic feel', 'cinematic'],
    ['more techno please', 'edm'],
    ['give me edm', 'edm'],
    ['turn it into rock', 'rock'],
    ['back to chill', 'chill'],
    ['make it natural again', 'chill'],
  ])('maps "%s" to %s', (input, expected) => {
    expect(parseStyleCommand(input)).toBe(expected);
  });

  it('returns null for an unrelated instruction', () => {
    expect(parseStyleCommand('add more cowbell')).toBeNull();
  });
});

describe('buildPrompt', () => {
  it('lists the real objects and forbids inventing new ones', () => {
    const prompt = buildPrompt({
      objects: OBJECTS,
      vocal: null,
      bpmHint: 92,
      style: 'jazz',
    });
    expect(prompt).toContain('Cup');
    expect(prompt).toContain('Table');
    expect(prompt).toContain('Never invent an object');
  });

  it('includes a user instruction when given', () => {
    const prompt = buildPrompt(
      { objects: OBJECTS, vocal: null, bpmHint: null, style: 'chill' },
      'make it jazz',
    );
    expect(prompt).toContain('make it jazz');
  });
});

describe('generatePlan', () => {
  afterEach(() => registerGemmaRuntime(null));

  const snapshot = {
    objects: OBJECTS,
    vocal: null,
    bpmHint: 92,
    style: 'chill' as const,
  };

  it('falls back when no runtime is registered', async () => {
    const result = await generatePlan(snapshot);
    expect(result.usedFallback).toBe(true);
    expect(result.plan.source).toBe('fallback');
    expect(result.plan.objectPattern.length).toBeGreaterThan(0);
  });

  it('uses a valid model response', async () => {
    registerGemmaRuntime({
      name: 'mock',
      isReady: () => true,
      generate: async () =>
        '{"bpm":100,"bars":4,"objectPattern":[{"object":"cup","beats":[1,3]}],"voiceRole":"lead","accompaniment":["bass"],"style":"jazz"}',
    } satisfies GemmaRuntime);

    const result = await generatePlan(snapshot);
    expect(result.usedFallback).toBe(false);
    expect(result.plan.bpm).toBe(100);
    expect(result.plan.source).toBe('gemma');
  });

  it('falls back when the model returns prose', async () => {
    registerGemmaRuntime({
      name: 'mock',
      isReady: () => true,
      generate: async () => 'I think a nice swing feel would work here.',
    });
    const result = await generatePlan(snapshot);
    expect(result.usedFallback).toBe(true);
    expect(result.error).toContain('JSON');
  });

  it('falls back when the model throws', async () => {
    registerGemmaRuntime({
      name: 'mock',
      isReady: () => true,
      generate: async () => {
        throw new Error('model crashed');
      },
    });
    const result = await generatePlan(snapshot);
    expect(result.usedFallback).toBe(true);
    expect(result.plan.objectPattern.length).toBeGreaterThan(0);
  });

  it('never blocks the loop when the model hangs', async () => {
    // Tracked so the pending timer can be cleared; otherwise it outlives the
    // test and Jest cannot exit cleanly.
    let hang: ReturnType<typeof setTimeout> | undefined;
    registerGemmaRuntime({
      name: 'slow',
      isReady: () => true,
      // Longer than PLAN_TIMEOUT_MS; the timeout must win.
      generate: () =>
        new Promise((resolve) => {
          // Longer than PLAN_TIMEOUT_MS (25 s) so the timeout must win.
          hang = setTimeout(() => resolve('{}'), 60_000);
        }),
    });

    const started = Date.now();
    const result = await generatePlan(snapshot);
    const elapsed = Date.now() - started;

    expect(result.usedFallback).toBe(true);
    expect(result.error).toContain('timed out');
    // The point is that it returns rather than hanging forever, not that it
    // is fast: a phone-CPU model legitimately needs tens of seconds.
    expect(elapsed).toBeLessThan(30_000);

    if (hang) clearTimeout(hang);
  }, 40_000);

  it('falls back when there are no objects yet', async () => {
    const result = await generatePlan({ ...snapshot, objects: [] });
    expect(result.usedFallback).toBe(true);
    expect(result.error).toContain('no objects');
  });
});
