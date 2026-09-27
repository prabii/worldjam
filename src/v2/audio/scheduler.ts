import type { PerformanceEvent } from '../contracts/library';

/**
 * Plays a recorded take (pad hits over time) with transport controls.
 *
 * Hits are handed to the engine only ~150 ms ahead of time. The engine's
 * trigger queue cannot be emptied once something is scheduled, so a longer
 * horizon would make Pause/Stop leak already-queued hits; a short one makes
 * both take effect immediately. Resume continues from the exact position.
 */
export type TakeState = 'idle' | 'playing' | 'paused';

export interface SchedulerDeps {
  /** Engine clock in frames and its rate. */
  now(): number;
  sampleRate(): number;
  /** Schedules a pad hit at an absolute engine frame. */
  triggerAt(e: PerformanceEvent, frame: number): void;
  /** Silences everything that is sounding (pause/stop). */
  silence(): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export class TakeScheduler {
  private events: PerformanceEvent[] = [];
  private lengthMs = 0;
  private originFrame = 0;
  private positionMs = 0;
  private nextIndex = 0;
  private timer: unknown = null;
  state: TakeState = 'idle';
  onEnd: (() => void) | null = null;
  onState: ((s: TakeState) => void) | null = null;

  static readonly LOOKAHEAD_MS = 150;
  static readonly TICK_MS = 25;

  constructor(private readonly deps: SchedulerDeps) {}

  load(events: PerformanceEvent[], lengthMs: number): void {
    this.stop();
    this.events = [...events].filter((e) => !e.stop).sort((a, b) => a.timeMs - b.timeMs);
    this.lengthMs = Math.max(lengthMs, this.events.length ? this.events[this.events.length - 1].timeMs + 1 : 0);
    this.positionMs = 0;
    this.nextIndex = 0;
  }

  get position(): number {
    if (this.state !== 'playing') return this.positionMs;
    return ((this.deps.now() - this.originFrame) / this.deps.sampleRate()) * 1000;
  }

  get length(): number {
    return this.lengthMs;
  }

  play(): void {
    if (this.state === 'playing' || this.lengthMs <= 0) return;
    if (this.positionMs >= this.lengthMs) this.positionMs = 0;
    const sr = this.deps.sampleRate();
    // A small lead so the first hit is never late.
    this.originFrame = this.deps.now() - Math.round((this.positionMs / 1000) * sr) + Math.round(0.03 * sr);
    this.nextIndex = this.events.findIndex((e) => e.timeMs >= this.positionMs);
    if (this.nextIndex < 0) this.nextIndex = this.events.length;
    this.setState('playing');
    this.tick();
    this.timer = this.deps.setInterval(() => this.tick(), TakeScheduler.TICK_MS);
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.positionMs = Math.min(this.lengthMs, this.position);
    this.halt();
    this.setState('paused');
  }

  stop(): void {
    if (this.state === 'idle') return;
    this.positionMs = 0;
    this.halt();
    this.setState('idle');
  }

  private halt(): void {
    if (this.timer != null) this.deps.clearInterval(this.timer);
    this.timer = null;
    this.deps.silence();
  }

  private tick(): void {
    const sr = this.deps.sampleRate();
    const pos = this.position;
    const horizon = pos + TakeScheduler.LOOKAHEAD_MS;
    while (this.nextIndex < this.events.length && this.events[this.nextIndex].timeMs <= horizon) {
      const e = this.events[this.nextIndex++];
      this.deps.triggerAt(e, this.originFrame + Math.round((e.timeMs / 1000) * sr));
    }
    if (pos >= this.lengthMs) {
      this.positionMs = 0;
      if (this.timer != null) this.deps.clearInterval(this.timer);
      this.timer = null;
      this.setState('idle');
      this.onEnd?.();
    }
  }

  private setState(s: TakeState) {
    this.state = s;
    this.onState?.(s);
  }
}
