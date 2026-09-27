/**
 * Library contract (07_DATA_MEDIA_CONTRACT.md): entities, repository
 * interfaces and the SQL executor they run on.
 *
 * SQLite (expo-sqlite on the phone, sql.js in Jest) stores metadata and
 * relationships; binary media lives in app-private files. Repositories are the
 * only boundary the UI/domain touch.
 */

import type { MusicPlan, PlanLyrics, StyleId } from './musicPlan';

// ---------------------------------------------------------------- executor

export type SqlValue = string | number | null;

/**
 * The minimal async SQL surface both drivers implement. `run` returns the
 * number of changed rows; `all`/`get` return plain row objects.
 */
export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T | null>;
  /** Runs fn inside BEGIN/COMMIT, ROLLBACK on throw. Not re-entrant. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------- entities

export type MediaKind =
  | 'AUDIO_CAPTURE'
  | 'VIDEO_CAPTURE'
  | 'HUM'
  | 'VOCAL'
  | 'MANUAL_TRACK'
  | 'AI_TRACK'
  | 'EXPORT'
  | 'THUMBNAIL'
  | 'WAVEFORM';

export type MediaStatus = 'TEMP' | 'PROCESSING' | 'READY' | 'FAILED' | 'DELETED';

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  /** Path relative to the app document directory, e.g. "captures/audio/<uuid>.wav". */
  path: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  sampleRate: number | null;
  channels: number | null;
  sha256: string | null;
  status: MediaStatus;
  createdAt: number;
}

export type CaptureType = 'AUDIO' | 'VIDEO' | 'HUM' | 'VOCAL';

/** Derived analysis of a capture's audio (extractFeatures + onsets + pitch + hum melody). */
export interface FeatureVector {
  durationSec: number;
  rms: number;
  peak: number;
  /** Spectral centroid, Hz. */
  brightness: number;
  /** Seconds to -20 dB after the onset. */
  decay: number;
  /** 0..1 tonal vs noisy. */
  tonality: number;
  pitchHz: number | null;
  /** 0..1 — how percussive (short, transient). */
  transient: number;
  /** 0..1 — how sustained. */
  sustained: number;
  onsetCount: number;
  tempoBpm: number | null;
  /** Suggested role from the DSP, e.g. "percussion", "bass", "texture", "melodic". */
  suggestedRole: string;
  /** Hum/vocal only: detected key and simplified melody (MIDI, seconds). */
  melody?: { key: string | null; tempoBpm: number | null; notes: Array<{ midi: number; start: number; duration: number }> };
}

export interface Capture {
  id: string;
  name: string;
  description: string;
  type: CaptureType;
  /** Original media: WAV for audio/hum/vocal, MP4 for video. */
  mediaAssetId: string;
  /** Playable/decodable audio master (for video: the extracted audio WAV). */
  audioAssetId: string | null;
  /** Video frame (VIDEO) — audio captures use WorldJam artwork, null here. */
  thumbnailAssetId: string | null;
  durationMs: number;
  tags: string[];
  features: FeatureVector | null;
  /** Object name the camera suggested at capture time, if any. */
  detectedLabel: string | null;
  /**
   * false = session-only draft captured inside Studio that the user chose not
   * to save to My Jams. Hidden from library queries.
   */
  inLibrary: boolean;
  createdAt: number;
  updatedAt: number;
}

export type TrackMode = 'MANUAL' | 'AI';

export interface TrackSourceRef {
  captureId: string;
  /** Snapshot of the name/description at render time (captures may be renamed later). */
  name: string;
  description: string;
  role: string | null;
}

export interface Track {
  id: string;
  name: string;
  description: string;
  mode: TrackMode;
  audioAssetId: string;
  durationMs: number;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  style: StyleId | null;
  /** The plan this track was rendered from — tracks stay editable. */
  plan: MusicPlan | null;
  /** Waveform peaks (0..1), ~200 buckets, for cards and the player. */
  peaks: number[];
  lyricId: string | null;
  prompt: string | null;
  sources: TrackSourceRef[];
  versions: {
    model: string | null;
    kb: string | null;
    systemPrompt: string | null;
    renderer: string;
  };
  createdAt: number;
  updatedAt: number;
}

export interface Lyric {
  id: string;
  name: string;
  description: string;
  /** Plain text as edited by the user. */
  text: string;
  /** Structured form when AI-generated (verse/chorus...). */
  structured: PlanLyrics | null;
  language: string;
  style: StyleId | null;
  sourceTrackId: string | null;
  sourceCaptureIds: string[];
  createdAt: number;
  updatedAt: number;
}

export type StudioMode = 'MANUAL' | 'AI';

export interface PadSettings {
  gainDb: number;
  pan: number;
  pitchSemitones: number;
  trimStartMs: number;
  trimEndMs: number | null;
  loop: boolean;
  muted: boolean;
}

export interface StudioSource {
  captureId: string;
  padIndex: number;
  settings: PadSettings;
  /** Role assigned on the Orbit (null = let the AI decide). */
  role: string | null;
}

/** A recorded manual performance: pad hits over time. */
export interface PerformanceEvent {
  padIndex: number;
  timeMs: number;
  velocity: number;
  /** A looping pad was switched off at this time. */
  stop?: boolean;
}

export interface StudioSession {
  id: string;
  name: string;
  mode: StudioMode;
  bpm: number;
  key: string | null;
  scale: string | null;
  style: StyleId | null;
  sources: StudioSource[];
  performance: PerformanceEvent[];
  plan: MusicPlan | null;
  lyricId: string | null;
  padLayout: '4x4' | '8x8' | 'auto';
  draftVersion: number;
  dirty: boolean;
  createdAt: number;
  updatedAt: number;
}

export type JobState =
  | 'QUEUED' | 'PREPARING' | 'ANALYZING' | 'PLANNING' | 'VALIDATING'
  | 'RENDERING' | 'MIXING' | 'READY' | 'FAILED' | 'CANCELLED';

export interface GenerationJob {
  id: string;
  sessionId: string;
  kind: 'PLAN' | 'EDIT' | 'LYRICS' | 'LYRICS_TO_TRACK' | 'RENDER';
  state: JobState;
  prompt: string | null;
  error: string | null;
  timings: Record<string, number>;
  createdAt: number;
  updatedAt: number;
}

export interface PromptHistoryEntry {
  id: string;
  sessionId: string | null;
  trackId: string | null;
  kind: 'PLAN' | 'EDIT' | 'LYRICS';
  prompt: string;
  planJson: string | null;
  createdAt: number;
}

export interface UserProfile {
  id: string;
  name: string;
  createdAt: number;
}

// ---------------------------------------------------------------- queries

export type SortOrder = 'newest' | 'oldest' | 'name_asc' | 'name_desc';

export interface ListQuery {
  /** Free text; matched case-insensitively against the indexed fields (prefix match per word). */
  search?: string;
  sort?: SortOrder;
  limit?: number;
  offset?: number;
}

export interface CaptureQuery extends ListQuery {
  types?: CaptureType[];
}

export interface TrackQuery extends ListQuery {
  modes?: TrackMode[];
  styles?: StyleId[];
}

export type LyricQuery = ListQuery;

// ---------------------------------------------------------------- repositories

export type NewCapture = Omit<Capture, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };
export type NewTrack = Omit<Track, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };
export type NewLyric = Omit<Lyric, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

export interface CaptureRepository {
  create(input: NewCapture): Promise<Capture>;
  update(id: string, patch: Partial<Pick<Capture, 'name' | 'description' | 'tags' | 'features' | 'inLibrary'>>): Promise<Capture>;
  get(id: string): Promise<Capture | null>;
  getMany(ids: string[]): Promise<Capture[]>;
  /** Library view: READY + inLibrary + not deleted. */
  list(query?: CaptureQuery): Promise<Capture[]>;
  count(query?: CaptureQuery): Promise<number>;
  softDelete(id: string): Promise<void>;
}

export interface TrackRepository {
  create(input: NewTrack): Promise<Track>;
  update(id: string, patch: Partial<Pick<Track, 'name' | 'description' | 'lyricId' | 'plan' | 'audioAssetId' | 'durationMs' | 'peaks' | 'prompt' | 'style' | 'bpm' | 'key' | 'scale' | 'sources'>>): Promise<Track>;
  get(id: string): Promise<Track | null>;
  /** Search covers name, description, style, prompt, lyrics text, source names/descriptions. */
  list(query?: TrackQuery): Promise<Track[]>;
  count(query?: TrackQuery): Promise<number>;
  softDelete(id: string): Promise<void>;
}

export interface LyricRepository {
  create(input: NewLyric): Promise<Lyric>;
  update(id: string, patch: Partial<Pick<Lyric, 'name' | 'description' | 'text' | 'structured' | 'language' | 'style' | 'sourceTrackId' | 'sourceCaptureIds'>>): Promise<Lyric>;
  get(id: string): Promise<Lyric | null>;
  /** Search covers name, description, text, source track name, source sound names. */
  list(query?: LyricQuery): Promise<Lyric[]>;
  count(query?: LyricQuery): Promise<number>;
  softDelete(id: string): Promise<void>;
}

export interface MediaRepository {
  create(asset: Omit<MediaAsset, 'id' | 'createdAt'> & { id?: string }): Promise<MediaAsset>;
  get(id: string): Promise<MediaAsset | null>;
  setStatus(id: string, status: MediaStatus): Promise<void>;
  /** Assets whose owner was soft-deleted and whose files still need removing. */
  listPendingCleanup(): Promise<MediaAsset[]>;
}

export interface SessionRepository {
  create(input: Omit<StudioSession, 'id' | 'createdAt' | 'updatedAt' | 'draftVersion' | 'dirty'>): Promise<StudioSession>;
  save(session: StudioSession): Promise<StudioSession>;
  get(id: string): Promise<StudioSession | null>;
  /** Most recent first. */
  listRecent(limit?: number): Promise<StudioSession[]>;
  delete(id: string): Promise<void>;
}

export interface JobRepository {
  create(input: Pick<GenerationJob, 'sessionId' | 'kind' | 'prompt'>): Promise<GenerationJob>;
  transition(id: string, state: JobState, extra?: { error?: string; timingKey?: string }): Promise<GenerationJob>;
  get(id: string): Promise<GenerationJob | null>;
}

export interface PromptHistoryRepository {
  add(entry: Omit<PromptHistoryEntry, 'id' | 'createdAt'>): Promise<PromptHistoryEntry>;
  listForSession(sessionId: string): Promise<PromptHistoryEntry[]>;
  listForTrack(trackId: string): Promise<PromptHistoryEntry[]>;
}

export interface ProfileRepository {
  get(): Promise<UserProfile | null>;
  setName(name: string): Promise<UserProfile>;
}

export interface Library {
  captures: CaptureRepository;
  tracks: TrackRepository;
  lyrics: LyricRepository;
  media: MediaRepository;
  sessions: SessionRepository;
  jobs: JobRepository;
  prompts: PromptHistoryRepository;
  profile: ProfileRepository;
}
