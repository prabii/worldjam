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
  /**
   * As above, but resolves with the samples rather than loading them into a
   * slot — so several clips can be assembled into one longer bed in JS.
   */
  generateTextureClip?(
    prompt: string,
    seconds: number,
    seed: number,
  ): Promise<TextureClipResult>;
  /** Builds music around a stereo melody WAV at `initPath`; resolves with the samples. */
  generateFromMelody?(
    prompt: string,
    initPath: string,
    seconds: number,
    noise: number,
    seed: number,
  ): Promise<TextureClipResult>;
  /** The music model that will run, and the longest clip it makes per call. */
  textureEngine?(): { name: string; maxSeconds: number };
}

export interface TextureResult {
  ok: boolean;
  elapsedMs?: number;
  frames?: number;
  log?: string;
  error?: string;
}

export interface TextureClipResult extends TextureResult {
  /** Mono samples at the engine's rate, present when `ok`. */
  pcm?: number[];
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
