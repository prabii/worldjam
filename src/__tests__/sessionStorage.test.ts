import { __internal } from '@/state/sessionStorage';

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  readDirectoryAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

const { pcmToBase64, base64ToPcm } = __internal;

/**
 * The PCM codec is the part worth testing here: a round-trip error would
 * silently corrupt every saved recording, and the damage would only surface
 * when a user reloaded a session and heard noise.
 */
describe('PCM base64 codec', () => {
  it('round-trips a simple signal', () => {
    const original = [0, 0.5, -0.5, 1, -1, 0.25];
    const back = base64ToPcm(pcmToBase64(original));

    expect(back).toHaveLength(original.length);
    for (let i = 0; i < original.length; i++) {
      // 16-bit quantisation: ~3e-5 per step.
      expect(back[i]).toBeCloseTo(original[i], 3);
    }
  });

  it('round-trips a sine wave', () => {
    const original = Array.from({ length: 1000 }, (_, i) =>
      Math.sin((2 * Math.PI * 440 * i) / 48000),
    );
    const back = base64ToPcm(pcmToBase64(original));

    expect(back).toHaveLength(original.length);
    let maxErr = 0;
    for (let i = 0; i < original.length; i++) {
      maxErr = Math.max(maxErr, Math.abs(back[i] - original[i]));
    }
    expect(maxErr).toBeLessThan
      ? expect(maxErr).toBeLessThan(0.001)
      : expect(maxErr).toBeLessThan(0.001);
  });

  it('clamps out-of-range samples rather than wrapping', () => {
    const back = base64ToPcm(pcmToBase64([2, -2]));
    expect(back[0]).toBeCloseTo(1, 2);
    expect(back[1]).toBeCloseTo(-1, 2);
  });

  it('handles an empty buffer', () => {
    expect(base64ToPcm(pcmToBase64([]))).toEqual([]);
  });

  it('handles lengths that are not multiples of three bytes', () => {
    // Base64 pads in groups of 3 bytes; these lengths exercise both paddings.
    for (const n of [1, 2, 3, 4, 5]) {
      const original = Array.from({ length: n }, (_, i) => (i % 2 ? 0.5 : -0.5));
      const back = base64ToPcm(pcmToBase64(original));
      expect(back).toHaveLength(n);
      expect(back[0]).toBeCloseTo(original[0], 3);
    }
  });

  it('produces valid base64 characters only', () => {
    const encoded = pcmToBase64([0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(encoded).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
  });

  it('is meaningfully smaller than JSON would be', () => {
    const pcm = Array.from({ length: 5000 }, (_, i) => Math.sin(i / 20));
    const asJson = JSON.stringify(pcm).length;
    const asBase64 = pcmToBase64(pcm).length;
    // 16-bit base64 should be a fraction of full-precision JSON floats.
    expect(asBase64).toBeLessThan(asJson / 3);
  });

  it('preserves silence exactly', () => {
    const back = base64ToPcm(pcmToBase64(new Array(100).fill(0)));
    expect(back.every((v) => v === 0)).toBe(true);
  });
});
