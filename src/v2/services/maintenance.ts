import * as FileSystem from 'expo-file-system';

import type { SqlLibrary } from '../data/repos';
import { mediaStore, normalizeTake } from './capture';
import { captureAudioPath } from './media';
import { refreshModelStatus } from './models';
import { installStarterLibrary } from './starter';

/**
 * Startup housekeeping (08_QA: "no AI failure corrupts the library"): jobs a
 * killed app left mid-flight are marked failed, temp files from interrupted
 * recordings/renders are cleared, and files of deleted items are removed.
 */
export async function resumePendingWork(lib: SqlLibrary): Promise<void> {
  try {
    await lib.jobs.failInterrupted();
    const store = await mediaStore();
    await store.cleanup();
    await refreshModelStatus();
    await normalizeOldCaptures(lib);
  } catch {
    // Housekeeping must never block the app from opening.
  }
  try {
    await installStarterLibrary(lib);
  } catch {
    // Housekeeping must never block the app from opening.
  }
}

/** Captures saved before takes were normalized get the same level fix once. */
async function normalizeOldCaptures(lib: SqlLibrary): Promise<void> {
  const marker = `${FileSystem.documentDirectory ?? ''}v2/.normalized-1`;
  if ((await FileSystem.getInfoAsync(marker)).exists) return;
  const caps = await lib.captures.list({ limit: 5000 });
  let failed = false;
  for (const c of caps) {
    const p = await captureAudioPath(c);
    if (p && !(await normalizeTake(p))) failed = true;
  }
  // An older native build cannot normalize yet: try again next launch.
  if (!failed) await FileSystem.writeAsStringAsync(marker, String(Date.now()));
}
