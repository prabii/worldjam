import * as FileSystem from 'expo-file-system';
import WorldJamAudio from 'worldjam-audio';

import type { Capture } from '../contracts/library';
import { getLibrary } from '../services/library';
import { captureAudioPath } from '../services/media';
import { useStudio } from '../services/studio';
import { addScore, type ScoreEntry } from './logic';

/** Engine slots the games use (Studio pads live in 0..63). */
const BASE_SLOT = 72;

/**
 * The player's own sounds as a game kit: loaded into spare engine slots so a
 * tap plays with the engine's low latency. Prefers the Studio session's
 * sounds, then the newest captures in My Jams.
 */
export async function pickKitCaptures(max: number, preferIds: string[] = []): Promise<Capture[]> {
  const lib = await getLibrary();
  const out: Capture[] = [];
  const add = (c: Capture | undefined | null) => {
    if (c && out.length < max && !out.some((x) => x.id === c.id)) out.push(c);
  };
  if (preferIds.length) for (const c of await lib.captures.getMany(preferIds)) add(c);
  const st = useStudio.getState();
  for (const s of st.session?.sources ?? []) add(st.captures[s.captureId]);
  for (const c of await lib.captures.list({ sort: 'newest', limit: 40 })) add(c);
  return out;
}

export async function loadKit(captures: Capture[]): Promise<boolean[]> {
  const ok: boolean[] = [];
  for (let i = 0; i < captures.length; i++) {
    const path = await captureAudioPath(captures[i]);
    ok.push(!!path && !!WorldJamAudio.loadSampleFromWav && (await WorldJamAudio.loadSampleFromWav(BASE_SLOT + i, path, 1, 0, 0)));
  }
  return ok;
}

export function playKit(index: number, gain = 1): void {
  const slot = BASE_SLOT + index;
  if (WorldJamAudio.triggerPitched) WorldJamAudio.triggerPitched(slot, gain, 0.5, 1, false);
  else WorldJamAudio.trigger(slot, gain, 0.5);
}

// ---------------------------------------------------------------- scores (on this phone only)

const BOARD = () => `${FileSystem.documentDirectory ?? ''}v2/leaderboard.json`;
const ECHO_BEST = () => `${FileSystem.documentDirectory ?? ''}v2/echo-best.json`;

export async function readBoard(): Promise<ScoreEntry[]> {
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(BOARD())) as ScoreEntry[];
  } catch {
    return [];
  }
}

export async function saveScore(entry: ScoreEntry): Promise<ScoreEntry[]> {
  const board = addScore(await readBoard(), entry);
  await FileSystem.writeAsStringAsync(BOARD(), JSON.stringify(board)).catch(() => {});
  return board;
}

export async function readEchoBest(): Promise<number> {
  try {
    return Number(JSON.parse(await FileSystem.readAsStringAsync(ECHO_BEST())).best) || 0;
  } catch {
    return 0;
  }
}

export async function saveEchoBest(best: number): Promise<void> {
  await FileSystem.writeAsStringAsync(ECHO_BEST(), JSON.stringify({ best })).catch(() => {});
}
