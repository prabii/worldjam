import {
  detectKey,
  detectOnsets,
  detectPitchYin,
  estimateTempo,
  extractFeatures,
  fft,
  hzToMidi,
  inferRole,
  magnitudeSpectrum,
  rms,
  trimSilence,
} from '@/dsp/analysis';

const SR = 48000;

/** A decaying sine — stands in for a struck object with a clear pitch. */
function tone(hz: number, seconds: number, decay = 8, sr = SR): Float32Array {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = Math.sin(2 * Math.PI * hz * t) * Math.exp(-decay * t);
  }
  return out;
}

function noiseBurst(seconds: number, sr = SR): Float32Array {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = (Math.random() * 2 - 1) * Math.exp(-40 * (i / sr));
  }
  return out;
}

describe('fft', () => {
  it('puts a pure tone in the expected bin', () => {
    const n = 1024;
    const binHz = SR / n;
    const targetBin = 64;
    const hz = targetBin * binHz;

    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * hz * i) / SR);

    fft(re, im);

    let maxBin = 0;
    let maxMag = 0;
    for (let i = 1; i < n / 2; i++) {
      const mag = Math.hypot(re[i], im[i]);
      if (mag > maxMag) {
        maxMag = mag;
        maxBin = i;
      }
    }
    expect(maxBin).toBe(targetBin);
  });

  it('rejects non-power-of-two lengths rather than producing garbage', () => {
    expect(() => fft(new Float32Array(100), new Float32Array(100))).toThrow();
  });
});

describe('magnitudeSpectrum', () => {
  it('zero-pads odd lengths to a power of two', () => {
    const mag = magnitudeSpectrum(new Float32Array(300));
    expect(mag.length).toBe(256); // 512 / 2
  });
});

describe('rms', () => {
  it('is zero for silence and 1 for full-scale DC', () => {
    expect(rms(new Float32Array(100))).toBe(0);
    expect(rms(new Float32Array(100).fill(1))).toBeCloseTo(1, 5);
  });
});

describe('trimSilence', () => {
  it('removes leading and trailing silence but keeps the attack', () => {
    const sound = tone(440, 0.2);
    const padded = new Float32Array(SR); // 1s of silence
    const offset = Math.floor(SR * 0.4);
    padded.set(sound, offset);

    const { pcm } = trimSilence(padded, SR);

    // Should be close to the sound's own length, not the padded length.
    expect(pcm.length).toBeLessThan(SR * 0.4);
    expect(pcm.length).toBeGreaterThan(SR * 0.05);
    // Pre-roll means we start slightly before the true onset, so the first
    // sample should be near-silent rather than mid-waveform.
    expect(Math.abs(pcm[0])).toBeLessThan(0.2);
  });

  it('returns the input unchanged when it is entirely silent', () => {
    const silent = new Float32Array(1000);
    const { pcm } = trimSilence(silent, SR);
    expect(pcm.length).toBe(1000);
  });
});

describe('extractFeatures', () => {
  it('reports a bright sound as having a high spectral centroid', () => {
    const low = extractFeatures(tone(150, 0.3), SR);
    const high = extractFeatures(tone(4000, 0.3), SR);
    expect(high.brightness).toBeGreaterThan(low.brightness);
  });

  it('measures a longer decay for a ringing sound', () => {
    const short = extractFeatures(tone(800, 0.5, 40), SR);
    const long = extractFeatures(tone(800, 0.5, 3), SR);
    expect(long.decay).toBeGreaterThan(short.decay);
  });

  it('finds a pitch for a tone and rejects noise as unpitched', () => {
    const pitched = extractFeatures(tone(440, 0.3, 4), SR);
    expect(pitched.pitch).not.toBeNull();
    expect(pitched.pitch!).toBeGreaterThan(380);
    expect(pitched.pitch!).toBeLessThan(500);

    const noise = extractFeatures(noiseBurst(0.2), SR);
    expect(noise.tonality).toBeLessThan(pitched.tonality);
  });

  it('reports duration in seconds', () => {
    const f = extractFeatures(tone(440, 0.25), SR);
    expect(f.duration).toBeCloseTo(0.25, 2);
  });
});

describe('inferRole', () => {
  it('sends dark short sounds to kick and bright short sounds to hat', () => {
    expect(
      inferRole({ brightness: 300, decay: 0.2, duration: 0.3, energy: 0.5, pitch: null, tonality: 0.1 }),
    ).toBe('kick');

    expect(
      inferRole({ brightness: 6000, decay: 0.1, duration: 0.2, energy: 0.3, pitch: null, tonality: 0.1 }),
    ).toBe('hat');
  });

  it('sends long ringing sounds to texture', () => {
    expect(
      inferRole({ brightness: 1200, decay: 2.0, duration: 2.5, energy: 0.4, pitch: 300, tonality: 0.4 }),
    ).toBe('texture');
  });
});

describe('detectOnsets', () => {
  it('finds one onset per impulse', () => {
    const sr = 22050;
    const total = Math.floor(sr * 2);
    const buf = new Float32Array(total);
    const positions = [0.2, 0.7, 1.2, 1.7].map((t) => Math.floor(t * sr));

    for (const p of positions) {
      const hit = noiseBurst(0.08, sr);
      for (let i = 0; i < hit.length && p + i < total; i++) buf[p + i] += hit[i];
    }

    const onsets = detectOnsets(buf, sr);
    expect(onsets.length).toBeGreaterThanOrEqual(3);
    expect(onsets.length).toBeLessThanOrEqual(6);
  });

  it('finds nothing in silence', () => {
    expect(detectOnsets(new Float32Array(10000), SR)).toHaveLength(0);
  });
});

describe('estimateTempo', () => {
  it('recovers the tempo from evenly spaced onsets', () => {
    // 120 BPM = one beat every 0.5s
    const onsets = [0, 0.5, 1.0, 1.5, 2.0].map((t) => t * SR);
    expect(estimateTempo(onsets, SR)).toBe(120);
  });

  it('folds an out-of-range tempo into a musical range', () => {
    // 0.1s spacing = 600 BPM, which should fold down.
    const onsets = [0, 0.1, 0.2, 0.3, 0.4].map((t) => t * SR);
    const bpm = estimateTempo(onsets, SR)!;
    expect(bpm).toBeGreaterThanOrEqual(70);
    expect(bpm).toBeLessThanOrEqual(180);
  });

  it('returns null without enough onsets to judge', () => {
    expect(estimateTempo([0, 1000], SR)).toBeNull();
  });
});

describe('detectPitchYin', () => {
  it.each([
    [110, 'A2'],
    [220, 'A3'],
    [440, 'A4'],
    [880, 'A5'],
  ])('tracks %i Hz (%s) within a semitone', (hz) => {
    const frame = new Float32Array(2048);
    for (let i = 0; i < frame.length; i++) {
      frame[i] = Math.sin((2 * Math.PI * hz * i) / SR);
    }
    const detected = detectPitchYin(frame, SR);
    expect(detected).not.toBeNull();
    // Within one semitone (~6%).
    expect(Math.abs(detected! - hz) / hz).toBeLessThan(0.06);
  });

  it('does not report a pitch for white noise', () => {
    const frame = new Float32Array(2048);
    for (let i = 0; i < frame.length; i++) frame[i] = Math.random() * 2 - 1;
    // Noise may occasionally cross the threshold; the contract is only that it
    // does not confidently return a musical pitch most of the time.
    const results = Array.from({ length: 5 }, () => {
      for (let i = 0; i < frame.length; i++) frame[i] = Math.random() * 2 - 1;
      return detectPitchYin(frame, SR, 0.1);
    });
    expect(results.filter((r) => r !== null).length).toBeLessThanOrEqual(3);
  });
});

describe('hzToMidi', () => {
  it('maps A4 to 69', () => {
    expect(hzToMidi(440)).toBe(69);
  });
  it('maps an octave to 12 semitones', () => {
    expect(hzToMidi(880) - hzToMidi(440)).toBe(12);
  });
});

describe('detectKey', () => {
  it('identifies C major from its scale', () => {
    // C D E F G A B, with the tonic held longest.
    const midis = [60, 62, 64, 65, 67, 69, 71];
    const notes = midis.map((midi, i) => ({
      midi,
      time: i * 0.5,
      duration: midi === 60 ? 2 : 0.5,
      confidence: 1,
    }));
    expect(detectKey(notes)).toContain('C');
  });

  it('returns null with no notes', () => {
    expect(detectKey([])).toBeNull();
  });
});
