import type { MediaAsset, MediaKind } from '../contracts/library';
import type { SqlMediaRepository } from './repos';
import { uuid } from './uuid';

/** File operations the store needs; expo-file-system on the phone, a fake in tests. URIs are file:// strings. */
export interface FileOps {
  exists(uri: string): Promise<boolean>;
  size(uri: string): Promise<number>;
  move(from: string, to: string): Promise<void>;
  remove(uri: string): Promise<void>;
  mkdir(uri: string): Promise<void>;
  list(dirUri: string): Promise<string[]>;
  freeBytes(): Promise<number>;
}

/** 07_DATA_MEDIA_CONTRACT file layout, under <documents>/v2/. */
export const DIRS = {
  audio: 'captures/audio',
  video: 'captures/video',
  thumb: 'captures/thumb',
  track: 'tracks/audio',
  waveform: 'tracks/waveforms',
  drafts: 'drafts',
  exports: 'exports',
  temp: 'temp',
} as const;
export type MediaDir = keyof typeof DIRS;

/** New captures are refused below this much free space, so a save never fills the disk. */
export const MIN_FREE_BYTES = 200 * 1024 * 1024;

export class InsufficientStorageError extends Error {
  constructor(public readonly freeBytes: number) {
    super(`Not enough free space (${Math.round(freeBytes / 1e6)} MB left).`);
  }
}

export interface CommitMeta {
  kind: MediaKind;
  dir: MediaDir;
  ext: string;
  mimeType: string;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  sampleRate?: number | null;
  channels?: number | null;
  sha256?: string | null;
}

export class MediaStore {
  constructor(
    private readonly media: SqlMediaRepository,
    private readonly fs: FileOps,
    /** file:// URI of the app document directory, with trailing slash. */
    private readonly baseUri: string,
  ) {}

  rel(dir: MediaDir, name: string): string {
    return `v2/${DIRS[dir]}/${name}`;
  }

  uri(relPath: string): string {
    return this.baseUri + relPath;
  }

  /** Creates the layout and clears leftovers from a previous run's temp dir. */
  async init(): Promise<void> {
    for (const d of Object.keys(DIRS) as MediaDir[]) await this.fs.mkdir(this.uri(`v2/${DIRS[d]}`));
    for (const f of await this.fs.list(this.uri(`v2/${DIRS.temp}`))) {
      await this.fs.remove(this.uri(`v2/${DIRS.temp}/${f}`)).catch(() => {});
    }
  }

  /** A fresh temp location for a recording/render in progress. */
  tempUri(ext: string): string {
    return this.uri(this.rel('temp', `${uuid()}.${ext}`));
  }

  async ensureSpace(minBytes = MIN_FREE_BYTES): Promise<void> {
    const free = await this.fs.freeBytes();
    if (free < minBytes) throw new InsufficientStorageError(free);
  }

  /**
   * Atomic save: validate the temp file, move it to its UUID name, then record
   * it READY. If the DB write fails the moved file is removed, so disk and DB
   * never disagree.
   */
  async commit(tempUri: string, meta: CommitMeta): Promise<MediaAsset> {
    if (!(await this.fs.exists(tempUri))) throw new Error('Recording was not written');
    const size = await this.fs.size(tempUri);
    if (size <= 0) throw new Error('Recording is empty');
    const id = uuid();
    const rel = this.rel(meta.dir, `${id}.${meta.ext}`);
    await this.fs.move(tempUri, this.uri(rel));
    try {
      return await this.media.create({
        id,
        kind: meta.kind,
        path: rel,
        mimeType: meta.mimeType,
        sizeBytes: size,
        durationMs: meta.durationMs ?? null,
        width: meta.width ?? null,
        height: meta.height ?? null,
        sampleRate: meta.sampleRate ?? null,
        channels: meta.channels ?? null,
        sha256: meta.sha256 ?? null,
        status: 'READY',
      });
    } catch (err) {
      await this.fs.remove(this.uri(rel)).catch(() => {});
      throw err;
    }
  }

  async discard(uri: string): Promise<void> {
    await this.fs.remove(uri).catch(() => {});
  }

  /**
   * Removes files whose owners were soft-deleted. A failed removal stays
   * pending and is retried next time.
   */
  async cleanup(): Promise<{ removed: number; failed: number }> {
    let removed = 0;
    let failed = 0;
    for (const a of await this.media.listPendingCleanup()) {
      try {
        const uri = this.uri(a.path);
        if (await this.fs.exists(uri)) await this.fs.remove(uri);
        await this.media.markCleaned(a.id);
        removed++;
      } catch {
        failed++;
      }
    }
    return { removed, failed };
  }
}
