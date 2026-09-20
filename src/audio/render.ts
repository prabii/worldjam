import type { Loop, WorldJamObject, ArrangementPlan } from '@/types';

/**
 * Offline session renderer — the "Session Renderer" of HLD v2 §5.
 *
 * Renders the arrangement to a WAV file entirely on device, so a jam can be
 * saved or shared. This is a pure mixdown over sample buffers: no engine, no
 * real-time constraints, which means it can run faster than realtime and be
 * unit-tested.
 *
 * The captured sounds are mixed exactly as recorded. Nothing is regenerated —
 * the exported track contains the user's real object sounds.
 */

export interface RenderSource {
  /** Mono PCM for each slot, as loaded into the engine. */
  samples: Map<number, Float32Array | number[]>;
  objects: WorldJamObject[];
  loops: Loop[];
  plan: ArrangementPlan | null;
  bpm: number;
  bars: number;
  sampleRate: number;
  /** How many times to repeat the loop in the export. */
  repeats?: number;
}

/** Slot lookup for the procedurally rendered accompaniment layers. */
export type LayerSlotResolver = (layerId: string) => number | null;

/**
 * Mixes the session into an interleaved stereo buffer.
 *
 * Clipping is handled by the same soft limiter the live engine uses, so an
 * export sounds like what the user heard rather than louder or harsher.
 */
export function mixSession(
  src: RenderSource,
  resolveLayer: LayerSlotResolver = () => null,
): Float32Array {
  const repeats = Math.max(1, src.repeats ?? 2);
  const beatsPerLoop = src.bars * 4;
  const framesPerBeat = (60 / src.bpm) * src.sampleRate;

  // Tail room so the last hit is not cut off mid-decay.
  let longestSample = 0;
  for (const pcm of src.samples.values()) {
    longestSample = Math.max(longestSample, pcm.length);
  }
  const totalFrames =
    Math.ceil(beatsPerLoop * repeats * framesPerBeat) + longestSample + src.sampleRate;

  const out = new Float32Array(totalFrames * 2);

  const objectBySlot = new Map<string, WorldJamObject>();
  for (const o of src.objects) objectBySlot.set(o.id, o);

  for (const loop of src.loops) {
    if (loop.muted) continue;

    for (let rep = 0; rep < repeats; rep++) {
      for (const event of loop.events) {
        const absBeat = rep * beatsPerLoop + event.beat;
        const startFrame = Math.round(absBeat * framesPerBeat);

        let slot: number | null = null;
        let gain = 1;
        let pan = 0.5;

        if (event.objectId.startsWith('layer:')) {
          slot = resolveLayer(event.objectId.slice(6));
          gain = 0.8;
        } else {
          const obj = objectBySlot.get(event.objectId);
          if (obj) {
            slot = obj.slot;
            gain = obj.volume;
            pan = obj.pan;
          }
        }

        if (slot == null) continue;
        const pcm = src.samples.get(slot);
        if (!pcm) continue;

        // Equal-power panning, matching the live engine.
        const gl = gain * event.velocity * Math.sqrt(1 - pan);
        const gr = gain * event.velocity * Math.sqrt(pan);

        for (let i = 0; i < pcm.length; i++) {
          const f = startFrame + i;
          if (f >= totalFrames) break;
          out[f * 2] += pcm[i] * gl;
          out[f * 2 + 1] += pcm[i] * gr;
        }
      }
    }
  }

  // Same soft clip as the engine, so the export matches what was heard.
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.tanh(out[i]);
  }

  return out;
}

/**
 * Wraps an interleaved stereo float buffer in a 16-bit PCM WAV container.
 *
 * 16-bit rather than float32 because every player handles it, and the source
 * is phone-mic audio where the extra depth buys nothing.
 */
export function encodeWav(
  interleaved: Float32Array,
  sampleRate: number,
  channels = 2,
): Uint8Array {
  const bytesPerSample = 2;
  const dataSize = interleaved.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');

  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true); // byte rate
  view.setUint16(32, channels * bytesPerSample, true); // block align
  view.setUint16(34, 8 * bytesPerSample, true); // bits per sample

  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < interleaved.length; i++) {
    // Clamp before scaling; a value outside [-1, 1] would wrap and click.
    const s = Math.max(-1, Math.min(1, interleaved[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

/** Base64-encodes bytes for writing via expo-file-system. */
export function toBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let i = 0;

  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63];
  }

  const remaining = bytes.length - i;
  if (remaining === 1) {
    const n = bytes[i] << 16;
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + '==';
  } else if (remaining === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + '=';
  }

  return out;
}
