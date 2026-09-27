import * as FileSystem from 'expo-file-system';

import WorldJamAudio, { type RecordingInfo } from 'worldjam-audio';
import { detectOnsets, estimateTempo, extractFeatures, extractMelody } from '@/dsp/analysis';
import { refineMelody } from '@/dsp/melody';

import { WorldJamMedia, isMediaModuleAvailable, pcmFromBase64 } from '../../../modules/worldjam-media/src';
import type { Capture, CaptureType, FeatureVector } from '../contracts/library';
import { expoFileOps } from '../data/expoFileOps';
import { MediaStore } from '../data/mediaStore';
import { roleFromFeatures } from '../ai/kb/rules';
import { getLibrary, notifyLibraryChanged } from './library';

let store: MediaStore | null = null;

/** The media store over the app's document directory (created once, temp cleared on first use). */
export async function mediaStore(): Promise<MediaStore> {
  if (store) return store;
  const lib = await getLibrary();
  const s = new MediaStore(lib.media, expoFileOps, FileSystem.documentDirectory ?? '');
  await s.init();
  store = s;
  return s;
}

const pathOf = (uri: string) => uri.replace(/^file:\/\//, '');
const uriOf = (p: string) => (p.startsWith('file://') ? p : `file://${p}`);

// ---------------------------------------------------------------- audio takes

let takeUri: string | null = null;

/** Starts streaming the microphone to a temp WAV. Refuses when storage is low. */
export async function startAudioTake(): Promise<void> {
  const s = await mediaStore();
  await s.ensureSpace();
  if (!WorldJamAudio.startRecordingToFile) throw new Error('This build cannot record to file');
  const uri = s.tempUri('wav');
  if (!WorldJamAudio.startRecordingToFile(pathOf(uri))) throw new Error('Microphone could not start — is another app using it?');
  takeUri = uri;
}

export function takeLevel(): number {
  return WorldJamAudio.inputLevel?.() ?? 0;
}

export function isTaking(): boolean {
  return takeUri != null;
}

/** Stops the take; returns its temp file and stats (null if nothing was recorded). */
export function stopAudioTake(): { uri: string; info: RecordingInfo } | null {
  const uri = takeUri;
  takeUri = null;
  const info = WorldJamAudio.stopRecordingToFile?.();
  if (!uri) return null;
  // Under 0.1 s is a mis-tap, not a sound: drop the file.
  if (!info?.ok || info.frames < info.sampleRate * 0.1) {
    void discard(uri);
    return null;
  }
  return { uri, info };
}

export async function discard(uri: string | null): Promise<void> {
  if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

// ---------------------------------------------------------------- analysis

/**
 * Features the AI and the orbit use: V1 DSP over the first 30 s, plus the
 * melody/key/tempo of a hum or song (so the track can lock to the voice).
 */
export async function analyze(wavPath: string, type: CaptureType): Promise<FeatureVector | null> {
  if (!isMediaModuleAvailable) return null;
  try {
    const { base64, sampleRate } = await WorldJamMedia.readPcm(wavPath, 30, 48000);
    const pcm = pcmFromBase64(base64);
    if (pcm.length < sampleRate * 0.05) return null;
    const f = extractFeatures(pcm, sampleRate);
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    const onsets = detectOnsets(pcm, sampleRate);
    const vec: FeatureVector = {
      durationSec: f.duration,
      rms: f.energy,
      peak,
      brightness: f.brightness,
      decay: f.decay,
      tonality: f.tonality,
      pitchHz: f.pitch,
      transient: Math.max(0, Math.min(1, 1 - f.decay / 0.8)),
      sustained: Math.max(0, Math.min(1, f.decay / 1.5)),
      onsetCount: onsets.length,
      tempoBpm: estimateTempo(onsets, sampleRate),
      suggestedRole: 'percussion',
    };
    vec.suggestedRole = type === 'HUM' || type === 'VOCAL' ? 'vocal' : roleFromFeatures(vec);
    if (type === 'HUM' || type === 'VOCAL') {
      const m = refineMelody(extractMelody(pcm, sampleRate), null);
      vec.melody = { key: m.key, tempoBpm: m.notes.length >= 4 ? m.bpm : null, notes: m.notes.slice(0, 64).map((n) => ({ midi: n.midi, start: n.time, duration: n.duration })) };
    }
    return vec;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- saving

export interface CaptureMeta {
  name: string;
  description: string;
  detectedLabel: string | null;
  /** false = keep only in the current Studio session (not shown in My Jams). */
  inLibrary: boolean;
}

/** Audio/hum/vocal take → library capture (atomic: files first, then one DB row). */
export async function saveAudioCapture(tempUri: string, type: Exclude<CaptureType, 'VIDEO'>, meta: CaptureMeta): Promise<Capture> {
  const s = await mediaStore();
  const lib = await getLibrary();
  const probe = await WorldJamMedia.probe(pathOf(tempUri)).catch(() => null);
  const features = await analyze(pathOf(tempUri), type);
  const sha = await WorldJamMedia.sha256(pathOf(tempUri)).catch(() => null);
  const asset = await s.commit(tempUri, {
    kind: type === 'AUDIO' ? 'AUDIO_CAPTURE' : type,
    dir: 'audio',
    ext: 'wav',
    mimeType: 'audio/wav',
    durationMs: probe?.durationMs ?? (features ? features.durationSec * 1000 : null),
    sampleRate: probe?.sampleRate ?? 48000,
    channels: 1,
    sha256: sha,
  });
  try {
    const c = await lib.captures.create({
      name: meta.name,
      description: meta.description,
      type,
      mediaAssetId: asset.id,
      audioAssetId: asset.id,
      thumbnailAssetId: null,
      durationMs: asset.durationMs ?? 0,
      tags: [],
      features,
      detectedLabel: meta.detectedLabel,
      inLibrary: meta.inLibrary,
    });
    notifyLibraryChanged();
    return c;
  } catch (err) {
    await lib.media.setStatus(asset.id, 'FAILED');
    throw err;
  }
}

/**
 * Camera video → library capture: the MP4 (played in My Jams), its audio as a
 * WAV (what Studio uses), and its most representative frame as the card image.
 */
export async function saveVideoCapture(videoPath: string, meta: CaptureMeta): Promise<Capture> {
  const s = await mediaStore();
  const lib = await getLibrary();
  const videoUri = uriOf(videoPath);
  const probe = await WorldJamMedia.probe(pathOf(videoUri));
  const audioTemp = s.tempUri('wav');
  const thumbTemp = s.tempUri('jpg');
  let audioOk = false;
  if (probe.hasAudio) {
    await WorldJamMedia.decodeToWav(pathOf(videoUri), pathOf(audioTemp), { sampleRate: 48000, mono: true });
    audioOk = true;
  }
  const frame = await WorldJamMedia.extractFrame(pathOf(videoUri), pathOf(thumbTemp), { maxSize: 640, candidates: 5, quality: 85 }).catch(() => null);
  const features = audioOk ? await analyze(pathOf(audioTemp), 'VIDEO') : null;

  const video = await s.commit(videoUri, {
    kind: 'VIDEO_CAPTURE', dir: 'video', ext: 'mp4', mimeType: probe.mimeType ?? 'video/mp4',
    durationMs: probe.durationMs, width: probe.width, height: probe.height, sampleRate: probe.sampleRate, channels: probe.channels,
  });
  const audio = audioOk
    ? await s.commit(audioTemp, { kind: 'AUDIO_CAPTURE', dir: 'audio', ext: 'wav', mimeType: 'audio/wav', durationMs: probe.durationMs, sampleRate: 48000, channels: 1 })
    : null;
  const thumb = frame
    ? await s.commit(thumbTemp, { kind: 'THUMBNAIL', dir: 'thumb', ext: 'jpg', mimeType: 'image/jpeg', width: frame.width, height: frame.height })
    : null;
  try {
    const c = await lib.captures.create({
      name: meta.name,
      description: meta.description,
      type: 'VIDEO',
      mediaAssetId: video.id,
      audioAssetId: audio?.id ?? null,
      thumbnailAssetId: thumb?.id ?? null,
      durationMs: probe.durationMs,
      tags: [],
      features,
      detectedLabel: meta.detectedLabel,
      inLibrary: meta.inLibrary,
    });
    notifyLibraryChanged();
    return c;
  } catch (err) {
    await lib.media.markDeleted([video.id, audio?.id ?? null, thumb?.id ?? null]);
    throw err;
  }
}

/** Soft-deletes a capture and cleans its files in the background. */
export async function deleteCapture(id: string): Promise<void> {
  const lib = await getLibrary();
  await lib.captures.softDelete(id);
  notifyLibraryChanged();
  void mediaStore().then((s) => s.cleanup());
}
