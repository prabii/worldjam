import * as FileSystem from 'expo-file-system';

import WorldJamAudio from 'worldjam-audio';
import { getGemmaRuntime } from '@/ai/gemma';
import { renderLayer } from '@/audio/synth';
import { encodeWav, toBase64 } from '@/audio/render';

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
