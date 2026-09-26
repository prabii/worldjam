import { buildPrompt } from '@/ai/gemma';
import type { WorldJamObject } from '@/types';

/**
 * These lock in the Gemma 4 chat template.
 *
 * Gemma 4 uses `<|turn>role ... <turn|>`, NOT the `<start_of_turn>` markers of
 * Gemma 2/3. Getting this wrong does not throw — the model simply produces
 * worse output, which is the hardest kind of bug to notice during a demo. The
 * expected strings here were read from the GGUF's own metadata.
 */

// Imported lazily so the test file does not pull in llama.rn's native binding,
// which cannot load under Jest.
const { formatGemmaPrompt, GEMMA4_STOPS } = jest.requireActual<
  typeof import('@/ai/runtimes/llamaRuntime')
>('@/ai/runtimes/llamaRuntime');

jest.mock('llama.rn', () => ({ initLlama: jest.fn() }));

function obj(label: string): WorldJamObject {
  return {
    id: `id-${label}`,
    label,
    category: 'cup',
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
    role: 'perc',
    beatPattern: [],
    volume: 1,
    pan: 0.5,
    color: '#fff',
    createdAt: 0,
  };
}

describe('formatGemmaPrompt', () => {
  it('uses the Gemma 4 turn markers', () => {
    const out = formatGemmaPrompt('hello');
    expect(out).toBe('<|turn>user\nhello<turn|>\n<|turn>model\n');
  });

  it('does not use the Gemma 2/3 markers', () => {
    const out = formatGemmaPrompt('hello');
    expect(out).not.toContain('<start_of_turn>');
    expect(out).not.toContain('<end_of_turn>');
  });

  it('opens a model turn so generation continues as the assistant', () => {
    expect(formatGemmaPrompt('x').endsWith('<|turn>model\n')).toBe(true);
  });

  it('does not open thinking mode, which would blow the latency budget', () => {
    expect(formatGemmaPrompt('x')).not.toContain('<|channel>thought');
  });

  it('preserves the prompt body verbatim', () => {
    const body = 'line one\nline two {"json": true}';
    expect(formatGemmaPrompt(body)).toContain(body);
  });
});

describe('GEMMA4_STOPS', () => {
  it('includes the turn terminator', () => {
    expect(GEMMA4_STOPS).toContain('<turn|>');
  });

  it('does not carry over Gemma 3 terminators', () => {
    expect(GEMMA4_STOPS).not.toContain('<end_of_turn>');
  });
});

describe('buildPrompt', () => {
  const snapshot = {
    objects: [obj('Mug'), obj('Table')],
    vocal: null,
    bpmHint: 92,
    style: 'chill' as const,
  };

  it('names every captured object', () => {
    const p = buildPrompt(snapshot);
    expect(p).toContain('Mug');
    expect(p).toContain('Table');
  });

  it('forbids inventing objects', () => {
    expect(buildPrompt(snapshot)).toContain('Never invent an object');
  });

  it('asks for JSON only', () => {
    expect(buildPrompt(snapshot).toLowerCase()).toContain('only this json');
  });

  it('stays compact — every token costs latency on device', () => {
    // A rough proxy for token count; the real prompt should be well under the
    // 1024-token context the runtime allocates.
    expect(buildPrompt(snapshot).length).toBeLessThan(2400);
  });


  it('carries the melody description, which is all the model knows of the tune', () => {
    const p = buildPrompt({
      ...snapshot,
      melodyDescription: 'Key: C major. Tempo around 96 BPM. The line rises.',
    });
    expect(p).toContain('C major');
    expect(p).toContain('96 BPM');
  });

  it('omits the melody line entirely when nothing was sung', () => {
    expect(buildPrompt(snapshot)).not.toContain('melody:');
  });

  it('passes reference artists through', () => {
    const p = buildPrompt({ ...snapshot, reference: 'Charlie Puth' });
    expect(p).toContain('Charlie Puth');
  });

  it('tells the model to build around the voice when there is one', () => {
    const p = buildPrompt({
      ...snapshot,
      melodyDescription: 'Key: A minor.',
    });
    expect(p.toLowerCase()).toContain('melody is present');
  });

  it('stays compact even with melody and reference attached', () => {
    const p = buildPrompt({
      ...snapshot,
      melodyDescription: 'Key: C major. Tempo around 96 BPM. 12 notes over 4.2s.',
      reference: 'Charlie Puth, Justin Bieber',
    });
    expect(p.length).toBeLessThan(3000);
  });

  it('passes a user instruction through', () => {
    expect(buildPrompt(snapshot, 'make it jazz')).toContain('make it jazz');
  });

  it('states the tempo hint when present', () => {
    expect(buildPrompt(snapshot)).toContain('92');
  });
});

describe('buildPrompt with a programmed beat', () => {
  const base = {
    objects: [obj('Mug'), obj('Table')],
    vocal: null,
    bpmHint: null,
    style: 'chill' as const,
  };

  it('hands the model the user beat as fixed, and asks it to build around it', () => {
    const p = buildPrompt({ ...base, userBeat: [{ object: 'Mug', beats: [1, 3] }] });
    expect(p).toContain('user_beat (FIXED');
    expect(p).toContain('"object":"Mug"');
    expect(p).toMatch(/ONLY for objects NOT in user_beat/);
  });

  it('says nothing about a beat when none was programmed', () => {
    expect(buildPrompt(base)).not.toContain('user_beat');
    expect(buildPrompt({ ...base, userBeat: [] })).not.toContain('user_beat');
  });
});
