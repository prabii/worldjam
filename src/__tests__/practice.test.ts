import {
  accuracyOf,
  checkEcho,
  earRound,
  extendPattern,
  gradeTap,
  nextTempo,
  rng,
  scoreFor,
  tapOffset,
} from '@/game/practice';

describe('Rhythm Trainer', () => {
  it('measures a tap against the nearest click', () => {
    // 120 BPM: clicks every 500 ms.
    expect(tapOffset(1000, 120)).toBe(0);
    expect(tapOffset(1030, 120)).toBe(30);
    expect(tapOffset(970, 120)).toBe(-30);
  });

  it('picks the nearer click either side', () => {
    expect(tapOffset(1240, 120)).toBe(240);
    expect(tapOffset(1260, 120)).toBe(-240);
  });

  it('grades by milliseconds', () => {
    expect(gradeTap(10)).toBe('PERFECT');
    expect(gradeTap(-50)).toBe('GOOD');
    expect(gradeTap(90)).toBe('OK');
    expect(gradeTap(-200)).toBe('MISS');
  });

  it('scores better grades higher', () => {
    expect(scoreFor('PERFECT')).toBeGreaterThan(scoreFor('GOOD'));
    expect(scoreFor('MISS')).toBe(0);
  });

  it('speeds up when accurate and eases off when not', () => {
    expect(nextTempo(80, 0.9)).toBe(86);
    expect(nextTempo(80, 0.2)).toBe(74);
    expect(nextTempo(80, 0.6)).toBe(80);
  });

  it('keeps tempo inside a playable range', () => {
    expect(nextTempo(180, 1)).toBe(180);
    expect(nextTempo(60, 0)).toBe(60);
  });

  it('computes accuracy as the share of non-misses', () => {
    expect(
      accuracyOf([
        { offsetMs: 0, grade: 'PERFECT' },
        { offsetMs: 300, grade: 'MISS' },
      ]),
    ).toBe(0.5);
    expect(accuracyOf([])).toBe(0);
  });
});

describe('Echo', () => {
  it('grows a pattern one hit at a time', () => {
    const r = rng(1);
    let p: number[] = [];
    for (let i = 0; i < 6; i++) p = extendPattern(p, 4, r);
    expect(p).toHaveLength(6);
    for (const v of p) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of p) expect(v).toBeLessThan(4);
  });

  it('never repeats a pad three times in a row', () => {
    const r = rng(42);
    let p: number[] = [];
    for (let i = 0; i < 200; i++) p = extendPattern(p, 2, r);
    for (let i = 2; i < p.length; i++) {
      expect(p[i] === p[i - 1] && p[i] === p[i - 2]).toBe(false);
    }
  });

  it('is reproducible from a seed', () => {
    const a = extendPattern(extendPattern([], 4, rng(7)), 4, rng(7));
    const b = extendPattern(extendPattern([], 4, rng(7)), 4, rng(7));
    expect(a).toEqual(b);
  });

  it('checks input as the player goes', () => {
    expect(checkEcho([1, 2, 3], [1])).toBe('ongoing');
    expect(checkEcho([1, 2, 3], [1, 3])).toBe('wrong');
    expect(checkEcho([1, 2, 3], [1, 2, 3])).toBe('done');
  });
});

describe('Ear Trainer', () => {
  it('needs at least two sounds', () => {
    expect(earRound(1, 0, rng(1))).toBeNull();
  });

  it('starts with two choices and grows with level', () => {
    expect(earRound(6, 0, rng(1))!.choices).toHaveLength(2);
    expect(earRound(6, 9, rng(1))!.choices.length).toBeGreaterThan(2);
  });

  it('never offers more choices than there are sounds', () => {
    expect(earRound(3, 100, rng(1))!.choices).toHaveLength(3);
  });

  it('always includes the answer among the choices', () => {
    const r = rng(9);
    for (let i = 0; i < 50; i++) {
      const round = earRound(5, i, r)!;
      expect(round.choices).toContain(round.answer);
      expect(new Set(round.choices).size).toBe(round.choices.length);
    }
  });
});
