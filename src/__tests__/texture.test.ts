import {
  MAX_TEXTURE_SECONDS,
  buildTexturePrompt,
  sanitiseTexture,
  textureBars,
  textureEvents,
  textureSeconds,
  textureSeed,
} from '@/audio/texture';
import { validatePlan } from '@/ai/schema';
import type { WorldJamObject } from '@/types';

describe('texture length', () => {
  it('uses the longest whole bar count that fits one generation', () => {
    expect(textureBars(80)).toBe(2); // 4 bars would be 12 s
    expect(textureBars(126)).toBe(4); // 7.6 s
    expect(textureBars(62)).toBe(2); // 7.7 s
    expect(textureBars(40)).toBe(1);
  });

  it('never asks the model for more than it can make', () => {
    for (let bpm = 40; bpm <= 200; bpm++) {
      expect(textureSeconds(bpm)).toBeLessThanOrEqual(MAX_TEXTURE_SECONDS);
    }
  });

  it('is an exact number of bars, so it stays in time as it repeats', () => {
    expect(textureSeconds(80)).toBeCloseTo(6, 6);
    expect(textureSeconds(120)).toBeCloseTo(8, 6);
  });
});

describe('textureEvents', () => {
  it('re-fires on the bar line across the whole song', () => {
    expect(textureEvents(80, 8).map((e) => e.beat)).toEqual([0, 8, 16, 24]);
    expect(textureEvents(126, 8).map((e) => e.beat)).toEqual([0, 16]);
  });

  it('addresses the texture slot, not an object', () => {
    expect(textureEvents(90, 4).every((e) => e.objectId === 'texture')).toBe(true);
  });
});

describe('buildTexturePrompt', () => {
  it('uses the model description and adds tempo, key and no drums', () => {
    const p = buildTexturePrompt('lofi', 80, 'C minor', 'dusty vinyl chord pad, warm');
    expect(p).toBe('dusty vinyl chord pad, warm, no drums, 80 BPM, C minor');
  });

  it('falls back to a style default when the model gave none', () => {
    const p = buildTexturePrompt('cinematic', 70, null, undefined);
    expect(p).toMatch(/string/);
    expect(p).toMatch(/70 BPM/);
  });

  it('does not repeat what the description already says', () => {
    const p = buildTexturePrompt('edm', 126, null, 'supersaw pad, no drums, 126 BPM');
    expect(p.match(/no drums/g)).toHaveLength(1);
    expect(p.match(/BPM/g)).toHaveLength(1);
  });
});

describe('sanitiseTexture', () => {
  it('rejects non-strings and near-empty text', () => {
    expect(sanitiseTexture(42)).toBeNull();
    expect(sanitiseTexture(' ')).toBeNull();
  });

  it('strips characters that could break out of the prompt, and caps length', () => {
    expect(sanitiseTexture('warm "pad"\n{x}')).toBe('warm pad x');
    expect(sanitiseTexture('a'.repeat(300))!.length).toBe(100);
  });
});

describe('textureSeed', () => {
  it('is stable per prompt and differs across prompts', () => {
    expect(textureSeed('warm pad')).toBe(textureSeed('warm pad'));
    expect(textureSeed('warm pad')).not.toBe(textureSeed('cold pad'));
  });
});

describe('schema keeps a model-written texture', () => {
  const cup: WorldJamObject = {
    id: 'c',
    label: 'Cup',
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

  it('accepts and sanitises it', () => {
    const { plan } = validatePlan(
      {
        bpm: 80,
        bars: 8,
        objectPattern: [{ object: 'Cup', beats: [1, 3] }],
        voiceRole: 'none',
        accompaniment: ['bass'],
        texture: 'dusty "vinyl" pad',
        style: 'lofi',
      },
      [cup],
      80,
    );
    expect(plan?.texture).toBe('dusty vinyl pad');
  });

  it('leaves it undefined when the model omitted it', () => {
    const { plan } = validatePlan(
      { bpm: 80, bars: 8, objectPattern: [{ object: 'Cup', beats: [1] }], style: 'lofi' },
      [cup],
      80,
    );
    expect(plan?.texture).toBeUndefined();
  });
});
