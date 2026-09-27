import type { SqlLibrary } from '../data/repos';
import { mediaStore } from './capture';
import { refreshModelStatus } from './models';

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
  } catch {
    // Housekeeping must never block the app from opening.
  }
}
