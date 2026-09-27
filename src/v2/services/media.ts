import * as FileSystem from 'expo-file-system';

import { WorldJamMedia, isMediaModuleAvailable } from '../../../modules/worldjam-media/src';
import type { Capture, MediaAsset } from '../contracts/library';
import { getLibrary } from './library';

/**
 * Asset id → file location, cached. MediaAsset.path is relative to the app's
 * document directory (07_DATA_MEDIA_CONTRACT: display names live in the DB,
 * files are UUIDs), so the absolute location is derived here in one place.
 */
const assets = new Map<string, MediaAsset>();

function docDir(): string {
  return FileSystem.documentDirectory ?? 'file:///data/user/0/com.prxfr.worldjam/files/';
}

/** file:// URI for a relative media path. */
export function uriFor(relPath: string): string {
  return docDir() + relPath.replace(/^\/+/, '');
}

/** Absolute filesystem path (no scheme) — what native modules take. */
export function pathFor(relPath: string): string {
  return uriFor(relPath).replace(/^file:\/\//, '');
}

export async function getAsset(id: string | null): Promise<MediaAsset | null> {
  if (!id) return null;
  const hit = assets.get(id);
  if (hit) return hit;
  const lib = await getLibrary();
  const a = await lib.media.get(id);
  if (a) assets.set(id, a);
  return a;
}

export async function assetUri(id: string | null): Promise<string | null> {
  const a = await getAsset(id);
  return a ? uriFor(a.path) : null;
}

export async function assetPath(id: string | null): Promise<string | null> {
  const a = await getAsset(id);
  return a ? pathFor(a.path) : null;
}

/** The audio a capture contributes to music: the WAV master (video: its extracted audio). */
export async function captureAudioPath(c: Capture): Promise<string | null> {
  return (await assetPath(c.audioAssetId)) ?? (c.type === 'VIDEO' ? null : await assetPath(c.mediaAssetId));
}

const peaks = new Map<string, number[]>();

/** Waveform envelope for a capture card, computed natively once and cached. */
export async function capturePeaks(c: Capture, buckets = 48): Promise<number[]> {
  const key = `${c.id}:${buckets}`;
  const hit = peaks.get(key);
  if (hit) return hit;
  if (!isMediaModuleAvailable) return [];
  const path = await captureAudioPath(c);
  if (!path) return [];
  try {
    const p = await WorldJamMedia.wavPeaks(path, buckets);
    peaks.set(key, p);
    return p;
  } catch {
    return [];
  }
}

export function forgetAsset(id: string): void {
  assets.delete(id);
}
