import type { FeatureVector, PerformanceEvent, StudioSource } from '../contracts/library';
import { STYLE_IDS, type MusicPlan, type PlanPatch } from '../contracts/musicPlan';
import { buildPlanPrompt, kbSnippet, planSchema } from '../ai/context';
import { captureRefs, fallbackPatch, fallbackPlan, type PlannerCapture } from '../ai/fallback';
import { interpretPrompt } from '../ai/interpret';
import { formFor, styleSpec } from '../ai/kb/styles';
import { roleForCapture } from '../ai/kb/rules';
import { fallbackLyrics, lyricsToPlanHints, lyricsToText, rewriteLyrics, textToLyrics, generateLyrics } from '../ai/lyricsV2';
import { applyPatch } from '../ai/patches';
import { editPlan, generatePlan, type LlmClient } from '../ai/planner';
import { normalizeKey, validatePlan } from '../ai/validator';
import { compilePlan, rateFor } from '../audio/planCompiler';
import { performanceToGraph, performanceToPlan, quantizePerformance } from '../audio/performance';

const feat = (o: Partial<FeatureVector>): FeatureVector => ({
  durationSec: 0.6, rms: 0.2, peak: 0.9, brightness: 2000, decay: 0.2, tonality: 0.2, pitchHz: null,
  transient: 0.8, sustained: 0.1, onsetCount: 1, tempoBpm: null, suggestedRole: 'percussion', ...o,
});

const caps: PlannerCapture[] = [
  { id: 'c1', name: 'Table thump', description: 'wooden desk hit', type: 'AUDIO', features: feat({ brightness: 600 }), detectedLabel: null },
  { id: 'c2', name: 'Glass tap', description: 'bright spoon on glass', type: 'AUDIO', features: feat({ brightness: 5000 }), detectedLabel: null },
  { id: 'c3', name: 'Fan hum', description: 'steady fan noise', type: 'AUDIO', features: feat({ sustained: 0.9, transient: 0.1, durationSec: 5 }), detectedLabel: null },
  { id: 'c4', name: 'My hum', description: 'humming a tune', type: 'HUM', features: feat({ sustained: 0.8, tonality: 0.9, pitchHz: 220, durationSec: 8, melody: { key: 'A', tempoBpm: 84, notes: [] } }), detectedLabel: null },
  { id: 'c5', name: 'Bottle note', description: 'blowing across a bottle', type: 'AUDIO', features: feat({ tonality: 0.9, pitchHz: 330, sustained: 0.7, transient: 0.2 }), detectedLabel: null },
];
const ctx = { captures: captureRefs(caps), durationSec: 36 };

function fakeLlm(replies: Array<string | Error>): LlmClient & { calls: number } {
  let i = 0;
  const llm = {
    model: 'fake',
    calls: 0,
    async complete() {
      llm.calls++;
      const r = replies[Math.min(i++, replies.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return llm;
}

describe('knowledge base + interpretation', () => {
  it('maps sounds to roles from words first, then from the sound', () => {
    expect(roleForCapture(caps[0])).toBe('kick');
    expect(roleForCapture(caps[1])).toBe('hat');
    expect(roleForCapture(caps[2])).toBe('texture');
    expect(roleForCapture(caps[3])).toBe('vocal');
    expect(roleForCapture({ name: 'x', description: '', type: 'AUDIO', detectedLabel: null, features: feat({ brightness: 500 }) })).toBe('kick');
  });

  it('reads style, tempo, duration, featured and excluded sounds', () => {
    const i = interpretPrompt('Make a dark lofi track at 80 bpm, 45 seconds, make the glass tap the main sound, without the fan hum', caps);
    expect(i.style).toBe('lofi');
    expect(i.mood).toBe('dark');
    expect(i.tempoBpm).toBe(80);
    expect(i.durationSec).toBe(45);
    expect(i.featured).toContain('c2');
    expect(i.excluded).toContain('c3');
    expect(interpretPrompt('drum and bass banger').style).toBe('dnb');
  });

  it('splits the form into whole bars that add up', () => {
    for (const id of STYLE_IDS) {
      const f = formFor(styleSpec(id), 18);
      expect(f.reduce((n, s) => n + s.bars, 0)).toBe(18);
      expect(f.every((s) => s.bars >= 1)).toBe(true);
    }
  });

  it('keeps the model context small', () => {
    const p = buildPlanPrompt({ captures: caps, prompt: 'chill', intent: interpretPrompt('chill', caps), style: 'chill', durationSec: 36 });
    expect(kbSnippet('edm').length).toBeLessThan(1200);
    expect(p.length).toBeLessThan(6000); // ≈1.5k tokens
    expect(JSON.stringify(planSchema(['c1'])).includes('"c1"')).toBe(true);
  });
});

describe('validator', () => {
  const good = {
    title: 'Night', style: 'lofi', tempoBpm: 82, key: 'Am', scale: 'minor',
    sections: [{ kind: 'intro', bars: 2, energy: 0.3, layers: ['k'] }, { kind: 'verse', bars: 8, energy: 0.8, layers: ['k', 'h'] }],
    layers: [{ id: 'k', source: 'c1', role: 'kick', gainDb: -3, pattern: 'X......X..X.....' }, { id: 'h', source: 'Glass tap', role: 'hat', gainDb: -6, pattern: 'x.x.x.x.x.x.x.x.' }],
    caption: 'lofi, dusty',
  };

  it('accepts a good plan and resolves names to ids', () => {
    const v = validatePlan(JSON.stringify(good), ctx);
    expect(v.errors).toEqual([]);
    expect(v.plan!.key).toBe('A');
    expect(v.plan!.layers[1].source).toEqual({ kind: 'capture', captureId: 'c2' });
    expect(v.plan!.durationSec).toBeGreaterThanOrEqual(30);
  });

  it('drops hallucinated sounds and reports them for the repair round', () => {
    const v = validatePlan({ ...good, layers: [...good.layers, { id: 'x', source: 'c99', role: 'kick', gainDb: 0 }] }, ctx);
    expect(v.errors.some((e) => e.includes('c99'))).toBe(true);
    expect(v.plan!.layers.map((l) => l.id)).toEqual(['k', 'h']);
  });

  it('folds tempo, clamps gain, fixes patterns and extends short songs to 30 s', () => {
    const v = validatePlan({ ...good, tempoBpm: 240, sections: [{ kind: 'verse', bars: 2, energy: 2, layers: ['k'] }], layers: [{ id: 'k', source: 'c1', gainDb: 40, pattern: 'X-X' }] }, ctx);
    expect(v.plan!.tempoBpm).toBe(120);
    expect(v.plan!.layers[0].gainDb).toBe(6);
    expect(v.plan!.layers[0].pattern).toHaveLength(16);
    expect(v.plan!.durationSec).toBeGreaterThanOrEqual(30);
    expect(v.plan!.sections.every((s) => s.energy <= 1)).toBe(true);
  });

  it('honours locked tempo/key and keeps the voice unpitched', () => {
    const v = validatePlan({ ...good, layers: [...good.layers, { id: 'v', source: 'c4', role: 'lead', gainDb: 0, pitch: 'melody' }] }, { ...ctx, lock: { tempoBpm: 84, key: 'D', scale: 'minor' } });
    expect(v.plan!.tempoBpm).toBe(84);
    expect(v.plan!.key).toBe('D');
    const voice = v.plan!.layers.find((l) => l.id === 'v')!;
    expect(voice.role).toBe('vocal');
    expect(voice.pitch).toEqual({ mode: 'hum', captureId: 'c4' });
  });

  it('makes featured sounds prominent and rejects garbage', () => {
    const v = validatePlan(good, { ...ctx, featured: ['c5'] });
    const f = v.plan!.layers.find((l) => l.source.kind === 'capture' && l.source.captureId === 'c5')!;
    expect(f).toBeTruthy();
    expect(v.plan!.sections.filter((s) => s.layers.includes(f.id)).length).toBeGreaterThan(0);
    expect(validatePlan('I cannot help with that', ctx).plan).toBeNull();
    expect(validatePlan({ layers: [] }, ctx).plan).toBeNull();
    expect(normalizeKey('F# minor')).toEqual({ key: 'F#', scale: 'minor' });
    expect(normalizeKey('Bb')).toEqual({ key: 'A#', scale: null });
  });
});

describe('fallback planner + patches', () => {
  it('always produces a valid ≥30 s plan for every style and 1..5 sounds', () => {
    for (const style of STYLE_IDS) {
      for (let n = 1; n <= caps.length; n++) {
        const plan = fallbackPlan({ captures: caps.slice(0, n), intent: interpretPrompt('', []), style, durationSec: 30 });
        const v = validatePlan(plan, { captures: captureRefs(caps.slice(0, n)), durationSec: 30 });
        expect(v.errors).toEqual([]);
        expect(plan.durationSec).toBeGreaterThanOrEqual(30);
        expect(plan.layers.length).toBeGreaterThan(0);
      }
    }
  });

  it('gives duplicate drum sounds distinct jobs and backs them with synth parts', () => {
    const drums = [0, 1, 2].map((i) => ({ ...caps[0], id: `d${i}`, name: `Desk ${i}` }));
    const plan = fallbackPlan({ captures: drums, intent: interpretPrompt('', []), style: 'lofi', durationSec: 30 });
    expect(new Set(plan.layers.filter((l) => l.source.kind === 'capture').map((l) => l.role)).size).toBe(3);
    expect(plan.layers.some((l) => l.source.kind === 'synth' && l.source.instrument === 'bass')).toBe(true);
  });

  it('applies every patch operation and rejects unknown targets', () => {
    const plan = fallbackPlan({ captures: caps, intent: interpretPrompt('', []), style: 'pop', durationSec: 36 });
    const first = plan.layers[0].id;
    const patch: PlanPatch = {
      operations: [
        { type: 'set_gain', layerId: first, gainDb: 3 },
        { type: 'set_pan', layerId: first, pan: -0.5 },
        { type: 'add_effect', layerId: first, effect: { type: 'reverb', size: 0.8, mix: 0.4 } },
        { type: 'change_tempo', tempoBpm: 118 },
        { type: 'change_section_energy', sectionId: plan.sections[0].id, energy: 0.2 },
        { type: 'set_role', layerId: first, role: 'snare' },
        { type: 'set_pattern', layerId: first, pattern: 'X...X...X...X...' },
        { type: 'add_layer', layer: { id: 'extra', source: { kind: 'synth', instrument: 'arp' }, role: 'lead', gainDb: -8, pan: 0.3 } },
        { type: 'remove_layer', layerId: 'nope' },
        { type: 'change_style', style: 'rock' },
      ],
    };
    const r = applyPatch(plan, patch, { captures: captureRefs(caps), durationSec: 36 });
    expect(r.rejected).toEqual(['remove nope']);
    const l = r.plan.layers.find((x) => x.id === first)!;
    expect(l.gainDb).toBe(3);
    expect(l.role).toBe('snare');
    expect(r.plan.style).toBe('rock');
    expect(r.plan.layers.some((x) => x.id === 'extra')).toBe(true);
    expect(r.plan.tempoBpm).toBeGreaterThanOrEqual(100);
  });

  it('turns editing language into a patch without a model', () => {
    const plan = fallbackPlan({ captures: caps, intent: interpretPrompt('', []), style: 'chill', durationSec: 30 });
    const p = fallbackPatch(plan, 'make it darker and faster, bring the glass tap forward', interpretPrompt('make it darker and faster, bring the glass tap forward', caps));
    const types = p.operations.map((o) => o.type);
    expect(types).toContain('add_effect');
    expect(types).toContain('change_tempo');
    expect(types).toContain('set_gain');
  });
});

describe('planner orchestration', () => {
  const valid = JSON.stringify({
    title: 'T', style: 'edm', tempoBpm: 126, key: 'F', scale: 'minor', caption: 'edm',
    sections: [{ kind: 'build', bars: 8, energy: 0.6, layers: ['a'] }, { kind: 'drop', bars: 8, energy: 1, layers: ['a', 'b'] }],
    layers: [{ id: 'a', source: 'c1', role: 'kick', gainDb: -2, pattern: 'X...X...X...X...' }, { id: 'b', source: 'synth:bass', role: 'bass', gainDb: -6 }],
  });

  it('uses a valid model plan', async () => {
    const r = await generatePlan({ captures: caps, prompt: 'edm drop', durationSec: 30 }, fakeLlm([valid]));
    expect(r.source).toBe('model');
    expect(r.plan.style).toBe('edm');
  });

  it('repairs once, then falls back', async () => {
    const hallucinated = JSON.stringify({ ...JSON.parse(valid), layers: [{ id: 'z', source: 'c42', role: 'kick', gainDb: 0 }] });
    const repaired = await generatePlan({ captures: caps, prompt: 'edm', durationSec: 30 }, fakeLlm([hallucinated, valid]));
    expect(repaired.source).toBe('repaired');
    const failed = fakeLlm(['nope', 'still nope']);
    const fb = await generatePlan({ captures: caps, prompt: 'edm', durationSec: 30 }, failed);
    expect(fb.source).toBe('fallback');
    expect(failed.calls).toBe(2);
    expect(fb.plan.layers.length).toBeGreaterThan(0);
  });

  it('falls back when the model throws or is absent', async () => {
    expect((await generatePlan({ captures: caps, prompt: 'x', durationSec: 30 }, fakeLlm([new Error('oom')]))).source).toBe('fallback');
    expect((await generatePlan({ captures: caps, prompt: 'x', durationSec: 30 }, null)).error).toMatch(/not loaded/);
  });

  it('edits with a model patch, or deterministically', async () => {
    const base = fallbackPlan({ captures: caps, intent: interpretPrompt('', []), style: 'chill', durationSec: 30 });
    const patch = JSON.stringify({ summary: 'louder', operations: [{ type: 'set_gain', layerId: base.layers[0].id, gainDb: 4 }] });
    const m = await editPlan(base, 'louder', caps, fakeLlm([patch]));
    expect(m.source).toBe('model');
    expect(m.plan.layers[0].gainDb).toBe(4);
    const d = await editPlan(base, 'slower', caps, null);
    expect(d.source).toBe('fallback');
    expect(d.plan.tempoBpm).toBeLessThan(base.tempoBpm);
  });
});

describe('lyrics', () => {
  it('parses typed lyrics with headers and stanzas, and round-trips', () => {
    const l = textToLyrics('[Verse]\nline one\nline two\n\n[Chorus]\nhook here\nhook again');
    expect(l.sections.map((s) => s.type)).toEqual(['verse', 'chorus']);
    expect(textToLyrics(lyricsToText(l)).sections).toEqual(l.sections);
    expect(textToLyrics('a\nb\n\nc\nd').sections.map((s) => s.type)).toEqual(['verse', 'chorus']);
  });

  it('derives tempo and form from syllable density', () => {
    const dense = lyricsToPlanHints(textToLyrics('this line has a whole lot of syllables packed inside it\nanother extraordinarily complicated vocabulary line'), 'pop');
    const sparse = lyricsToPlanHints(textToLyrics('hey\nyeah\noh'), 'pop');
    expect(dense.tempoBpm).toBeLessThan(sparse.tempoBpm);
    expect(dense.sections[0]).toBe('intro');
    expect(dense.durationSec).toBeGreaterThanOrEqual(30);
  });

  it('generates with the model or falls back, and never rewrites without being asked', async () => {
    const reply = JSON.stringify({ title: 'Glass', language: 'en', theme: 'kitchen', sections: [{ type: 'verse', lines: ['a spoon on glass'] }, { type: 'chorus', lines: ['ring it out'] }] });
    const m = await generateLyrics({ plan: null, captures: caps, theme: 'kitchen', style: 'pop', language: 'en' }, fakeLlm([reply]));
    expect(m.source).toBe('model');
    expect(m.lyrics.sections).toHaveLength(2);
    const fb = await generateLyrics({ plan: null, captures: caps, theme: '', style: 'pop', language: 'en' }, null);
    expect(fb.source).toBe('fallback');
    expect(fb.lyrics.sections.length).toBeGreaterThan(1);
    const orig = fallbackLyrics(caps, 'x', 'pop', 'en');
    const noModel = await rewriteLyrics(orig, 'rewrite', null);
    expect(noModel.lyrics).toBe(orig);
    const shorter = await rewriteLyrics(orig, 'shorten', null);
    expect(shorter.lyrics.sections[0].lines.length).toBeLessThan(orig.sections[0].lines.length);
  });
});

describe('plan compiler', () => {
  const inventory = Object.fromEntries(caps.map((c) => [c.id, { path: `/x/${c.id}.wav`, durationSec: c.features!.durationSec, features: c.features }]));
  const deps = { renderSynthStem: jest.fn(async () => ({ path: '/x/stem.wav', durationSec: 8 })) };

  it('compiles a fallback plan to a graph that matches the contract', async () => {
    const plan = fallbackPlan({ captures: caps, intent: interpretPrompt('', []), style: 'lofi', durationSec: 36 });
    const g = await compilePlan(plan, inventory, deps);
    expect(g.durationSec).toBeGreaterThanOrEqual(31.5);
    expect(g.master.limiterCeilingDb).toBeLessThanOrEqual(-1);
    const ids = new Set(g.sources.map((s) => s.id));
    expect(g.layers.every((l) => ids.has(l.sourceId))).toBe(true);
    expect(g.layers.every((l) => l.events.every((e) => e.timeSec >= 0 && e.timeSec <= g.durationSec && e.rate >= 0.25 && e.rate <= 4))).toBe(true);
    expect(new Set(g.layers.map((l) => l.bus))).toEqual(new Set(g.buses.map((b) => b.name)));
    // The voice is placed as recorded (rate 1) on the VOCAL bus with its chain.
    const vocal = g.layers.find((l) => l.bus === 'VOCAL')!;
    expect(vocal.events.every((e) => e.rate === 1)).toBe(true);
    expect(g.buses.find((b) => b.name === 'VOCAL')!.effects.map((e) => e.type)).toEqual(['highpass', 'compressor', 'peak', 'delay', 'reverb']);
  });

  it('places pattern hits on the beat grid at the plan tempo', async () => {
    const plan: MusicPlan = {
      ...fallbackPlan({ captures: [caps[0]], intent: interpretPrompt('', []), style: 'edm', durationSec: 30 }),
    };
    const g = await compilePlan(plan, inventory, deps);
    const kick = g.layers.find((l) => l.sourceId === 'cap_c1')!;
    const spb = 60 / plan.tempoBpm;
    // EDM is straight and barely humanised: every hit within 3 ms of a sixteenth.
    for (const e of kick.events) {
      const steps = e.timeSec / (spb / 4);
      expect(Math.abs(steps - Math.round(steps)) * (spb / 4)).toBeLessThan(0.003);
    }
  });

  it('pitches tonal sounds by rate and excludes roles on request', async () => {
    expect(rateFor(69, 81)).toBeCloseTo(2);
    expect(rateFor(60, 60 + 40)).toBeLessThanOrEqual(4);
    const plan = fallbackPlan({ captures: caps, intent: interpretPrompt('', []), style: 'pop', durationSec: 30 });
    const bed = await compilePlan(plan, inventory, deps, { excludeRoles: ['vocal'] });
    expect(bed.layers.some((l) => l.bus === 'VOCAL')).toBe(false);
    const withAce = await compilePlan(plan, inventory, deps, { production: { path: '/x/ace.wav', durationSec: 30, amount: 1 } });
    expect(withAce.layers.some((l) => l.id === 'ace_production')).toBe(true);
    // The capture bed ducks under the production, the voice does not.
    const kickPlain = (await compilePlan(plan, inventory, deps)).layers.find((l) => l.bus === 'DRUMS')!;
    const kickDucked = withAce.layers.find((l) => l.id === kickPlain.id)!;
    expect(kickDucked.gainDb).toBeLessThan(kickPlain.gainDb);
  });
});

describe('manual performance', () => {
  const settings = { gainDb: -2, pan: 0.2, pitchSemitones: 0, trimStartMs: 0, trimEndMs: null, loop: false, muted: false };
  const sources: StudioSource[] = [
    { captureId: 'c1', padIndex: 0, settings, role: null },
    { captureId: 'c2', padIndex: 1, settings: { ...settings, pitchSemitones: 12 }, role: null },
    { captureId: 'c3', padIndex: 2, settings: { ...settings, loop: true }, role: null },
    { captureId: 'c5', padIndex: 3, settings: { ...settings, muted: true }, role: null },
  ];
  const inventory = Object.fromEntries(caps.map((c) => [c.id, { path: `/x/${c.id}.wav`, durationSec: 1, features: c.features }]));

  it('compensates latency, quantizes and scores timing', () => {
    // 120 bpm: a sixteenth is 125 ms. Hits played ~20 ms late with 20 ms latency land on the grid.
    const events: PerformanceEvent[] = [0, 125, 250, 375].map((t, i) => ({ padIndex: i % 2, timeMs: t + 20 + (i === 3 ? 30 : 0), velocity: 1 }));
    const q = quantizePerformance(events, 120, { grid: 4, strength: 1, swing: 0 }, 20);
    expect(q.events.map((e) => Math.round(e.timeMs))).toEqual([0, 125, 250, 375]);
    expect(q.accuracy).toBeGreaterThan(0.5);
    const off = quantizePerformance(events, 120, { grid: 0, strength: 1, swing: 0 }, 20);
    expect(off.events.map((e) => e.timeMs)).toEqual([0, 125, 250, 405]);
  });

  it('renders pads as played: pitch, loops until stopped, muted pads silent', () => {
    const perf: PerformanceEvent[] = [
      { padIndex: 0, timeMs: 0, velocity: 1 },
      { padIndex: 1, timeMs: 500, velocity: 0.5 },
      { padIndex: 2, timeMs: 1000, velocity: 1 },
      { padIndex: 2, timeMs: 3000, velocity: 1, stop: true },
      { padIndex: 3, timeMs: 1500, velocity: 1 },
    ];
    const g = performanceToGraph(perf, sources, inventory, { lengthMs: 4000 });
    expect(g.layers.map((l) => l.id)).toEqual(['pad0', 'pad1', 'pad2']);
    expect(g.layers[1].events[0].rate).toBeCloseTo(2);
    expect(g.layers[2].events[0]).toMatchObject({ loop: true, timeSec: 1, durationSec: 2 });
    expect(g.durationSec).toBeCloseTo(5.5);
  });

  it('folds a performance into an editable ≥30 s plan', () => {
    const perf: PerformanceEvent[] = [0, 500, 1000, 1500].map((t) => ({ padIndex: 0, timeMs: t, velocity: 1 }));
    const plan = performanceToPlan(perf, sources, { c1: 'kick' }, { bpm: 120, lengthMs: 2000, style: 'house' });
    expect(plan.layers[0].pattern).toBe('X...X...X...X...');
    expect(plan.durationSec).toBeGreaterThanOrEqual(30);
    expect(validatePlan(plan, { captures: captureRefs(caps), durationSec: 30 }).errors).toEqual([]);
  });
});
