import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

import type { RenderGraph, RenderResult } from '../../../src/v2/contracts/renderGraph';

/**
 * WorldJam V2 media services (Kotlin, modules/worldjam-media/android).
 *
 * All paths are absolute filesystem paths WITHOUT a file:// prefix. Every call
 * that touches media runs off the JS thread natively and resolves when done.
 */

export interface DecodeOptions {
  /** Output sample rate. Default 48000. */
  sampleRate?: number;
  /** Downmix to mono. Default true. */
  mono?: boolean;
  /** Stop after this many seconds of audio. Default: whole file. */
  maxSeconds?: number;
}

export interface DecodeResult {
  durationSec: number;
  sampleRate: number;
  channels: number;
  frames: number;
}

export interface FrameOptions {
  /** Longest edge of the saved JPEG. Default 512. */
  maxSize?: number;
  /** How many evenly spaced candidate frames to score; the most detailed wins. Default 5. */
  candidates?: number;
  /** JPEG quality 0..100. Default 85. */
  quality?: number;
}

export interface FrameResult {
  width: number;
  height: number;
  timeMs: number;
}

export interface MediaProbe {
  durationMs: number;
  hasAudio: boolean;
  hasVideo: boolean;
  width: number | null;
  height: number | null;
  sampleRate: number | null;
  channels: number | null;
  mimeType: string | null;
  sizeBytes: number;
}

export interface PcmResult {
  /** Little-endian float32 mono PCM, base64. */
  base64: string;
  sampleRate: number;
  frames: number;
}

export interface SpeechAvailability {
  available: boolean;
  /** true when the on-device (offline) recognizer exists (API 33+ createOnDeviceSpeechRecognizer). */
  onDevice: boolean;
}

export interface SpeechResult {
  text: string;
  /** Alternatives, best first. */
  alternatives: string[];
  isFinal: boolean;
}

export type SpeechState = 'idle' | 'listening' | 'processing';

type Events = {
  onRenderProgress(e: { progress: number }): void;
  onSpeechPartial(e: SpeechResult): void;
  onSpeechResult(e: SpeechResult): void;
  onSpeechError(e: { code: number; message: string }): void;
  onSpeechState(e: { state: SpeechState; rmsDb?: number }): void;
};

interface NativeWorldJamMedia {
  probe(path: string): Promise<MediaProbe>;
  decodeToWav(inputPath: string, outputPath: string, options: DecodeOptions): Promise<DecodeResult>;
  extractFrame(videoPath: string, outputJpegPath: string, options: FrameOptions): Promise<FrameResult>;
  wavPeaks(path: string, buckets: number): Promise<number[]>;
  /** Rewrites a WAV in place at a healthy level (see Wav.normalize); returns the gain applied in dB. */
  normalizeWav(path: string, targetDb: number, maxGainDb: number): Promise<number>;
  readPcm(path: string, maxSeconds: number, sampleRate: number): Promise<PcmResult>;
  sha256(path: string): Promise<string>;
  /** graphJson = JSON.stringify(RenderGraph). Writes a stereo 16-bit WAV. */
  renderMix(graphJson: string, outputPath: string, peakBuckets: number): Promise<RenderResult>;
  speechAvailability(): Promise<SpeechAvailability>;
  startListening(options: { language?: string; preferOffline?: boolean; partialResults?: boolean }): Promise<void>;
  stopListening(): Promise<void>;
  cancelListening(): Promise<void>;
  addListener<E extends keyof Events>(event: E, listener: Events[E]): EventSubscription;
}

const native = requireOptionalNativeModule<NativeWorldJamMedia>('WorldJamMedia');

export const isMediaModuleAvailable = native != null;

function mod(): NativeWorldJamMedia {
  if (!native) throw new Error('WorldJamMedia native module is not available in this build');
  return native;
}

export const WorldJamMedia = {
  probe: (path: string) => mod().probe(path),
  decodeToWav: (inputPath: string, outputPath: string, options: DecodeOptions = {}) =>
    mod().decodeToWav(inputPath, outputPath, options),
  extractFrame: (videoPath: string, outputJpegPath: string, options: FrameOptions = {}) =>
    mod().extractFrame(videoPath, outputJpegPath, options),
  wavPeaks: (path: string, buckets = 200) => mod().wavPeaks(path, buckets),
  normalizeWav: (path: string, targetDb = -1, maxGainDb = 42) => mod().normalizeWav(path, targetDb, maxGainDb),
  readPcm: (path: string, maxSeconds = 30, sampleRate = 48000) => mod().readPcm(path, maxSeconds, sampleRate),
  sha256: (path: string) => mod().sha256(path),
  renderMix: (graph: RenderGraph, outputPath: string, peakBuckets = 200) =>
    mod().renderMix(JSON.stringify(graph), outputPath, peakBuckets),
  speechAvailability: () => mod().speechAvailability(),
  startListening: (options: { language?: string; preferOffline?: boolean; partialResults?: boolean } = {}) =>
    mod().startListening(options),
  stopListening: () => mod().stopListening(),
  cancelListening: () => mod().cancelListening(),
  addListener: <E extends keyof Events>(event: E, listener: Events[E]): EventSubscription =>
    mod().addListener(event, listener),
};

/** Decodes the base64 float32 PCM returned by readPcm. */
export function pcmFromBase64(base64: string): Float32Array {
  const bin = globalThis.atob ? globalThis.atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer, 0, Math.floor(bytes.length / 4));
}
