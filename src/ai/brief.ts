/**
 * Turns the Create screen's controls into a sentence the model can act on.
 *
 * The knobs do not feed an audio effect chain — the native engine has no
 * reverb, delay or pitch shift. They describe the *result* the user wants, and
 * the arranger is what delivers it: "lots of reverb, wide and distant" makes
 * the model choose pads and longer decays, which is what that setting sounds
 * like when a producer reaches for it.
 *
 * Kept pure and separate from the screen so the wording can be tested. The
 * exact phrasing matters: it is the difference between an arrangement that
 * follows the controls and one that ignores them.
 */

export interface BriefInput {
  /** Mood chip label, e.g. "Chill". */
  mood?: string;
  /** 0..1, where 0.5 is neutral for pitch and mid-travel for the others. */
  reverb?: number;
  space?: number;
  pitch?: number;
  /** Anything the user typed. */
  direction?: string;
}

/** Above/below these the setting is a deliberate choice rather than a default. */
const HIGH = 0.65;
const LOW = 0.2;

/** Semitones covered by the full sweep of the pitch knob, centred at 0.5. */
const PITCH_RANGE_SEMITONES = 24;

export function describeReverb(v: number): string | null {
  if (v > HIGH) return 'lots of reverb, wide and distant';
  if (v < LOW) return 'dry and close, almost no reverb';
  return null;
}

export function describeSpace(v: number): string | null {
  if (v > 0.6) return 'plenty of space between hits';
  if (v < LOW) return 'tight, busy, little space';
  return null;
}

export function describePitch(v: number): string | null {
  const semis = Math.round((v - 0.5) * PITCH_RANGE_SEMITONES);
  if (semis === 0) return null;
  return `pitched ${semis > 0 ? 'up' : 'down'} ${Math.abs(semis)} semitones`;
}

/**
 * Builds the brief.
 *
 * Returns undefined rather than an empty string when there is nothing to say,
 * so the caller can pass it straight to arrange() and get the model's own
 * judgement instead of an instruction that says nothing.
 */
export function buildBrief(input: BriefInput): string | undefined {
  const parts: string[] = [];

  if (input.mood?.trim()) parts.push(input.mood.trim().toLowerCase());

  if (input.reverb != null) {
    const d = describeReverb(input.reverb);
    if (d) parts.push(d);
  }
  if (input.space != null) {
    const d = describeSpace(input.space);
    if (d) parts.push(d);
  }
  if (input.pitch != null) {
    const d = describePitch(input.pitch);
    if (d) parts.push(d);
  }

  // The user's own words go last so they read as the final instruction, which
  // is where an instruction carries the most weight.
  if (input.direction?.trim()) parts.push(input.direction.trim());

  return parts.length > 0 ? parts.join(', ') : undefined;
}
