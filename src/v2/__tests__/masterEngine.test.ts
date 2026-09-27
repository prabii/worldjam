import type { FeatureVector } from '../contracts/library';
import { formForLength, masterGenerate, type MasterSound } from '../audio/masterEngine';
import { GENRES } from '@/audio/genres';

const feat = (o: Partial<FeatureVector>): FeatureVector => ({
  durationSec: 0.6, rms: 0.2, peak: 0.9, brightness: 2000, decay: 0.2, tonality: 0.2, pitchHz: null,
  transient: 0.8, sustained: 0.1, onsetCount: 1, tempoBpm: null, suggestedRole: 'percussion', ...o,
});
const sounds: MasterSound[] = [
  { id: 'a', name: 'Table', type: 'AUDIO', role: 'kick', features: feat({ brightness: 500 }), path: '/x/a.wav', durationSec: 2, hit: { startSec: 0.2, endSec: 0.6 } },
  { id: 'b', name: 'Cup', type: 'AUDIO', role: 'snare', features: feat({ brightness: 3000 }), path: '/x/b.wav', durationSec: 2, hit: { startSec: 0.1, endSec: 0.4 } },
  { id: 'c', name: 'Keys', type: 'AUDIO', role: 'hat', features: feat({ brightness: 8000 }), path: '/x/c.wav', durationSec: 2, hit: null },
];

function deps(sa3: boolean) {
  const prompts: string[] = [];
  return {
    prompts,
    d: {
      renderStem: jest.fn(async () => ({ path: '/x/stem.wav', durationSec: 8 })),
      renderBed: jest.fn(async (prompt: string, seconds: number) => {
        prompts.push(prompt);
        return { path: `/x/bed${prompts.length}.wav`, durationSec: seconds };
      }),
      sa3,
      maxSeconds: 45,
    },
  };
}

describe('master music engine in V2', () => {
  it('plays the genre’s groove at its tempo, with genre-aware Stable Audio per section', async () => {
    const { prompts, d } = deps(true);
    const r = await masterGenerate({ sounds, words: 'phonk for a night drive', chipGenre: null, chipStyle: null, fallbackStyle: 'chill', durationSec: 30, nonce: 1 }, d);
    const phonk = GENRES.find((g) => g.id === 'phonk')!;
    expect(r.arrangement.bpm).toBeGreaterThanOrEqual(phonk.bpm[0]);
    expect(r.arrangement.bpm).toBeLessThanOrEqual(phonk.bpm[1]);
    expect(r.plan.style).toBe('phonk');
    // Drum-led genre with SA3: the model makes the backing, a synth bass keeps the weight.
    expect(r.arrangement.accompaniment).toEqual(['bass']);
    const kinds = new Set(r.form.map((f) => f.kind));
    expect(d.renderBed).toHaveBeenCalledTimes(kinds.size);
    expect(prompts[0]).toContain('phonk for a night drive');
    expect(prompts[0]).toMatch(/808|cowbell/i);
    expect(prompts[0]).toMatch(/BPM/);
    expect(prompts.some((p) => /no drums/.test(p))).toBe(false);
    // Objects play single hits.
    const table = r.graph.sources.find((s) => s.id === 'cap_a')!;
    expect(table.trimStartSec).toBe(0.2);
    expect(r.info).toMatch(/Phonk · \d+ BPM/);
  });

  it('keeps objects as the only drums for non-drum genres and fits the requested length', async () => {
    const { prompts, d } = deps(true);
    const r = await masterGenerate({ sounds, words: null, chipGenre: 'Indian classical', chipStyle: 'indian_classical', fallbackStyle: 'cinematic', durationSec: 20, nonce: 2 }, d);
    expect(r.arrangement.accompaniment).toEqual([]);
    expect(prompts.every((p) => /no drums/.test(p))).toBe(true);
    expect(prompts[0]).toMatch(/sitar|tabla|tanpura/i);
    expect(Math.abs(r.plan.durationSec - 20)).toBeLessThanOrEqual(240 / r.arrangement.bpm);
  });

  it('without Stable Audio 3 the synth accompaniment plays, per section, chorus rotated', async () => {
    const { d } = deps(false);
    const r = await masterGenerate({ sounds, words: 'lofi study', chipGenre: null, chipStyle: null, fallbackStyle: 'lofi', durationSec: 40, nonce: 3 }, { ...d, renderBed: undefined });
    expect(r.arrangement.accompaniment.length).toBeGreaterThan(0);
    const rotations = d.renderStem.mock.calls.map((c) => (c as unknown as [string, { rotation: number }])[1].rotation);
    expect(rotations).toContain(0);
    if (r.form.some((f) => f.kind === 'chorus')) expect(rotations).toContain(2);
  });

  it('scales master’s song form to any length', () => {
    for (const s of [10, 20, 30, 45, 60, 90]) {
      const f = formForLength('chill', 100, s);
      const bars = f.reduce((n, x) => n + x.bars, 0);
      expect(bars).toBe(Math.max(1, Math.round((s * 100) / 240)));
      for (let i = 1; i < f.length; i++) expect(f[i].startBar).toBe(f[i - 1].startBar + f[i - 1].bars);
    }
  });
});
