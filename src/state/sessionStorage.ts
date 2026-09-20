import * as FileSystem from 'expo-file-system';
import type { ArrangementPlan, Loop, Style, WorldJamObject } from '@/types';
import type { LyricSet } from '@/ai/lyrics';

/**
 * Saved jam sessions.
 *
 * A session is stored as one JSON manifest plus one raw PCM file per captured
 * sound. The audio is deliberately kept out of the JSON: a few seconds of
 * 48 kHz float PCM is hundreds of thousands of numbers, and serialising that
 * into JSON would make a single save tens of megabytes of text and take
 * seconds to parse back.
 *
 * PCM is written as base64-encoded 16-bit integers instead — a quarter the
 * size of float32, and audibly identical for phone-mic recordings.
 */

const SESSIONS_DIR = `${FileSystem.documentDirectory}sessions/`;

export interface SessionSummary {
  id: string;
  name: string;
  objectCount: number;
  style: Style;
  bpm: number;
  durationSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export interface SavedSession extends SessionSummary {
  objects: WorldJamObject[];
  loops: Loop[];
  plan: ArrangementPlan | null;
  lyrics: LyricSet | null;
  key: string | null;
  bars: number;
  /** Slot -> relative filename of the PCM blob. */
  audioFiles: Record<number, string>;
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(SESSIONS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(SESSIONS_DIR, { intermediates: true });
  }
}

/**
 * Encodes float PCM as base64 16-bit little-endian.
 *
 * Chunked because building one giant string from hundreds of thousands of
 * samples at once spikes memory on a phone.
 */
function pcmToBase64(pcm: number[]): string {
  const bytes = new Uint8Array(pcm.length * 2);
  const view = new DataView(bytes.buffer);

  for (let i = 0; i < pcm.length; i++) {
    const clamped = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let i = 0;

  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63];
  }

  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + '=';
  }

  return out;
}

/** Decodes base64 16-bit PCM back to floats. */
function base64ToPcm(b64: string): number[] {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;

  const clean = b64.replace(/=+$/, '');
  const byteLength = Math.floor((clean.length * 3) / 4);
  const bytes = new Uint8Array(byteLength);

  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const e1 = lookup[clean.charCodeAt(i)];
    const e2 = lookup[clean.charCodeAt(i + 1)];
    const e3 = lookup[clean.charCodeAt(i + 2)];
    const e4 = lookup[clean.charCodeAt(i + 3)];

    if (p < byteLength) bytes[p++] = (e1 << 2) | (e2 >> 4);
    if (p < byteLength) bytes[p++] = ((e2 & 15) << 4) | (e3 >> 2);
    if (p < byteLength) bytes[p++] = ((e3 & 3) << 6) | e4;
  }

  const view = new DataView(bytes.buffer);
  const out = new Array<number>(Math.floor(byteLength / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return out;
}

export interface SaveInput {
  name: string;
  objects: WorldJamObject[];
  pcmBySlot: Map<number, number[]>;
  loops: Loop[];
  plan: ArrangementPlan | null;
  lyrics: LyricSet | null;
  style: Style;
  bpm: number;
  bars: number;
  key: string | null;
  /** Reuse an id to overwrite an existing session. */
  id?: string;
}

/** Writes a session to disk. Returns its id. */
export async function saveSession(input: SaveInput): Promise<string> {
  await ensureDir();

  const id = input.id ?? `jam-${Date.now()}`;
  const dir = `${SESSIONS_DIR}${id}/`;

  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }

  // Audio goes to its own files, one per slot.
  const audioFiles: Record<number, string> = {};
  for (const [slot, pcm] of input.pcmBySlot) {
    if (!pcm || pcm.length === 0) continue;
    const filename = `slot-${slot}.pcm`;
    await FileSystem.writeAsStringAsync(`${dir}${filename}`, pcmToBase64(pcm), {
      encoding: FileSystem.EncodingType.Base64,
    });
    audioFiles[slot] = filename;
  }

  const durationSeconds = (input.bars * 4 * 60) / Math.max(1, input.bpm);

  const session: SavedSession = {
    id,
    name: input.name,
    objectCount: input.objects.length,
    style: input.style,
    bpm: input.bpm,
    bars: input.bars,
    key: input.key,
    durationSeconds,
    createdAt: input.id ? Date.now() : Date.now(),
    updatedAt: Date.now(),
    objects: input.objects,
    loops: input.loops,
    plan: input.plan,
    lyrics: input.lyrics,
    audioFiles,
  };

  await FileSystem.writeAsStringAsync(
    `${dir}session.json`,
    JSON.stringify(session),
  );

  return id;
}

/** Lists saved sessions, newest first. Never throws. */
export async function listSessions(): Promise<SessionSummary[]> {
  try {
    await ensureDir();
    const entries = await FileSystem.readDirectoryAsync(SESSIONS_DIR);

    const out: SessionSummary[] = [];
    for (const entry of entries) {
      try {
        const json = await FileSystem.readAsStringAsync(
          `${SESSIONS_DIR}${entry}/session.json`,
        );
        const s = JSON.parse(json) as SavedSession;
        out.push({
          id: s.id,
          name: s.name,
          objectCount: s.objectCount,
          style: s.style,
          bpm: s.bpm,
          durationSeconds: s.durationSeconds,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        });
      } catch {
        // A half-written session should not hide the rest.
      }
    }

    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/** Loads a session and its audio. Returns null when it cannot be read. */
export async function loadSession(
  id: string,
): Promise<{ session: SavedSession; pcmBySlot: Map<number, number[]> } | null> {
  try {
    const dir = `${SESSIONS_DIR}${id}/`;
    const json = await FileSystem.readAsStringAsync(`${dir}session.json`);
    const session = JSON.parse(json) as SavedSession;

    const pcmBySlot = new Map<number, number[]>();
    for (const [slotStr, filename] of Object.entries(session.audioFiles ?? {})) {
      try {
        const b64 = await FileSystem.readAsStringAsync(`${dir}${filename}`, {
          encoding: FileSystem.EncodingType.Base64,
        });
        pcmBySlot.set(Number(slotStr), base64ToPcm(b64));
      } catch {
        // A missing blob loses one sound, not the whole session.
      }
    }

    return { session, pcmBySlot };
  } catch {
    return null;
  }
}

export async function deleteSession(id: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(`${SESSIONS_DIR}${id}`, { idempotent: true });
  } catch {
    // Already gone is the desired end state.
  }
}

export async function renameSession(id: string, name: string): Promise<void> {
  const loaded = await loadSession(id);
  if (!loaded) return;
  loaded.session.name = name;
  loaded.session.updatedAt = Date.now();
  await FileSystem.writeAsStringAsync(
    `${SESSIONS_DIR}${id}/session.json`,
    JSON.stringify(loaded.session),
  );
}

/** Exposed for tests. */
export const __internal = { pcmToBase64, base64ToPcm };
