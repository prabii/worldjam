import type { FeatureVector, PerformanceEvent } from '../contracts/library';
import type { PlannerCapture } from '../ai/fallback';
import { fallbackPlan } from '../ai/fallback';
import { suggestPatterns, suggestionToPerformance } from '../ai/guide';
import { interpretPrompt } from '../ai/interpret';
import { STYLES } from '../ai/kb/styles';
import { textToLyrics } from '../ai/lyricsV2';
import { compilePlan } from '../audio/planCompiler';
import { TakeScheduler } from '../audio/scheduler';
import { karaokeLines } from '../audio/karaoke';
import { STYLE_IDS } from '../contracts/musicPlan';

const feat = (o: Partial<FeatureVector>): FeatureVector => ({
  durationSec: 0.6, rms: 0.2, peak: 0.9, brightness: 2000, decay: 0.2, tonality: 0.2, pitchHz: null,
  transient: 0.8, sustained: 0.1, onsetCount: 1, tempoBpm: null, suggestedRole: 'percussion', ...o,
});
const caps: PlannerCapture[] = [
  { id: 'c1', name: 'Table thump', description: 'wooden desk hit', type: 'AUDIO', features: feat({ brightness: 600 }), detectedLabel: null },
  { id: 'c2', name: 'Glass tap', description: 'bright spoon on glass', type: 'AUDIO', features: feat({ brightness: 5000 }), detectedLabel: null },
  { id: 'c5', name: 'Bottle note', description: 'blowing across a bottle', type: 'AUDIO', features: feat({ tonality: 0.9, pitchHz: 330, sustained: 0.7, transient: 0.2 }), detectedLabel: null },
];

describe('AI Guide', () => {
  it('suggests distinct playable patterns only for the selected sounds', () => {
    expect(suggestPatterns([])).toEqual([]);
    const s = suggestPatterns(caps, 5);
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(new Set(s.map((x) => x.id)).size).toBe(s.length);
    for (const sug of s) {
      expect(sug.parts.every((p) => caps.some((c) => c.id === p.captureId))).toBe(true);
      expect(sug.prompt.length).toBeGreaterThan(0);
    }
  });

  it('turns a suggestion into a take on the sounds’ own pads', () => {
    const [s] = suggestPatterns(caps, 1);
    const pads: Record<string, number> = { c1: 0, c2: 1, c5: 2 };
    const perf = suggestionToPerformance(s, (id) => pads[id] ?? null, 2);
    expect(perf.events.length).toBeGreaterThan(0);
    expect(perf.events.every((e) => [0, 1, 2].includes(e.padIndex) && e.timeMs >= 0 && e.timeMs < perf.lengthMs)).toBe(true);
  });
});

describe('take scheduler (play / pause / resume / stop)', () => {
  function rig() {
    let frame = 0;
    const fired: number[] = [];
    let silenced = 0;
    let tick: (() => void) | null = null;
    const sch = new TakeScheduler({
      now: () => frame,
      sampleRate: () => 1000, // 1 frame = 1 ms
      triggerAt: (e) => fired.push(e.timeMs),
      silence: () => silenced++,
      setInterval: (fn) => ((tick = fn), 1),
      clearInterval: () => (tick = null),
    });
    const advance = (ms: number) => {
      for (let i = 0; i < ms; i += 25) {
        frame += 25;
        tick?.();
      }
    };
    return { sch, fired, advance, silenced: () => silenced };
  }
  const events: PerformanceEvent[] = [0, 500, 1000, 1500].map((t) => ({ padIndex: 0, timeMs: t, velocity: 1 }));

  it('plays every hit once, pauses without leaking, resumes where it left off, and stops', () => {
    const { sch, fired, advance, silenced } = rig();
    const states: string[] = [];
    sch.onState = (s) => states.push(s);
    sch.load(events, 2000);
    sch.play();
    advance(600);
    sch.pause();
    const atPause = fired.length;
    const pos = sch.position;
    expect(pos).toBeGreaterThan(500);
    expect(silenced()).toBe(1);
    advance(2000); // paused: nothing more fires
    expect(fired.length).toBe(atPause);
    sch.play();
    advance(2200);
    expect(fired).toEqual([0, 500, 1000, 1500]);
    expect(sch.state).toBe('idle'); // reached the end
    sch.play();
    advance(100);
    sch.stop();
    expect(sch.state).toBe('idle');
    expect(sch.position).toBe(0);
    expect(states).toContain('paused');
  });
});

describe('genres (master CHANGES.md parity)', () => {
  it('knows the Indian and world genres and maps words to them', () => {
    for (const id of ['phonk', 'massbeat', 'bhangra', 'bollywood', 'carnatic', 'indian_classical', 'afrobeats', 'reggaeton'] as const) {
      expect(STYLE_IDS).toContain(id);
      expect(STYLES[id].instruments.length).toBeGreaterThan(0);
    }
    expect(interpretPrompt('a phonk drift beat', []).style).toBe('phonk');
    expect(interpretPrompt('mass beat for the festival', []).style).toBe('massbeat');
    expect(interpretPrompt('punjabi dhol party', []).style).toBe('bhangra');
    expect(interpretPrompt('indian classical with sitar', []).style).toBe('indian_classical');
    expect(STYLES.phonk.drumLed).toBe(true);
    expect(STYLES.indian_classical.drumLed).toBe(false);
  });
});

describe('AI timing & quantize', () => {
  const inventory = Object.fromEntries(caps.map((c) => [c.id, { path: `/x/${c.id}.wav`, durationSec: c.features!.durationSec, features: c.features }]));
  const deps = { renderSynthStem: jest.fn(async () => ({ path: '/x/stem.wav', durationSec: 8 })) };

  it('hard 1/4 quantize puts every pattern hit on a beat', async () => {
    const plan = fallbackPlan({ captures: caps, intent: interpretPrompt('', []), style: 'hiphop', durationSec: 30 });
    const g = await compilePlan(plan, inventory, deps, { timing: { grid: 1, strength: 1, swing: 0 } });
    const beat = 60 / plan.tempoBpm;
    const drums = g.layers.filter((l) => l.bus === 'DRUMS').flatMap((l) => l.events);
    expect(drums.length).toBeGreaterThan(0);
    for (const e of drums) {
      const off = (e.timeSec / beat) % 1;
      expect(Math.min(off, 1 - off)).toBeLessThan(0.02);
    }
  });

  it('style feel (grid 0) keeps the style groove', async () => {
    const plan = fallbackPlan({ captures: caps, intent: interpretPrompt('', []), style: 'hiphop', durationSec: 30 });
    const a = await compilePlan(plan, inventory, deps);
    const b = await compilePlan(plan, inventory, deps, { timing: { grid: 0, strength: 0.85, swing: 0 } });
    expect(b.layers.map((l) => l.events.length)).toEqual(a.layers.map((l) => l.events.length));
  });
});

describe('karaoke timing', () => {
  it('times lines in order inside the singing sections', () => {
    const plan = fallbackPlan({ captures: caps, intent: interpretPrompt('', []), style: 'pop', durationSec: 40 });
    const lyrics = textToLyrics('[verse]\nline one\nline two\n\n[chorus]\nhook one\nhook two', 'Song', 'en');
    const lines = karaokeLines(lyrics, plan, 40000);
    expect(lines.map((l) => l.text)).toEqual(['line one', 'line two', 'hook one', 'hook two']);
    for (let i = 1; i < lines.length; i++) expect(lines[i].startMs).toBeGreaterThan(lines[i - 1].startMs);
    expect(lines[0].startMs).toBeGreaterThan(0); // after the intro
    expect(lines[lines.length - 1].startMs).toBeLessThan(40000);
  });
});
