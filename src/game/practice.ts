/**
 * Practice games, as pure functions.
 *
 * Three drills that use the player's own recorded sounds: keeping time
 * (Rhythm Trainer), remembering a phrase (Echo), and telling sounds apart by
 * ear (Ear Trainer). No camera, no React — the screen drives these and they
 * are tested here.
 */

// ── Rhythm Trainer ──────────────────────────────────────────────────────────

export interface TapResult {
  /** Signed error in ms against the nearest click; negative is early. */
  offsetMs: number;
  grade: 'PERFECT' | 'GOOD' | 'OK' | 'MISS';
}

/** Error from the nearest click, for a tap `elapsedMs` after the first one. */
export function tapOffset(elapsedMs: number, bpm: number): number {
  const beat = 60000 / Math.max(1, bpm);
  const nearest = Math.round(elapsedMs / beat) * beat;
  return Math.round(elapsedMs - nearest);
}

/**
 * Grades are in milliseconds rather than a fraction of the beat: a
 * listener hears 40 ms of drag the same at 70 BPM as at 140.
 */
export function gradeTap(offsetMs: number): TapResult['grade'] {
  const a = Math.abs(offsetMs);
  if (a <= 25) return 'PERFECT';
  if (a <= 60) return 'GOOD';
  if (a <= 110) return 'OK';
  return 'MISS';
}

export function scoreFor(grade: TapResult['grade']): number {
  return grade === 'PERFECT' ? 3 : grade === 'GOOD' ? 2 : grade === 'OK' ? 1 : 0;
}

/**
 * The next tempo after a round.
 *
 * Steps up by 6 BPM when the player was accurate, eases back when they were
 * not, so the drill sits at the edge of what they can hold.
 */
export function nextTempo(bpm: number, accuracy: number): number {
  if (accuracy >= 0.8) return Math.min(180, bpm + 6);
  if (accuracy < 0.4) return Math.max(60, bpm - 6);
  return bpm;
}

/** Share of taps graded better than MISS, 0..1. */
export function accuracyOf(results: TapResult[]): number {
  if (results.length === 0) return 0;
  return results.filter((r) => r.grade !== 'MISS').length / results.length;
}

// ── Echo ────────────────────────────────────────────────────────────────────

/**
 * A deterministic pseudo-random generator, so a seeded pattern is
 * reproducible in tests and fair to replay.
 */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Grows a pattern by one hit.
 *
 * Never repeats the previous pad three times running: a run of identical
 * hits tests counting, not listening.
 */
export function extendPattern(pattern: number[], pads: number, rand: () => number): number[] {
  if (pads <= 0) return pattern;
  const n = pattern.length;
  let next = Math.floor(rand() * pads);
  if (pads > 1 && n >= 2 && pattern[n - 1] === next && pattern[n - 2] === next) {
    next = (next + 1) % pads;
  }
  return [...pattern, next];
}

/**
 * Checks the player's input so far against the pattern.
 * 'wrong' as soon as one tap differs, 'done' when all match, else 'ongoing'.
 */
export function checkEcho(pattern: number[], input: number[]): 'ongoing' | 'wrong' | 'done' {
  for (let i = 0; i < input.length; i++) {
    if (input[i] !== pattern[i]) return 'wrong';
  }
  return input.length >= pattern.length ? 'done' : 'ongoing';
}

// ── Ear Trainer ─────────────────────────────────────────────────────────────

export interface EarRound {
  /** Index of the sound that plays. */
  answer: number;
  /** Indices offered as choices, including the answer. */
  choices: number[];
}

/**
 * Choices grow with the level — two sounds at first, up to every recorded
 * one — so a beginner is not asked to separate six similar taps at once.
 */
export function earRound(total: number, level: number, rand: () => number): EarRound | null {
  if (total < 2) return null;
  const count = Math.min(total, 2 + Math.floor(level / 3));
  const pool = Array.from({ length: total }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const choices = pool.slice(0, count).sort((a, b) => a - b);
  const answer = choices[Math.floor(rand() * choices.length)];
  return { answer, choices };
}
