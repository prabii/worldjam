import * as FileSystem from 'expo-file-system';

import WorldJamAudio from 'worldjam-audio';
import { getGemmaRuntime } from '@/ai/gemma';
import { renderLayer } from '@/audio/synth';
import { encodeWav, toBase64 } from '@/audio/render';
import { monoToStereo, renderMelody } from '@/audio/melodySynth';

import { WorldJamMedia } from '../../../modules/worldjam-media/src';
import type { ScaleId, StyleId, SynthInstrument } from '../contracts/musicPlan';
import type { RenderGraph, RenderResult } from '../contracts/renderGraph';
import type { LlmClient } from '../ai/planner';
import { styleSpec } from '../ai/kb/styles';
import type { CompileDeps } from '../audio/planCompiler';
import { mediaStore } from './capture';

/** The loaded Gemma runtime as the planner's LlmClient, or null when no model is ready. */
export function currentLlm(): LlmClient | null {
  const rt = getGemmaRuntime();
  if (!rt || !rt.isReady() || !rt.generateJson) return null;
  const gen = rt.generateJson.bind(rt);
  return {
    model: 'gemma-4-E2B-it-q4_0',
    complete: (prompt, o) => gen(prompt, o.maxTokens, o.jsonSchema ?? null, o.temperature),
  };
}

const stemCache = new Map<string, { path: string; durationSec: number }>();

/**
 * Synth backing stems: the V1 instrument engine renders the part as PCM, it is
 * written once as a WAV and reused for every render of the same settings.
 */
/** The music model that will run (Stable Audio 3 first, else Open Small) and its longest clip. */
export function musicEngine(): { name: string; maxSeconds: number; sa3: boolean } {
  try {
    const e = WorldJamAudio.textureEngine?.();
    if (e && e.name) return { name: e.name, maxSeconds: e.maxSeconds || 11, sa3: /stable audio 3/i.test(e.name) };
  } catch {
    // older build
  }
  return { name: '', maxSeconds: 11, sa3: false };
}

const bedCache = new Map<string, { path: string; durationSec: number }>();
async function cached(key: string, make: () => Promise<{ path: string; durationSec: number } | null>) {
  const hit = bedCache.get(key);
  if (hit && (await FileSystem.getInfoAsync(`file://${hit.path}`)).exists) return hit;
  const made = await make();
  if (made) bedCache.set(key, made);
  return made;
}

const rawPath = (uri: string) => uri.replace(/^file:\/\//, '');
const freshSeed = (seed: number) => Math.abs(Math.floor(seed)) % 2_147_483_647;

export const compileDeps: CompileDeps = {
  async renderSynthStem(instrument: SynthInstrument, o: { bpm: number; bars: number; key: string; scale: ScaleId; style: StyleId }) {
    const minor = o.scale === 'minor' || o.scale === 'dorian' || o.scale === 'pentatonic_minor';
    const key = `${instrument}-${o.bpm}-${o.bars}-${o.key}-${minor ? 'm' : 'M'}-${o.style}`;
    const hit = stemCache.get(key);
    if (hit && (await FileSystem.getInfoAsync(`file://${hit.path}`)).exists) return hit;
    const sampleRate = 48000;
    const pcm = renderLayer(instrument, { sampleRate, bpm: o.bpm, bars: o.bars, key: `${o.key} ${minor ? 'minor' : 'major'}`, style: styleSpec(o.style).feel });
    const wav = encodeWav(Float32Array.from(pcm), sampleRate, 1);
    const s = await mediaStore();
    const uri = s.tempUri('wav');
    await FileSystem.writeAsStringAsync(uri, toBase64(wav), { encoding: FileSystem.EncodingType.Base64 });
    const out = { path: uri.replace(/^file:\/\//, ''), durationSec: pcm.length / sampleRate };
    stemCache.set(key, out);
    return out;
  },
  /** Stable Audio Open Small atmosphere for a plan's texture layer; null (layer skipped) when unavailable. */
  async renderTexture(prompt: string, seconds: number) {
    if (typeof WorldJamAudio.generateTextureToFile !== 'function' || WorldJamAudio.textureUnavailableReason?.() != null) return null;
    const s = await mediaStore();
    const uri = s.tempUri('wav');
    const path = uri.replace(/^file:\/\//, '');
    // Fresh seed each render so the same words never hand back a stale clip.
    const r = await WorldJamAudio.generateTextureToFile(prompt, Math.min(10, seconds), Math.floor(Math.random() * 2_147_483_647), path);
    return r.ok ? { path, durationSec: Math.min(10, seconds) } : null;
  },
  get bedMaxSeconds() {
    return musicEngine().maxSeconds;
  },
  /** Stable Audio 3: one section of music from master's genre-aware prompt. */
  async renderBed(prompt: string, seconds: number, seed: number) {
    if (typeof WorldJamAudio.generateTextureToFile !== 'function' || !musicEngine().sa3) return null;
    const want = Math.min(musicEngine().maxSeconds, seconds);
    return cached(`bed|${prompt}|${seed}|${want.toFixed(2)}`, async () => {
      const s = await mediaStore();
      const path = rawPath(s.tempUri('wav'));
      const r = await WorldJamAudio.generateTextureToFile!(prompt, want, freshSeed(seed), path);
      return r.ok ? { path, durationSec: want } : null;
    });
  },
  /** Stable Audio 3 hum-to-song: the tune rendered on piano seeds the model (master's flow). */
  async renderMelodyBed(prompt: string, notes: Array<{ midi: number; start: number; duration: number }>, seconds: number, seed: number) {
    if (typeof WorldJamAudio.generateFromMelodyToFile !== 'function' || !musicEngine().sa3) return null;
    const FILE_RATE = 44100;
    const mono = renderMelody(notes.map((n) => ({ midi: n.midi, time: n.start, duration: n.duration, confidence: 1 })), FILE_RATE, 'piano', seconds);
    const wav = encodeWav(monoToStereo(mono), FILE_RATE, 2);
    const s = await mediaStore();
    const init = s.tempUri('wav');
    await FileSystem.writeAsStringAsync(init, toBase64(wav), { encoding: FileSystem.EncodingType.Base64 });
    const out = rawPath(s.tempUri('wav'));
    try {
      const r = await WorldJamAudio.generateFromMelodyToFile(prompt, rawPath(init), seconds, 0.7, freshSeed(seed), out);
      return r.ok ? { path: out, durationSec: seconds } : null;
    } finally {
      void FileSystem.deleteAsync(init, { idempotent: true }).catch(() => {});
    }
  },
};

/** Runs the native offline renderer. */
export async function renderToFile(graph: RenderGraph, outUri: string, onProgress?: (p: number) => void): Promise<RenderResult> {
  const sub = onProgress ? WorldJamMedia.addListener('onRenderProgress', (e) => onProgress(e.progress)) : null;
  try {
    return await WorldJamMedia.renderMix(graph, outUri.replace(/^file:\/\//, ''), 200);
  } finally {
    sub?.remove();
  }
}

export function engineLatencyMs(): number {
  try {
    return WorldJamAudio.latencyMillis();
  } catch {
    return 0;
  }
}
