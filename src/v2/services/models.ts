import * as FileSystem from 'expo-file-system';
import { create } from 'zustand';

import WorldJamAudio from 'worldjam-audio';
import { findModel, initModel } from '@/ai/modelLoader';
import { WorldJamMedia, isMediaModuleAvailable } from '../../../modules/worldjam-media/src';

/**
 * On-device model packs. None fit in an APK, so a downloaded app fetches them
 * once (resumable, size + SHA-256 verified) into its own files directory —
 * the same place each runtime already looks. Everything that is not AI works
 * without them.
 */
export type PackId = 'director' | 'producer' | 'texture';

interface PackFile {
  name: string;
  url: string;
  bytes: number;
  sha256: string;
}

export interface ModelPack {
  id: PackId;
  title: string;
  body: string;
  /** Sub-directory of the app files dir ('' = root). */
  dir: string;
  files: PackFile[];
}

const HF = 'https://huggingface.co';

export const PACKS: ModelPack[] = [
  {
    id: 'director',
    title: 'AI music director',
    body: 'Gemma 4 E2B plans arrangements, edits by prompt and writes lyrics.',
    dir: '',
    files: [
      {
        name: 'gemma-4-E2B_q4_0-it.gguf',
        url: `${HF}/google/gemma-4-E2B-it-qat-q4_0-gguf/resolve/main/gemma-4-E2B_q4_0-it.gguf`,
        bytes: 3349516256,
        sha256: 'fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634',
      },
    ],
  },
  {
    id: 'producer',
    title: 'AI producer',
    body: 'ACE-Step 1.5 re-produces the mix of your captures in the style you ask for.',
    dir: 'acestep',
    files: [
      {
        name: 'Qwen3-Embedding-0.6B-Q8_0.gguf',
        url: `${HF}/Serveurperso/ACE-Step-1.5-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q8_0.gguf`,
        bytes: 784144960,
        sha256: '972f23255e46adfe744a0eb9a0039f3c63988f65753b0968d776e8b27168c321',
      },
      {
        name: 'acestep-v15-turbo-Q4_K_M.gguf',
        url: `${HF}/Serveurperso/ACE-Step-1.5-GGUF/resolve/main/acestep-v15-turbo-Q4_K_M.gguf`,
        bytes: 1445710272,
        sha256: '55b4d8514850f3d0f82536f37e99673aaf48df802b5ae5b153eea32a2e2daa5e',
      },
      {
        name: 'vae-BF16.gguf',
        url: `${HF}/Serveurperso/ACE-Step-1.5-GGUF/resolve/main/vae-BF16.gguf`,
        bytes: 337420928,
        sha256: '0599862ac5d15cd308e1d2e368373aea6c02e25ebd1737ad4a4562a0901b0ef8',
      },
    ],
  },
  {
    id: 'texture',
    title: 'AI texture',
    body: 'Stable Audio Open Small adds a short atmosphere under your sounds.',
    dir: 'sao',
    files: [
      {
        name: 'stable-audio-open-small-dit-0.3B-v1.0-Q5_K_M.gguf',
        url: `${HF}/thepatch/stable-audio-open-small-GGUF/resolve/main/stable-audio-open-small-dit-0.3B-v1.0-Q5_K_M.gguf`,
        bytes: 256233440,
        sha256: '87d79dddd8e3f9a26adbd83790f3e914ad3c8ef4febbeb4b1d0c862cb00a6002',
      },
      {
        name: 't5-base-encoder-0.1B-v1.0-Q5_K_M.gguf',
        url: `${HF}/thepatch/stable-audio-open-small-GGUF/resolve/main/t5-base-encoder-0.1B-v1.0-Q5_K_M.gguf`,
        bytes: 80310112,
        sha256: 'a68bfb05f22eef96bbed50a711b1df553890b3ed78d9aba4f0fe09c986281769',
      },
      {
        name: 'stable-audio-open-small-oobleck-v1.0-Q5_K_M.gguf',
        url: `${HF}/thepatch/stable-audio-open-small-GGUF/resolve/main/stable-audio-open-small-oobleck-v1.0-Q5_K_M.gguf`,
        bytes: 99548608,
        sha256: '4ee1d7d05839cdb9372f2f871ba409494daaefb758eaf20be5dc1af3d9a1eeaa',
      },
    ],
  },
];

export type PackStatus =
  | { state: 'checking' }
  | { state: 'installed' }
  | { state: 'missing' }
  | { state: 'downloading'; received: number; total: number; file: string }
  | { state: 'verifying'; file: string }
  | { state: 'error'; message: string };

export const useModels = create<Record<PackId, PackStatus>>(() => ({
  director: { state: 'checking' },
  producer: { state: 'checking' },
  texture: { state: 'checking' },
}));

function filesDir(): string {
  return FileSystem.documentDirectory ?? '';
}

function destUri(pack: ModelPack, file: PackFile): string {
  return `${filesDir()}${pack.dir ? pack.dir + '/' : ''}${file.name}`;
}

/** Whether the runtime can already use the pack (internal files OR adb-pushed external files). */
async function runtimeReady(id: PackId): Promise<boolean> {
  if (id === 'director') return (await findModel()) != null;
  // Native returns null when ready, a reason string otherwise.
  const check = id === 'producer' ? WorldJamAudio.aceStepUnavailableReason : WorldJamAudio.textureUnavailableReason;
  if (typeof check !== 'function') return false;
  try {
    return check() == null;
  } catch {
    return false;
  }
}

export async function refreshModelStatus(): Promise<void> {
  for (const p of PACKS) {
    const s = useModels.getState()[p.id].state;
    if (s === 'downloading' || s === 'verifying') continue;
    useModels.setState({ [p.id]: { state: (await runtimeReady(p.id)) ? 'installed' : 'missing' } } as Partial<Record<PackId, PackStatus>>);
  }
}

const active = new Map<PackId, FileSystem.DownloadResumable>();
const pausing = new Set<PackId>();

function set(id: PackId, status: PackStatus) {
  useModels.setState({ [id]: status } as Partial<Record<PackId, PackStatus>>);
}

/**
 * Downloads every missing file of a pack. Keeps partial files and resume data
 * next to the target, so an interrupted download continues where it stopped.
 */
export async function downloadPack(id: PackId): Promise<void> {
  const pack = PACKS.find((p) => p.id === id)!;
  if (active.has(id)) return;
  const need = pack.files.reduce((n, f) => n + f.bytes, 0);
  const free = await FileSystem.getFreeDiskStorageAsync().catch(() => Number.MAX_SAFE_INTEGER);
  if (free < need + 500_000_000) {
    set(id, { state: 'error', message: `Needs ${(need / 1e9).toFixed(1)} GB free; only ${(free / 1e9).toFixed(1)} GB left.` });
    return;
  }
  const total = need;
  let doneBytes = 0;
  try {
    if (pack.dir) await FileSystem.makeDirectoryAsync(`${filesDir()}${pack.dir}`, { intermediates: true }).catch(() => {});
    for (const file of pack.files) {
      const dest = destUri(pack, file);
      const info = await FileSystem.getInfoAsync(dest);
      if (info.exists && !info.isDirectory && info.size === file.bytes) {
        doneBytes += file.bytes;
        continue;
      }
      const part = `${dest}.part`;
      const resumeFile = `${dest}.resume.json`;
      const resume = await FileSystem.readAsStringAsync(resumeFile).catch(() => null);
      const onProgress = (p: FileSystem.DownloadProgressData) =>
        set(id, { state: 'downloading', received: doneBytes + p.totalBytesWritten, total, file: file.name });
      const dl = FileSystem.createDownloadResumable(file.url, part, {}, onProgress, resume ? JSON.parse(resume).resumeData : undefined);
      active.set(id, dl);
      // Persist resume data every few seconds so a killed app can continue.
      const saver = setInterval(() => {
        FileSystem.writeAsStringAsync(resumeFile, JSON.stringify(dl.savable())).catch(() => {});
      }, 4000);
      let result: FileSystem.FileSystemDownloadResult | undefined;
      try {
        result = resume ? await dl.resumeAsync() : await dl.downloadAsync();
      } finally {
        clearInterval(saver);
        active.delete(id);
      }
      if (!result && pausing.delete(id)) {
        set(id, { state: 'missing' });
        return;
      }
      if (!result || result.status >= 400) throw new Error(`Download failed (${result?.status ?? 'cancelled'})`);
      set(id, { state: 'verifying', file: file.name });
      const got = await FileSystem.getInfoAsync(part);
      if (!got.exists || got.size !== file.bytes) throw new Error(`${file.name}: size mismatch`);
      if (isMediaModuleAvailable) {
        const sha = await WorldJamMedia.sha256(part.replace(/^file:\/\//, ''));
        if (sha.toLowerCase() !== file.sha256) {
          await FileSystem.deleteAsync(part, { idempotent: true });
          throw new Error(`${file.name}: checksum mismatch, removed — try again`);
        }
      }
      await FileSystem.moveAsync({ from: part, to: dest });
      await FileSystem.deleteAsync(resumeFile, { idempotent: true });
      doneBytes += file.bytes;
    }
    set(id, { state: 'installed' });
    if (id === 'director') void initModel();
  } catch (err) {
    set(id, { state: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

export async function pauseDownload(id: PackId): Promise<void> {
  const dl = active.get(id);
  if (!dl) return;
  pausing.add(id);
  const saved = await dl.pauseAsync().catch(() => null);
  if (saved) {
    const pack = PACKS.find((p) => p.id === id)!;
    for (const f of pack.files) {
      // The paused file is whichever one has a .part on disk.
      const dest = destUri(pack, f);
      const part = await FileSystem.getInfoAsync(`${dest}.part`);
      if (part.exists) await FileSystem.writeAsStringAsync(`${dest}.resume.json`, JSON.stringify(saved)).catch(() => {});
    }
  }
}

export function packSizeGb(p: ModelPack): string {
  return (p.files.reduce((n, f) => n + f.bytes, 0) / 1e9).toFixed(1);
}
