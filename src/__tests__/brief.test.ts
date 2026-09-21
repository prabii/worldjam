import {
  buildBrief,
  describePitch,
  describeReverb,
  describeSpace,
} from '@/ai/brief';

describe('describeReverb', () => {
  it('says nothing at a middling setting', () => {
    expect(describeReverb(0.4)).toBeNull();
  });

  it('describes a wide setting', () => {
    expect(describeReverb(0.9)).toMatch(/reverb/);
  });

  it('describes a dry setting', () => {
    expect(describeReverb(0.05)).toMatch(/dry/);
  });
});

describe('describeSpace', () => {
  it('says nothing in the middle', () => {
    expect(describeSpace(0.4)).toBeNull();
  });

  it('asks for space when turned up', () => {
    expect(describeSpace(0.9)).toMatch(/space/);
  });

  it('asks for density when turned down', () => {
    expect(describeSpace(0.05)).toMatch(/tight|busy/);
  });
});

describe('describePitch', () => {
  it('says nothing at centre, which is no shift at all', () => {
    expect(describePitch(0.5)).toBeNull();
  });

  it('describes an upward shift', () => {
    const d = describePitch(1);
    expect(d).toMatch(/up/);
    expect(d).toMatch(/12 semitones/);
  });

  it('describes a downward shift', () => {
    const d = describePitch(0);
    expect(d).toMatch(/down/);
    expect(d).toMatch(/12 semitones/);
  });

  it('never reports a negative count, which would read as a double negative', () => {
    for (let v = 0; v <= 1; v += 0.05) {
      const d = describePitch(v);
      if (d) expect(d).not.toMatch(/-\d/);
    }
  });
});

describe('buildBrief', () => {
  it('returns undefined when there is nothing to say', () => {
    // Every control at its neutral position and no words typed: the model
    // should use its own judgement rather than be handed an empty instruction.
    expect(buildBrief({ reverb: 0.4, space: 0.4, pitch: 0.5 })).toBeUndefined();
  });

  it('returns undefined for an empty input', () => {
    expect(buildBrief({})).toBeUndefined();
  });

  it('leads with the mood', () => {
    const b = buildBrief({ mood: 'Chill', reverb: 0.9 });
    expect(b?.startsWith('chill')).toBe(true);
  });

  it("puts the user's own words last, where they carry most weight", () => {
    const b = buildBrief({
      mood: 'Sad',
      reverb: 0.9,
      direction: 'like Charlie Puth',
    });
    expect(b?.endsWith('like Charlie Puth')).toBe(true);
  });

  it('combines every active control', () => {
    const b = buildBrief({
      mood: 'Dark',
      reverb: 0.9,
      space: 0.9,
      pitch: 0.75,
      direction: 'warm piano',
    });
    expect(b).toMatch(/dark/);
    expect(b).toMatch(/reverb/);
    expect(b).toMatch(/space/);
    expect(b).toMatch(/semitones/);
    expect(b).toMatch(/warm piano/);
  });

  it('ignores whitespace-only direction', () => {
    expect(buildBrief({ direction: '   ' })).toBeUndefined();
  });

  it('trims the direction', () => {
    expect(buildBrief({ direction: '  make it dreamy  ' })).toBe('make it dreamy');
  });

  it('reads as a list a person could have written', () => {
    const b = buildBrief({ mood: 'Chill', reverb: 0.9, direction: 'soft drums' });
    expect(b).toBe('chill, lots of reverb, wide and distant, soft drums');
  });
});
