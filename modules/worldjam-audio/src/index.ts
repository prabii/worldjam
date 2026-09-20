import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * The native engine's surface. Every call is synchronous: a tap must reach the
 * trigger ring in the same frame it was dispatched, so nothing here returns a
 * Promise.
 */
export interface WorldJamAudioNative {
  start(): boolean;
  stop(): void;
  /** Fires a slot immediately. Returns the engine frame it landed on. */
  trigger(slot: number, gain: number, pan: number): number;
  /** Schedules a slot at an absolute engine frame (the beat grid uses this). */
  triggerAt(slot: number, gain: number, pan: number, frame: number): void;
  stopAllVoices(): void;
  loadSample(slot: number, pcm: number[], gain: number): boolean;
  clearSlot(slot: number): void;
  startRecording(): boolean;
  stopRecording(): number[];
  currentFrame(): number;
  latencyMillis(): number;
  sampleRate(): number;
  bufferFrames(): number;
  setMasterGain(gain: number): void;
  setMetronome(on: boolean, bpm: number): void;
}

const native = requireOptionalNativeModule<WorldJamAudioNative>('WorldJamAudio');

export const isNativeAudioAvailable = native != null;

/**
 * Keeps the app usable when the native module is absent (Expo Go, web preview,
 * a dev machine without the NDK). Nothing makes sound, but no screen crashes —
 * and `isNativeAudioAvailable` lets the UI say so honestly rather than pretend.
 */
const stub: WorldJamAudioNative = {
  start: () => false,
  stop: () => {},
  trigger: () => 0,
  triggerAt: () => {},
  stopAllVoices: () => {},
  loadSample: () => false,
  clearSlot: () => {},
  startRecording: () => false,
  stopRecording: () => [],
  currentFrame: () => 0,
  latencyMillis: () => 0,
  sampleRate: () => 48000,
  bufferFrames: () => 0,
  setMasterGain: () => {},
  setMetronome: () => {},
};

export const WorldJamAudio: WorldJamAudioNative = native ?? stub;
export default WorldJamAudio;
