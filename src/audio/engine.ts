import WorldJamAudio, { isNativeAudioAvailable, type TextureResult } from 'worldjam-audio';
import type { LatencyReport } from '@/types';

/**
 * Thin facade over the native module. Everything real-time lives in C++; this
 * layer only owns slot bookkeeping and the latency measurement the HLD treats
 * as go/no-go.
 */

/** Matches kMaxSlots in WorldJamEngine.h (64 V2 pads + reserved accompaniment slots). */
export const MAX_SLOTS = 80;
/** Slots reserved at the top for accompaniment layers, the AI texture and the vocal take. */
export const RESERVED_SLOTS = 7;
export const OBJECT_SLOTS = MAX_SLOTS - RESERVED_SLOTS;

export const SLOT_VOCAL = MAX_SLOTS - 1;
export const SLOT_BASS = MAX_SLOTS - 2;
export const SLOT_CHORDS = MAX_SLOTS - 3;
export const SLOT_ARP = MAX_SLOTS - 4;
export const SLOT_GUITAR = MAX_SLOTS - 5;
export const SLOT_PERC = MAX_SLOTS - 6;
/** The Stable Audio Open Small texture layer. */
export const SLOT_TEXTURE = MAX_SLOTS - 7;

let started = false;

export function startEngine(): boolean {
  if (started) return true;
  started = WorldJamAudio.start();
  return started;
}

export function stopEngine(): void {
  WorldJamAudio.stop();
  started = false;
}

export function isEngineRunning(): boolean {
  return started;
}

export const nativeAvailable = isNativeAudioAvailable;

/** Allocates the lowest free object slot, or -1 when full. */
export function allocateSlot(used: number[]): number {
  for (let i = 0; i < OBJECT_SLOTS; i++) {
    if (!used.includes(i)) return i;
  }
  return -1;
}

/** Null when on-device texture generation can run, otherwise why it cannot. */
export function textureUnavailableReason(): string | null {
  if (typeof WorldJamAudio.textureUnavailableReason !== 'function') {
    return 'this app build has no texture engine — rebuild the APK';
  }
  return WorldJamAudio.textureUnavailableReason();
}

/** Generates a texture on-device straight into `slot`. See TextureGenerator.kt. */
export async function generateTextureInto(
  prompt: string,
  seconds: number,
  seed: number,
  slot: number,
): Promise<TextureResult> {
  if (typeof WorldJamAudio.generateTexture !== 'function') {
    return { ok: false, error: 'this app build has no texture engine' };
  }
  return WorldJamAudio.generateTexture(prompt, seconds, seed, slot);
}

export function loadSample(slot: number, pcm: number[], gain = 1): boolean {
  return WorldJamAudio.loadSample(slot, pcm, gain);
}

export function trigger(slot: number, gain = 1, pan = 0.5): number {
  return WorldJamAudio.trigger(slot, gain, pan);
}

export function triggerAt(slot: number, frame: number, gain = 1, pan = 0.5): void {
  WorldJamAudio.triggerAt(slot, gain, pan, frame);
}

export function clearSlot(slot: number): void {
  WorldJamAudio.clearSlot(slot);
}

export function stopAllVoices(): void {
  WorldJamAudio.stopAllVoices();
}

export function currentFrame(): number {
  return WorldJamAudio.currentFrame();
}

export function sampleRate(): number {
  return WorldJamAudio.sampleRate();
}

export function setMasterGain(gain: number): void {
  WorldJamAudio.setMasterGain(gain);
}

export function setMetronome(on: boolean, bpm: number): void {
  WorldJamAudio.setMetronome(on, bpm);
}

export function startRecording(): boolean {
  return WorldJamAudio.startRecording();
}

export function stopRecording(): number[] {
  return WorldJamAudio.stopRecording();
}

/** The threshold the whole product hangs on, from HLD v2 §0. */
export const LATENCY_BUDGET_MS = 50;

/**
 * The go/no-go spike. Measures two different things that both matter:
 *  - dispatchMs: how long a JS-side trigger call takes to return. This is the
 *    bridge overhead, and it must be ~0 for taps to feel instant.
 *  - streamLatencyMs: the audio stream's own round-trip, reported by Oboe.
 * Their sum is what a player actually feels.
 */
export function measureLatency(iterations = 24): LatencyReport {
  const dispatches: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const t0 = globalThis.performance?.now?.() ?? Date.now();
    // Slot 0 may be empty; the engine still walks the full trigger path, which
    // is exactly the cost being measured.
    WorldJamAudio.trigger(0, 0, 0.5);
    const t1 = globalThis.performance?.now?.() ?? Date.now();
    dispatches.push(t1 - t0);
  }

  dispatches.sort((a, b) => a - b);
  // Median, not mean: one GC pause should not condemn the build.
  const dispatchMs = dispatches[Math.floor(dispatches.length / 2)];
  const streamLatencyMs = WorldJamAudio.latencyMillis();

  return {
    dispatchMs,
    streamLatencyMs,
    sampleRate: WorldJamAudio.sampleRate(),
    bufferFrames: WorldJamAudio.bufferFrames(),
    nativeAvailable: isNativeAudioAvailable,
    passes: isNativeAudioAvailable && dispatchMs + streamLatencyMs < LATENCY_BUDGET_MS,
  };
}
