import type { Loop } from '@/types';
import { currentFrame, sampleRate, triggerAt } from './engine';

/**
 * The transport: a look-ahead scheduler.
 *
 * A JS timer cannot be trusted to fire on a musical boundary — it drifts and
 * stalls under GC. So instead of playing a note when the timer fires, we run
 * the timer coarsely (every 25 ms) and use it to push events into the native
 * engine's *future* schedule. The engine then fires each one sample-accurately
 * from the audio thread. Timer jitter becomes irrelevant as long as it wakes
 * up more often than the look-ahead window.
 */

/** How far ahead we schedule. Must exceed the timer interval by a good margin. */
const LOOKAHEAD_SEC = 0.12;
const TICK_MS = 25;

export interface TransportState {
  playing: boolean;
  bpm: number;
  bars: number;
  /** Engine frame at which the current loop iteration started. */
  originFrame: number;
  /** Fractional beats elapsed in the current loop. */
  position: number;
}

type ResolveSlot = (objectId: string) => { slot: number; gain: number; pan: number } | null;

export class Transport {
  private timer: ReturnType<typeof setInterval> | null = null;
  private loops: Loop[] = [];
  private resolve: ResolveSlot = () => null;

  private bpm = 92;
  private bars = 4;
  private originFrame = 0;
  /** Beat position up to which everything has already been scheduled. */
  private scheduledThroughBeat = 0;
  private playing = false;

  private listeners = new Set<(s: TransportState) => void>();

  setResolver(fn: ResolveSlot): void {
    this.resolve = fn;
  }

  setLoops(loops: Loop[]): void {
    this.loops = loops;
  }

  setTempo(bpm: number, bars: number): void {
    const wasPlaying = this.playing;
    // Changing tempo mid-loop would misplace every already-scheduled event,
    // so restart the grid cleanly from now.
    if (wasPlaying) this.stop();
    this.bpm = bpm;
    this.bars = bars;
    if (wasPlaying) this.start();
  }

  getState(): TransportState {
    return {
      playing: this.playing,
      bpm: this.bpm,
      bars: this.bars,
      originFrame: this.originFrame,
      position: this.currentBeat(),
    };
  }

  subscribe(fn: (s: TransportState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const s = this.getState();
    for (const fn of this.listeners) fn(s);
  }

  private get beatsPerLoop(): number {
    return this.bars * 4;
  }

  private get framesPerBeat(): number {
    return (60 / this.bpm) * sampleRate();
  }

  /** Current position in beats since the transport started. */
  currentBeat(): number {
    if (!this.playing) return 0;
    return (currentFrame() - this.originFrame) / this.framesPerBeat;
  }

  start(): void {
    if (this.playing) return;
    this.playing = true;
    this.originFrame = currentFrame();
    this.scheduledThroughBeat = 0;

    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.emit();
  }

  stop(): void {
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.playing = false;
    this.scheduledThroughBeat = 0;
    this.emit();
  }

  /**
   * Schedules every loop event that falls inside the look-ahead window, then
   * advances the marker. Events are scheduled by absolute frame, so a late
   * tick catches up instead of dropping notes.
   */
  private tick(): void {
    if (!this.playing) return;

    const fpb = this.framesPerBeat;
    const nowBeat = this.currentBeat();
    const horizonBeat = nowBeat + (LOOKAHEAD_SEC * this.bpm) / 60;

    const from = Math.max(this.scheduledThroughBeat, nowBeat);
    if (horizonBeat <= from) return;

    const loopLen = this.beatsPerLoop;

    for (const loop of this.loops) {
      if (loop.muted) continue;

      // Walk each loop repetition that overlaps the window.
      const firstRep = Math.floor(from / loopLen);
      const lastRep = Math.floor(horizonBeat / loopLen);

      for (let rep = firstRep; rep <= lastRep; rep++) {
        const repStart = rep * loopLen;
        for (const event of loop.events) {
          const absBeat = repStart + event.beat;
          if (absBeat < from || absBeat >= horizonBeat) continue;

          const target = this.resolve(event.objectId);
          if (!target || target.slot < 0) continue;

          const frame = Math.round(this.originFrame + absBeat * fpb);
          triggerAt(target.slot, frame, target.gain * event.velocity, target.pan);
        }
      }
    }

    this.scheduledThroughBeat = horizonBeat;
    this.emit();
  }

  /**
   * Converts a live tap into a loop position, so a performance can be recorded
   * straight onto the grid.
   */
  tapToBeat(): number {
    const beat = this.currentBeat();
    const loopLen = this.beatsPerLoop;
    let pos = beat % loopLen;
    if (pos < 0) pos += loopLen;
    return pos;
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
  }
}

export const transport = new Transport();

// planToLoopEvents lives in ./planEvents so it can be tested without
// pulling in the native engine; re-exported here for convenience.
export { planToLoopEvents } from './planEvents';
