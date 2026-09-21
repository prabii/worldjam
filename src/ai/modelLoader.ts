import * as FileSystem from 'expo-file-system';
import { registerGemmaRuntime } from '@/ai/gemma';
import {
  MODEL_SEARCH_PATHS,
  createLlamaRuntime,
  formatGemmaPrompt,
  promptFormatterFor,
  type LlamaRuntimeHandle,
} from '@/ai/runtimes/llamaRuntime';

/**
 * Finds and loads the on-device model, in the background.
 *
 * The rule from HLD v2 §4 is that the interaction loop never waits on the
 * model. So this runs detached: the app is fully playable on the rule-based
 * arranger from the first frame, and the model simply upgrades the
 * arrangements whenever it finishes loading — or never, if no file is present.
 */

export type ModelStatus =
  | { state: 'idle' }
  | { state: 'searching' }
  | { state: 'loading'; path: string; sizeMb: number }
  | { state: 'ready'; path: string; sizeMb: number; loadMs: number }
  | { state: 'absent' }
  | { state: 'error'; message: string };

let status: ModelStatus = { state: 'idle' };
let handle: LlamaRuntimeHandle | null = null;
const listeners = new Set<(s: ModelStatus) => void>();

export function getModelStatus(): ModelStatus {
  return status;
}

export function subscribeModelStatus(fn: (s: ModelStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

function setStatus(next: ModelStatus): void {
  status = next;
  for (const fn of listeners) fn(next);
}

/** `size` is only present on the exists:true branch of FileInfo. */
function fileSizeMb(info: FileSystem.FileInfo): number {
  return info.exists && !info.isDirectory ? Math.round((info.size ?? 0) / 1e6) : 0;
}

/**
 * Recognised model filenames, most preferred first.
 *
 * Distributors name these inconsistently — the separator before the quant and
 * the position of "-it" both vary — so the list covers the spellings seen in
 * the wild. A directory scan (below) catches anything else, but only where
 * the directory is listable, which scoped storage does not guarantee.
 */
const CANDIDATE_NAMES = [
  'gemma-4-E2B_q4_0-it.gguf',
  'gemma-4-E2B-it-qat-q4_0.gguf',
  'gemma-4-E2B-it-q4_0.gguf',
  'gemma-4-e2b-it-q4_0.gguf',
  'gemma-4-E2B_q4_0.gguf',
  'gemma-3n-E2B-it-q4_0.gguf',
  'gemma-3-1b-it-q4_0.gguf',
  // Kept last: a smaller fallback for devices where Gemma cannot load.
  // The runtime picks the chat template from the file name, so either works.
  'Qwen3-1.7B-Q4_K_M.gguf',
];

/**
 * Looks for a .gguf in the usual places.
 *
 * Any .gguf in a search directory is accepted, not just the known names — a
 * user who renamed the file should not be told there is no model.
 */
export async function findModel(): Promise<{ path: string; sizeMb: number } | null> {
  // The app's own document directory first. Android 13+ scoped storage blocks
  // reads of non-media files on shared storage even WITH
  // READ_EXTERNAL_STORAGE granted, so a model anywhere else may be visible to
  // adb yet unreadable to the app. Private storage always works.
  const privateDir = FileSystem.documentDirectory;
  if (privateDir) {
    for (const name of CANDIDATE_NAMES) {
      try {
        const info = await FileSystem.getInfoAsync(`${privateDir}${name}`);
        if (info.exists && !info.isDirectory) {
          return { path: info.uri.replace('file://', ''), sizeMb: fileSizeMb(info) };
        }
      } catch {
        // try the next candidate
      }
    }
    try {
      const entries = await FileSystem.readDirectoryAsync(privateDir);
      const gguf = entries.find((e) => e.toLowerCase().endsWith('.gguf'));
      if (gguf) {
        const info = await FileSystem.getInfoAsync(`${privateDir}${gguf}`);
        return {
          path: `${privateDir}${gguf}`.replace('file://', ''),
          sizeMb: fileSizeMb(info),
        };
      }
    } catch {
      // not listable; fall through
    }
  }

  for (const dir of MODEL_SEARCH_PATHS) {
    // Try the known names directly first; listing a directory can fail under
    // scoped storage even when a direct read of a file in it succeeds.
    for (const name of CANDIDATE_NAMES) {
      const path = `file://${dir}${name}`;
      try {
        const info = await FileSystem.getInfoAsync(path);
        if (info.exists && !info.isDirectory) {
          return { path: `${dir}${name}`, sizeMb: fileSizeMb(info) };
        }
      } catch {
        // Unreadable path — try the next candidate.
      }
    }

    try {
      const entries = await FileSystem.readDirectoryAsync(`file://${dir}`);
      // Prefer a Gemma file when several are present.
      const ggufs = entries.filter((e) => e.toLowerCase().endsWith('.gguf'));
      const gguf =
        ggufs.find((e) => e.toLowerCase().includes('gemma')) ?? ggufs[0];
      if (gguf) {
        const info = await FileSystem.getInfoAsync(`file://${dir}${gguf}`);
        return { path: `${dir}${gguf}`, sizeMb: fileSizeMb(info) };
      }
    } catch {
      // Directory not listable; move on.
    }
  }
  return null;
}

/**
 * Searches for and loads the model. Resolves when done either way; it never
 * rejects, because a missing model is a normal state, not a failure.
 */
export async function initModel(explicitPath?: string): Promise<void> {
  if (status.state === 'loading' || status.state === 'ready') return;

  setStatus({ state: 'searching' });

  let found: { path: string; sizeMb: number } | null = null;

  if (explicitPath) {
    try {
      const info = await FileSystem.getInfoAsync(`file://${explicitPath}`);
      if (info.exists) {
        found = { path: explicitPath, sizeMb: fileSizeMb(info) };
      }
    } catch {
      // Fall through to the search.
    }
  }

  found ??= await findModel();

  if (!found) {
    setStatus({ state: 'absent' });
    return;
  }

  // A .task file is MediaPipe's format; llama.cpp cannot read it. Say so
  // plainly rather than surfacing an opaque native load failure.
  if (found.path.endsWith('.task')) {
    setStatus({
      state: 'error',
      message:
        'Found a .task model (MediaPipe format). llama.cpp needs a .gguf file — download the GGUF build instead.',
    });
    return;
  }

  setStatus({ state: 'loading', path: found.path, sizeMb: found.sizeMb });
  const started = Date.now();

  try {
    const runtime = createLlamaRuntime({ modelPath: found.path });
    await runtime.load();

    // Wrap generate() in the model's own chat template. The orchestrator
    // builds a plain instruction; the template belongs to the runtime.
    // Chosen from the file name, so dropping a Qwen GGUF on the device works
    // without a code change — the wrong template does not error, it just
    // quietly degrades the output.
    const { format } = promptFormatterFor(found.path);

    registerGemmaRuntime({
      name: runtime.name,
      isReady: () => runtime.isReady(),
      generate: (prompt, maxTokens) => runtime.generate(format(prompt), maxTokens),
    });

    handle = runtime;
    setStatus({
      state: 'ready',
      path: found.path,
      sizeMb: found.sizeMb,
      loadMs: Date.now() - started,
    });
  } catch (err) {
    setStatus({
      state: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function releaseModel(): Promise<void> {
  registerGemmaRuntime(null);
  if (handle) {
    await handle.release();
    handle = null;
  }
  setStatus({ state: 'idle' });
}

/** Human-readable one-liner for the status chip. */
export function describeStatus(s: ModelStatus): string {
  switch (s.state) {
    case 'idle':
      return 'Model not loaded';
    case 'searching':
      return 'Looking for model…';
    case 'loading':
      return `Loading model (${s.sizeMb} MB)…`;
    case 'ready': {
      const file = s.path.split('/').pop() ?? s.path;
      return `Gemma ready · ${file} · ${(s.loadMs / 1000).toFixed(1)}s`;
    }
    case 'absent':
      return 'No model found — using rule-based arranger';
    case 'error':
      return s.message;
  }
}
