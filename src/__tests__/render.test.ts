import { encodeWav, mixSession, toBase64 } from '@/audio/render';
import type { Loop, WorldJamObject } from '@/types';

const SR = 48000;

function obj(id: string, slot: number, pan = 0.5, volume = 1): WorldJamObject {
  return {
    id,
    label: id,
    category: 'unknown',
    slot,
    position: { x: pan, y: 0.5 },
    features: null,
    role: 'perc',
    beatPattern: [],
    volume,
    pan,
    color: '#fff',
    createdAt: 0,
  };
}

function click(length = 100): Float32Array {
  const a = new Float32Array(length);
  a[0] = 1;
  return a;
}

describe('mixSession', () => {
  const base = {
    objects: [obj('a', 0)],
    plan: null,
    bpm: 120,
    bars: 1,
    sampleRate: SR,
    repeats: 1,
  };

  const loop = (events: Loop['events']): Loop[] => [
    { id: 'l', name: 'l', events, bars: 1, muted: false, createdAt: 0 },
  ];

  it('places a hit at the frame its beat maps to', () => {
    const out = mixSession({
      ...base,
      samples: new Map([[0, click()]]),
      loops: loop([{ objectId: 'a', beat: 1, velocity: 1 }]),
    });

    // 120 BPM → one beat = 0.5s = 24000 frames. Interleaved stereo → index * 2.
    expect(Math.abs(out[24000 * 2])).toBeGreaterThan(0.1);
    // Nothing should be at the very start.
    expect(Math.abs(out[0])).toBeLessThan(0.01);
  });

  it('pans hard left and hard right correctly', () => {
    const left = mixSession({
      ...base,
      objects: [obj('a', 0, 0)],
      samples: new Map([[0, click()]]),
      loops: loop([{ objectId: 'a', beat: 0, velocity: 1 }]),
    });
    expect(Math.abs(left[0])).toBeGreaterThan(Math.abs(left[1]));

    const right = mixSession({
      ...base,
      objects: [obj('a', 0, 1)],
      samples: new Map([[0, click()]]),
      loops: loop([{ objectId: 'a', beat: 0, velocity: 1 }]),
    });
    expect(Math.abs(right[1])).toBeGreaterThan(Math.abs(right[0]));
  });

  it('skips muted loops', () => {
    const out = mixSession({
      ...base,
      samples: new Map([[0, click()]]),
      loops: [
        { id: 'l', name: 'l', events: [{ objectId: 'a', beat: 0, velocity: 1 }], bars: 1, muted: true, createdAt: 0 },
      ],
    });
    expect(out.every((v) => Math.abs(v) < 0.001)).toBe(true);
  });

  it('repeats the loop the requested number of times', () => {
    const out = mixSession({
      ...base,
      repeats: 2,
      samples: new Map([[0, click()]]),
      loops: loop([{ objectId: 'a', beat: 0, velocity: 1 }]),
    });
    // Loop is 1 bar = 4 beats = 2s = 96000 frames at 120 BPM.
    expect(Math.abs(out[0])).toBeGreaterThan(0.1);
    expect(Math.abs(out[96000 * 2])).toBeGreaterThan(0.1);
  });

  it('ignores events whose object is gone', () => {
    const out = mixSession({
      ...base,
      samples: new Map([[0, click()]]),
      loops: loop([{ objectId: 'ghost', beat: 0, velocity: 1 }]),
    });
    expect(out.every((v) => Math.abs(v) < 0.001)).toBe(true);
  });

  it('never exceeds full scale, even when many hits stack', () => {
    const loud = new Float32Array(100).fill(0.9);
    const out = mixSession({
      ...base,
      objects: [obj('a', 0), obj('b', 1), obj('c', 2)],
      samples: new Map([
        [0, loud],
        [1, loud],
        [2, loud],
      ]),
      loops: loop([
        { objectId: 'a', beat: 0, velocity: 1 },
        { objectId: 'b', beat: 0, velocity: 1 },
        { objectId: 'c', beat: 0, velocity: 1 },
      ]),
    });
    expect(out.every((v) => Math.abs(v) <= 1)).toBe(true);
  });

  it('resolves accompaniment layer events through the resolver', () => {
    const out = mixSession(
      {
        ...base,
        samples: new Map([[14, click()]]),
        loops: loop([{ objectId: 'layer:bass', beat: 0, velocity: 1 }]),
      },
      (layer) => (layer === 'bass' ? 14 : null),
    );
    expect(Math.abs(out[0])).toBeGreaterThan(0.1);
  });

  it('leaves tail room so the final hit is not truncated', () => {
    const longSample = new Float32Array(SR); // 1 second
    const out = mixSession({
      ...base,
      samples: new Map([[0, longSample]]),
      loops: loop([{ objectId: 'a', beat: 3, velocity: 1 }]),
    });
    // Beat 3 at 120 BPM starts at 1.5s; plus a 1s sample needs > 2.5s total.
    expect(out.length / 2).toBeGreaterThan(SR * 2.5);
  });
});

describe('encodeWav', () => {
  it('writes a valid RIFF/WAVE header', () => {
    const wav = encodeWav(new Float32Array(200), SR, 2);
    const text = (o: number, n: number) =>
      String.fromCharCode(...Array.from(wav.slice(o, o + n)));

    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(text(12, 4)).toBe('fmt ');
    expect(text(36, 4)).toBe('data');
  });

  it('sizes the buffer as header plus 16-bit samples', () => {
    const wav = encodeWav(new Float32Array(100), SR, 2);
    expect(wav.length).toBe(44 + 100 * 2);
  });

  it('records the sample rate and channel count', () => {
    const wav = encodeWav(new Float32Array(10), 44100, 2);
    const view = new DataView(wav.buffer);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16);
  });

  it('clamps out-of-range samples instead of wrapping', () => {
    const wav = encodeWav(new Float32Array([2, -2]), SR, 1);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });
});

describe('toBase64', () => {
  it.each([
    [[77, 97, 110], 'TWFu'],
    [[77, 97], 'TWE='],
    [[77], 'TQ=='],
  ])('encodes %j correctly', (bytes, expected) => {
    expect(toBase64(new Uint8Array(bytes as number[]))).toBe(expected);
  });

  it('matches Buffer for a longer payload', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('encodes an empty array as an empty string', () => {
    expect(toBase64(new Uint8Array(0))).toBe('');
  });
});
