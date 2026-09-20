import type { ArrangementPlan, WorldJamObject } from '@/types';
import { describeDirection, spatialize, type Pose } from './spatial';

/**
 * Spoken guidance — the accessibility layer.
 *
 * Two audiences, one system:
 *
 *  - A blind user cannot see the AR labels, but the captured sounds already
 *    exist at real positions in the room. Spoken direction plus spatial audio
 *    turns that into something playable: "the mug is to your left, close."
 *  - A sighted user gets rhythm coaching without looking at the screen, which
 *    matters when both hands are busy hitting objects.
 *
 * The design rule here is that speech must never collide with the music. A
 * cue spoken over the downbeat ruins the thing it is trying to teach, so all
 * of this is scheduled into the gaps.
 */

export type SpeechPriority = 'low' | 'normal' | 'urgent';

export interface SpeechCue {
  text: string;
  priority: SpeechPriority;
  /** Beat position this should land on, if it is musically timed. */
  atBeat?: number;
}

/**
 * How far ahead of a beat to speak a cue.
 *
 * A cue is useful only if it arrives before the action. Roughly one beat of
 * lead time at moderate tempo lets a person hear "mug" and move their hand
 * before the beat lands.
 */
const LEAD_BEATS = 1;

/**
 * Builds the spoken call sequence for an arrangement.
 *
 * Says what to hit and when, in the order the pattern plays, so the user can
 * perform the arrangement without reading the rhythm guide.
 */
export function buildRhythmCues(
  plan: ArrangementPlan,
  objects: WorldJamObject[],
): SpeechCue[] {
  const byLabel = new Map(objects.map((o) => [o.label.toLowerCase(), o]));
  const cues: SpeechCue[] = [];

  // Flatten the pattern into "what happens on each beat".
  const perBeat = new Map<number, string[]>();
  for (const entry of plan.objectPattern) {
    const obj = byLabel.get(entry.object.toLowerCase());
    if (!obj) continue;
    for (const beat of entry.beats) {
      const list = perBeat.get(beat) ?? [];
      list.push(obj.label);
      perBeat.set(beat, list);
    }
  }

  for (const [beat, labels] of [...perBeat.entries()].sort((a, b) => a[0] - b[0])) {
    // Two objects on the same beat is "mug and table", not two racing cues.
    const text = labels.length === 1 ? labels[0] : labels.join(' and ');
    cues.push({
      text,
      priority: 'normal',
      atBeat: beat - LEAD_BEATS,
    });
  }

  return cues;
}

/**
 * Describes where every captured object sits relative to the listener.
 *
 * This is the "feel the room" moment: a blind user sweeps the phone and hears
 * what is around them, with each object named and placed.
 */
export function describeScene(
  objects: WorldJamObject[],
  positions: Map<string, { x: number; y: number; z: number }>,
  pose: Pose,
): string {
  if (objects.length === 0) {
    return 'No objects captured yet. Tap where an object is, then hold and hit it.';
  }

  const described: Array<{ text: string; distance: number }> = [];

  for (const obj of objects) {
    const pos = positions.get(obj.id);
    if (!pos) continue;
    const s = spatialize(pos, pose);
    described.push({
      text: `${obj.label}, ${describeDirection(s)}`,
      distance: s.distance,
    });
  }

  if (described.length === 0) {
    return `${objects.length} object${objects.length === 1 ? '' : 's'} captured, positions not tracked.`;
  }

  // Nearest first — what is closest is what you can reach.
  described.sort((a, b) => a.distance - b.distance);
  return described.map((d) => d.text).join('. ') + '.';
}

/** Spoken confirmation after a capture, so no screen is needed. */
export function describeCapture(
  object: WorldJamObject,
  noiseReducedDb: number,
): string {
  const role = ROLE_WORDS[object.role] ?? object.role;
  const cleaned = noiseReducedDb > 3 ? ', background removed' : '';
  return `${object.label} captured. Sounds like a ${role}${cleaned}.`;
}

/** Plain-language names for musical roles — "hi-hat" beats "hat". */
const ROLE_WORDS: Record<string, string> = {
  kick: 'deep drum',
  snare: 'snare',
  hat: 'hi-hat',
  perc: 'percussion',
  bass: 'bass note',
  lead: 'lead voice',
  texture: 'ringing texture',
};

/**
 * Schedules speech so it lands in musical gaps rather than over the beat.
 *
 * Speaking on the downbeat masks the very hit the user is trying to hear, so
 * cues are nudged into the space between beats.
 */
export class GuidanceScheduler {
  private queue: SpeechCue[] = [];
  private lastSpokenAt = 0;
  private speaking = false;

  /** Minimum gap between utterances, so cues do not pile up. */
  private readonly minGapMs = 700;

  constructor(private speak: (text: string) => void) {}

  /** Queues a cue. Urgent cues jump ahead of everything pending. */
  enqueue(cue: SpeechCue): void {
    if (cue.priority === 'urgent') {
      this.queue.unshift(cue);
    } else {
      this.queue.push(cue);
    }
  }

  clear(): void {
    this.queue = [];
  }

  /**
   * Call once per UI tick with the current beat position.
   * Speaks at most one cue, and only when it fits the musical gap.
   */
  tick(currentBeat: number, bpm: number, now = Date.now()): void {
    if (this.speaking || this.queue.length === 0) return;
    if (now - this.lastSpokenAt < this.minGapMs) return;

    const beatMs = (60 / bpm) * 1000;
    // Fraction through the current beat, 0 = on the beat.
    const intoBeat = currentBeat - Math.floor(currentBeat);

    const next = this.queue[0];

    if (next.atBeat != null) {
      // Musically timed: only speak near its scheduled beat.
      const target = ((next.atBeat % 4) + 4) % 4;
      const diff = Math.abs(((currentBeat % 4) + 4) % 4 - target);
      if (diff > 0.35) return;
    } else {
      // Untimed: avoid the downbeat, where a hit is most likely.
      if (intoBeat < 0.25 || intoBeat > 0.75) return;
    }

    // Skip a cue that is too long to fit before the next beat.
    const estimatedMs = estimateSpeechMs(next.text);
    if (estimatedMs > beatMs * 1.5 && next.priority !== 'urgent') {
      // Keep it for a gap in the music rather than dropping it entirely.
      if (intoBeat < 0.4) return;
    }

    this.queue.shift();
    this.lastSpokenAt = now;
    this.speaking = true;
    try {
      this.speak(next.text);
    } finally {
      // Released on a timer rather than a callback so a silent TTS engine
      // cannot wedge the queue permanently.
      setTimeout(() => {
        this.speaking = false;
      }, Math.min(estimatedMs, 2500));
    }
  }

  get pending(): number {
    return this.queue.length;
  }
}

/** Rough duration estimate: ~4 characters per 100 ms at normal speech rate. */
export function estimateSpeechMs(text: string): number {
  return Math.max(300, text.length * 55);
}
