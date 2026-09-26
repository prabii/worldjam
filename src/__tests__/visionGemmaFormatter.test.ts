import {
  buildReadoutPrompt,
  formatWithGemma,
  validateReadout,
  type CompactVisionEvent,
  type TextRuntime,
} from '@/vision/services/gemmaReadoutFormatter';

const laptopRight: CompactVisionEvent = { primary: 'Laptop', direction: 'right', additionalObjectCount: 3 };

const runtime = (answer: string | Promise<string>, ready = true): TextRuntime => ({
  isReady: () => ready,
  generate: () => Promise.resolve(answer),
});

describe('vision Gemma read-out formatter', () => {
  it('builds a prompt from the compact event only', () => {
    const p = buildReadoutPrompt(laptopRight);
    expect(p).toContain('"primary":"Laptop"');
    expect(p).toContain('"direction":"right"');
    expect(p).toContain('"additionalObjectCount":3');
    expect(p).not.toMatch(/bbox|confidence":/);
  });

  it('accepts a short sentence that names the object', () => {
    expect(validateReadout('Laptop slightly to your right, with three other objects nearby', laptopRight)).toBe(
      'Laptop slightly to your right, with three other objects nearby.',
    );
  });

  it('strips template noise and quotes', () => {
    expect(validateReadout('"A laptop is on your right."<turn|>', laptopRight)).toBe('A laptop is on your right.');
  });

  it('rejects answers that invent distances, colours or wrong counts', () => {
    expect(validateReadout('Laptop two meters to your right.', laptopRight)).toBeNull();
    expect(validateReadout('A black laptop on your right.', laptopRight)).toBeNull();
    expect(validateReadout('Laptop on your right with 5 objects.', laptopRight)).toBeNull();
    expect(validateReadout('Laptop on your right with 3 other objects.', laptopRight)).not.toBeNull();
  });

  it('rejects answers that do not name the object or are too long', () => {
    expect(validateReadout('Something is on your right.', laptopRight)).toBeNull();
    expect(validateReadout(`Laptop ${'very '.repeat(20)}close.`, laptopRight)).toBeNull();
    expect(validateReadout('   ', laptopRight)).toBeNull();
  });

  it('returns null without a ready runtime (native then speaks the direct text)', async () => {
    await expect(formatWithGemma(laptopRight, null, 500)).resolves.toBeNull();
    await expect(formatWithGemma(laptopRight, runtime('Laptop on your right.', false), 500)).resolves.toBeNull();
  });

  it('returns the validated sentence from the runtime', async () => {
    await expect(formatWithGemma(laptopRight, runtime('Laptop on your right.'), 500)).resolves.toBe(
      'Laptop on your right.',
    );
  });

  it('gives up at the timeout', async () => {
    const slow: TextRuntime = {
      isReady: () => true,
      generate: () => new Promise((resolve) => setTimeout(() => resolve('Laptop on your right.'), 1000)),
    };
    const started = Date.now();
    await expect(formatWithGemma(laptopRight, slow, 50)).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(900);
  });

  it('treats a throwing runtime as no answer', async () => {
    const broken: TextRuntime = { isReady: () => true, generate: () => Promise.reject(new Error('boom')) };
    await expect(formatWithGemma(laptopRight, broken, 500)).resolves.toBeNull();
  });
});
