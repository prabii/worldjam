import {
  GuidanceScheduler,
  buildRhythmCues,
  describeCapture,
  describeScene,
  estimateSpeechMs,
} from '@/audio/guidance';
import type { ArrangementPlan, WorldJamObject } from '@/types';
import type { Pose } from '@/audio/spatial';

const ORIGIN: Pose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

function obj(label: string, role: WorldJamObject['role'] = 'perc'): WorldJamObject {
  return {
    id: `id-${label}`,
    label,
    category: 'cup',
    slot: 0,
    position: { x: 0.5, y: 0.5 },
    features: null,
    role,
    beatPattern: [],
    volume: 1,
    pan: 0.5,
    color: '#fff',
    createdAt: 0,
  };
}

const PLAN: ArrangementPlan = {
  bpm: 90,
  bars: 4,
  objectPattern: [
    { object: 'Mug', beats: [1, 3] },
    { object: 'Table', beats: [2, 4] },
  ],
  voiceRole: 'lead',
  accompaniment: ['bass'],
  style: 'chill',
  source: 'fallback',
};

describe('buildRhythmCues', () => {
  const objects = [obj('Mug'), obj('Table')];

  it('produces a cue for every beat in the pattern', () => {
    const cues = buildRhythmCues(PLAN, objects);
    expect(cues).toHaveLength(4);
  });

  it('names the object to hit', () => {
    const cues = buildRhythmCues(PLAN, objects);
    expect(cues.map((c) => c.text)).toContain('Mug');
    expect(cues.map((c) => c.text)).toContain('Table');
  });

  it('schedules cues ahead of the beat so they are actionable', () => {
    const cues = buildRhythmCues(PLAN, objects);
    // Mug plays on beat 1; the cue must come before it.
    const mug = cues.find((c) => c.text === 'Mug')!;
    expect(mug.atBeat).toBeLessThan(1);
  });

  it('orders cues by beat', () => {
    const beats = buildRhythmCues(PLAN, objects).map((c) => c.atBeat!);
    expect(beats).toEqual([...beats].sort((a, b) => a - b));
  });

  it('combines two objects on the same beat into one cue', () => {
    const together: ArrangementPlan = {
      ...PLAN,
      objectPattern: [
        { object: 'Mug', beats: [1] },
        { object: 'Table', beats: [1] },
      ],
    };
    const cues = buildRhythmCues(together, objects);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('Mug and Table');
  });

  it('skips objects that are no longer in the session', () => {
    const cues = buildRhythmCues(PLAN, [obj('Mug')]);
    expect(cues.every((c) => !c.text.includes('Table'))).toBe(true);
  });
});

describe('describeScene', () => {
  const objects = [obj('Mug'), obj('Table')];

  it('names each object with its direction', () => {
    const positions = new Map([
      ['id-Mug', { x: -2, y: 0, z: 0 }],
      ['id-Table', { x: 0, y: 0, z: -1 }],
    ]);
    const text = describeScene(objects, positions, ORIGIN);
    expect(text).toContain('Mug');
    expect(text).toContain('left');
    expect(text).toContain('Table');
    expect(text).toContain('straight ahead');
  });

  it('lists the nearest object first', () => {
    const positions = new Map([
      ['id-Mug', { x: 0, y: 0, z: -8 }],
      ['id-Table', { x: 0, y: 0, z: -0.5 }],
    ]);
    const text = describeScene(objects, positions, ORIGIN);
    expect(text.indexOf('Table')).toBeLessThan(text.indexOf('Mug'));
  });

  it('gives usable instructions when nothing is captured', () => {
    const text = describeScene([], new Map(), ORIGIN);
    expect(text.toLowerCase()).toContain('no objects');
    expect(text.toLowerCase()).toContain('hold and hit');
  });

  it('degrades gracefully when positions are unknown', () => {
    const text = describeScene(objects, new Map(), ORIGIN);
    expect(text).toContain('2 object');
  });
});

describe('describeCapture', () => {
  it('uses plain language for musical roles', () => {
    expect(describeCapture(obj('Mug', 'kick'), 0)).toContain('deep drum');
    expect(describeCapture(obj('Keys', 'hat'), 0)).toContain('hi-hat');
  });

  it('mentions noise removal only when it was significant', () => {
    expect(describeCapture(obj('Mug'), 12)).toContain('background removed');
    expect(describeCapture(obj('Mug'), 1)).not.toContain('background removed');
  });
});

describe('GuidanceScheduler', () => {
  let spoken: string[];
  let scheduler: GuidanceScheduler;

  beforeEach(() => {
    spoken = [];
    scheduler = new GuidanceScheduler((t) => spoken.push(t));
  });

  it('does not speak on the downbeat, where a hit would be masked', () => {
    scheduler.enqueue({ text: 'hello', priority: 'normal' });
    scheduler.tick(0.05, 90, 100000);
    expect(spoken).toHaveLength(0);
  });

  it('speaks in the gap between beats', () => {
    scheduler.enqueue({ text: 'hello', priority: 'normal' });
    scheduler.tick(0.5, 90, 100000);
    expect(spoken).toEqual(['hello']);
  });

  it('respects a minimum gap so cues do not pile up', () => {
    scheduler.enqueue({ text: 'one', priority: 'normal' });
    scheduler.enqueue({ text: 'two', priority: 'normal' });
    scheduler.tick(0.5, 90, 100000);
    scheduler.tick(0.5, 90, 100100); // only 100ms later
    expect(spoken).toEqual(['one']);
  });

  it('puts an urgent cue at the front of the queue', () => {
    scheduler.enqueue({ text: 'normal', priority: 'normal' });
    scheduler.enqueue({ text: 'urgent', priority: 'urgent' });
    scheduler.tick(0.5, 90, 100000);
    expect(spoken).toEqual(['urgent']);
  });

  it('speaks a musically timed cue only near its beat', () => {
    scheduler.enqueue({ text: 'Mug', priority: 'normal', atBeat: 2 });
    scheduler.tick(0.5, 90, 100000); // far from beat 2
    expect(spoken).toHaveLength(0);

    scheduler.tick(2.1, 90, 200000); // at beat 2
    expect(spoken).toEqual(['Mug']);
  });

  it('clear() empties the queue', () => {
    scheduler.enqueue({ text: 'a', priority: 'normal' });
    scheduler.enqueue({ text: 'b', priority: 'normal' });
    expect(scheduler.pending).toBe(2);
    scheduler.clear();
    expect(scheduler.pending).toBe(0);
  });

  it('does nothing when the queue is empty', () => {
    expect(() => scheduler.tick(0.5, 90)).not.toThrow();
    expect(spoken).toHaveLength(0);
  });
});

describe('estimateSpeechMs', () => {
  it('scales with text length', () => {
    expect(estimateSpeechMs('a much longer sentence here')).toBeGreaterThan(
      estimateSpeechMs('mug'),
    );
  });

  it('has a sensible floor for very short words', () => {
    expect(estimateSpeechMs('a')).toBeGreaterThanOrEqual(300);
  });
});
