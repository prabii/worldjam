import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

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

  // --- ARCore world tracking -------------------------------------------
  // All of these are safe to call on devices without ARCore; they report
  // failure rather than throwing, so AR stays a removable layer.

  arSupported(): boolean;
  /** Creates the AR session. Returns false when unavailable. */
  arStart(): boolean;
  arResume(): boolean;
  arPause(): void;
  arStop(): void;
  arIsTracking(): boolean;
  arLastError(): string | null;
  arSetDisplayGeometry(rotation: number, width: number, height: number): void;
  /** Pins an object to the real-world surface under a screen point. */
  arCreateAnchor(id: string, screenX: number, screenY: number): boolean;
  arRemoveAnchor(id: string): void;
  /** Flat [id, x, y, distance, visible] per anchor, for the current frame. */
  arProjectAnchors(width: number, height: number): Array<string | number>;
  /** [tx, ty, tz, qx, qy, qz, qw], or [] when not tracking. */
  arCameraPose(): number[];

  // --- Stable Audio Open Small texture layer ------------------------------
  // Present only in builds that package the generator; check before calling.

  /** Null when generation can run, otherwise why not. */
  textureUnavailableReason?(): string | null;
  /**
   * Generates `seconds` of audio for `prompt` on-device and loads it into
   * `slot` as a mono sample, trimmed and faded to loop. ~18 s on an iQOO 15.
   */
  generateTexture?(prompt: string, seconds: number, seed: number, slot: number): Promise<TextureResult>;
  /** V2: generates the texture into a WAV file (for the offline mixer) instead of a pad slot. */
  generateTextureToFile?(prompt: string, seconds: number, seed: number, outPath: string): Promise<TextureResult>;

  // --- V2: pitched/looping pads, file-based samples and takes -------------

  /** rate = 2^(semitones/12); loop repeats until stopSlot. Returns the engine frame. */
  triggerPitched?(slot: number, gain: number, pan: number, rate: number, loop: boolean): number;
  triggerAtPitched?(slot: number, gain: number, pan: number, frame: number, rate: number, loop: boolean): void;
  stopSlot?(slot: number): void;
  /** Loads a WAV straight into a slot, trimmed to [startSec, endSec) (endSec <= 0 = to the end). */
  loadSampleFromWav?(slot: number, path: string, gain: number, startSec: number, endSec: number): Promise<boolean>;
  /** Streams the microphone to a PCM16 mono WAV at `path` (absolute, no file://). */
  startRecordingToFile?(path: string): boolean;
  stopRecordingToFile?(): RecordingInfo;
  /** Recent input peak 0..1 while recording. */
  inputLevel?(): number;

  // --- V2: ACE-Step 1.5 AI production ------------------------------------

  aceStepUnavailableReason?(): string | null;
  /** Runs acestep.cpp on `srcPath` (cover-nofsq); resolves with the produced WAV. */
  aceStepGenerate?(requestJson: string, srcPath: string, outDir: string, threads: number): Promise<AceStepResult>;
  aceStepCancel?(): void;
  addListener?(event: 'onAceProgress', listener: (e: { progress: number; stage: string }) => void): EventSubscription;
}

export interface RecordingInfo {
  ok: boolean;
  frames: number;
  sampleRate: number;
  peak: number;
  rms: number;
}

export interface AceStepResult {
  ok: boolean;
  path?: string;
  elapsedMs?: number;
  log?: string;
  error?: string;
}

export interface TextureResult {
  ok: boolean;
  elapsedMs?: number;
  frames?: number;
  log?: string;
  error?: string;
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

  arSupported: () => false,
  arStart: () => false,
  arResume: () => false,
  arPause: () => {},
  arStop: () => {},
  arIsTracking: () => false,
  arLastError: () => 'native module not loaded',
  arSetDisplayGeometry: () => {},
  arCreateAnchor: () => false,
  arRemoveAnchor: () => {},
  arProjectAnchors: () => [],
  arCameraPose: () => [],
};

export const WorldJamAudio: WorldJamAudioNative = native ?? stub;
export default WorldJamAudio;
