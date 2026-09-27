import type {
  Capture,
  CaptureQuery,
  CaptureRepository,
  GenerationJob,
  JobRepository,
  JobState,
  Library,
  ListQuery,
  Lyric,
  LyricRepository,
  MediaAsset,
  MediaRepository,
  MediaStatus,
  ProfileRepository,
  PromptHistoryEntry,
  PromptHistoryRepository,
  SessionRepository,
  SortOrder,
  SqlExecutor,
  SqlValue,
  StudioSession,
  Track,
  TrackQuery,
  TrackRepository,
  UserProfile,
} from '../contracts/library';
import { ftsQuery, searchBody, tokens } from './search';
import { uuid } from './uuid';

type Row = Record<string, SqlValue>;

const now = () => Date.now();
const json = (v: unknown) => JSON.stringify(v ?? null);
function parse<T>(v: SqlValue, fallback: T): T {
  if (typeof v !== 'string' || v === '') return fallback;
  try {
    return (JSON.parse(v) as T) ?? fallback;
  } catch {
    return fallback;
  }
}
const str = (v: SqlValue) => (v == null ? null : String(v));
const num = (v: SqlValue) => (v == null ? null : Number(v));

function orderBy(alias: string, sort: SortOrder | undefined, dateCol = 'created_at'): string {
  switch (sort) {
    case 'oldest':
      return `${alias}.${dateCol} ASC`;
    case 'name_asc':
      return `${alias}.name COLLATE NOCASE ASC, ${alias}.${dateCol} DESC`;
    case 'name_desc':
      return `${alias}.name COLLATE NOCASE DESC, ${alias}.${dateCol} DESC`;
    default:
      return `${alias}.${dateCol} DESC`;
  }
}

/**
 * Adds the search condition: an FTS4 MATCH on the owner's rowid, or — when
 * `useLike` (FTS unavailable or the MATCH failed) — every word as a substring
 * of the normalised search_text column.
 */
function searchClause(alias: string, fts: string, q: ListQuery, useLike: boolean, where: string[], params: SqlValue[]): void {
  if (!q.search) return;
  if (useLike) {
    for (const t of tokens(q.search)) {
      where.push(`${alias}.search_text LIKE ?`);
      params.push(`%${t}%`);
    }
    return;
  }
  const m = ftsQuery(q.search);
  if (!m) return;
  where.push(`${alias}.rowid IN (SELECT docid FROM ${fts} WHERE ${fts} MATCH ?)`);
  params.push(m);
}

async function withSearchFallback<T>(run: (useLike: boolean) => Promise<T>): Promise<T> {
  try {
    return await run(false);
  } catch (err) {
    // A malformed MATCH (or a build without FTS) must never break the list.
    return run(true);
  }
}

async function reindex(db: SqlExecutor, table: string, fts: string, id: string, body: string): Promise<void> {
  await db.run(`UPDATE ${table} SET search_text = ? WHERE id = ?`, [body, id]);
  await db.run(`DELETE FROM ${fts} WHERE docid = (SELECT rowid FROM ${table} WHERE id = ?)`, [id]);
  await db.run(`INSERT INTO ${fts}(docid, body) SELECT rowid, ? FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [body, id]);
}

// ------------------------------------------------------------------ media

function toAsset(r: Row): MediaAsset {
  return {
    id: String(r.id),
    kind: r.kind as MediaAsset['kind'],
    path: String(r.path),
    mimeType: String(r.mime_type),
    sizeBytes: Number(r.size_bytes ?? 0),
    durationMs: num(r.duration_ms),
    width: num(r.width),
    height: num(r.height),
    sampleRate: num(r.sample_rate),
    channels: num(r.channels),
    sha256: str(r.sha256),
    status: r.status as MediaStatus,
    createdAt: Number(r.created_at),
  };
}

export class SqlMediaRepository implements MediaRepository {
  constructor(private db: SqlExecutor) {}

  async create(a: Omit<MediaAsset, 'id' | 'createdAt'> & { id?: string }): Promise<MediaAsset> {
    const id = a.id ?? uuid();
    await this.db.run(
      `INSERT INTO media_asset (id, kind, path, mime_type, size_bytes, duration_ms, width, height, sample_rate, channels, sha256, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, a.kind, a.path, a.mimeType, a.sizeBytes, a.durationMs, a.width, a.height, a.sampleRate, a.channels, a.sha256, a.status, now()],
    );
    return (await this.get(id))!;
  }

  async get(id: string): Promise<MediaAsset | null> {
    const r = await this.db.get<Row>('SELECT * FROM media_asset WHERE id = ?', [id]);
    return r ? toAsset(r) : null;
  }

  async setStatus(id: string, status: MediaStatus): Promise<void> {
    await this.db.run('UPDATE media_asset SET status = ? WHERE id = ?', [status, id]);
  }

  async listPendingCleanup(): Promise<MediaAsset[]> {
    const rows = await this.db.all<Row>("SELECT * FROM media_asset WHERE status IN ('DELETED','FAILED') AND cleaned = 0");
    return rows.map(toAsset);
  }

  /** Called once the file is gone, so cleanup is not retried. */
  async markCleaned(id: string): Promise<void> {
    await this.db.run('UPDATE media_asset SET cleaned = 1 WHERE id = ?', [id]);
  }

  async markDeleted(ids: Array<string | null>): Promise<void> {
    for (const id of ids) if (id) await this.setStatus(id, 'DELETED');
  }
}

// ------------------------------------------------------------------ captures

function toCapture(r: Row): Capture {
  return {
    id: String(r.id),
    name: String(r.name),
    description: String(r.description ?? ''),
    type: r.type as Capture['type'],
    mediaAssetId: String(r.media_asset_id),
    audioAssetId: str(r.audio_asset_id),
    thumbnailAssetId: str(r.thumbnail_asset_id),
    durationMs: Number(r.duration_ms ?? 0),
    tags: parse<string[]>(r.tags, []),
    features: parse(r.features, null),
    detectedLabel: str(r.detected_label),
    inLibrary: Number(r.in_library) === 1,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export class SqlCaptureRepository implements CaptureRepository {
  constructor(private db: SqlExecutor, private media: SqlMediaRepository, private onRenamed: (captureId: string) => Promise<void>) {}

  private body(c: Pick<Capture, 'name' | 'description' | 'tags' | 'detectedLabel'>) {
    return searchBody([c.name, c.description, ...c.tags, c.detectedLabel]);
  }

  async create(input: Parameters<CaptureRepository['create']>[0]): Promise<Capture> {
    const id = input.id ?? uuid();
    const t = now();
    await this.db.transaction(async () => {
      await this.db.run(
        `INSERT INTO capture (id, name, description, type, media_asset_id, audio_asset_id, thumbnail_asset_id, duration_ms, tags, features, detected_label, in_library, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id, input.name.trim() || 'Untitled sound', input.description ?? '', input.type, input.mediaAssetId, input.audioAssetId,
          input.thumbnailAssetId, input.durationMs, json(input.tags ?? []), input.features ? json(input.features) : null,
          input.detectedLabel, input.inLibrary ? 1 : 0, t, t,
        ],
      );
      await reindex(this.db, 'capture', 'capture_fts', id, this.body(input));
    });
    return (await this.get(id))!;
  }

  async update(id: string, patch: Parameters<CaptureRepository['update']>[1]): Promise<Capture> {
    const cur = await this.get(id);
    if (!cur) throw new Error('Capture not found');
    const next = { ...cur, ...patch };
    await this.db.transaction(async () => {
      await this.db.run(
        'UPDATE capture SET name = ?, description = ?, tags = ?, features = ?, in_library = ?, updated_at = ? WHERE id = ?',
        [next.name.trim() || cur.name, next.description, json(next.tags), next.features ? json(next.features) : null, next.inLibrary ? 1 : 0, now(), id],
      );
      await reindex(this.db, 'capture', 'capture_fts', id, this.body(next));
    });
    if (patch.name !== undefined || patch.description !== undefined) await this.onRenamed(id);
    return (await this.get(id))!;
  }

  async get(id: string): Promise<Capture | null> {
    const r = await this.db.get<Row>('SELECT * FROM capture WHERE id = ? AND deleted_at IS NULL', [id]);
    return r ? toCapture(r) : null;
  }

  async getMany(ids: string[]): Promise<Capture[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.all<Row>(`SELECT * FROM capture WHERE deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, ids);
    const byId = new Map(rows.map((r) => [String(r.id), toCapture(r)]));
    return ids.map((i) => byId.get(i)).filter((c): c is Capture => !!c);
  }

  private query(q: CaptureQuery, useLike: boolean, select: string) {
    const where = ["c.deleted_at IS NULL", 'c.in_library = 1', "m.status = 'READY'"];
    const params: SqlValue[] = [];
    if (q.types?.length) {
      where.push(`c.type IN (${q.types.map(() => '?').join(',')})`);
      params.push(...q.types);
    }
    searchClause('c', 'capture_fts', q, useLike, where, params);
    return { sql: `SELECT ${select} FROM capture c JOIN media_asset m ON m.id = c.media_asset_id WHERE ${where.join(' AND ')}`, params };
  }

  list(q: CaptureQuery = {}): Promise<Capture[]> {
    return withSearchFallback(async (like) => {
      const { sql, params } = this.query(q, like, 'c.*');
      const rows = await this.db.all<Row>(`${sql} ORDER BY ${orderBy('c', q.sort)} LIMIT ? OFFSET ?`, [...params, q.limit ?? 200, q.offset ?? 0]);
      return rows.map(toCapture);
    });
  }

  count(q: CaptureQuery = {}): Promise<number> {
    return withSearchFallback(async (like) => {
      const { sql, params } = this.query(q, like, 'COUNT(*) AS n');
      return Number((await this.db.get<Row>(sql, params))?.n ?? 0);
    });
  }

  async softDelete(id: string): Promise<void> {
    const cur = await this.get(id);
    if (!cur) return;
    await this.db.transaction(async () => {
      await this.db.run('UPDATE capture SET deleted_at = ?, updated_at = ? WHERE id = ?', [now(), now(), id]);
      await this.db.run('DELETE FROM capture_fts WHERE docid = (SELECT rowid FROM capture WHERE id = ?)', [id]);
      await this.media.markDeleted([cur.mediaAssetId, cur.audioAssetId, cur.thumbnailAssetId]);
    });
  }
}

// ------------------------------------------------------------------ tracks

function toTrack(r: Row): Track {
  return {
    id: String(r.id),
    name: String(r.name),
    description: String(r.description ?? ''),
    mode: r.mode as Track['mode'],
    audioAssetId: String(r.audio_asset_id),
    durationMs: Number(r.duration_ms ?? 0),
    bpm: num(r.bpm),
    key: str(r.key),
    scale: str(r.scale),
    style: (str(r.style) as Track['style']) ?? null,
    plan: parse(r.plan, null),
    peaks: parse<number[]>(r.peaks, []),
    lyricId: str(r.lyric_id),
    prompt: str(r.prompt),
    sources: parse(r.sources, []),
    versions: parse(r.versions, { model: null, kb: null, systemPrompt: null, renderer: 'unknown' }),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export class SqlTrackRepository implements TrackRepository {
  constructor(private db: SqlExecutor, private media: SqlMediaRepository, private onRenamed: (trackId: string) => Promise<void>) {}

  /** Name, description, style, prompt, lyric text and every source's current and snapshot names/descriptions. */
  async indexBody(t: Track): Promise<string> {
    const lyric = t.lyricId ? await this.db.get<Row>('SELECT text, name FROM lyric WHERE id = ? AND deleted_at IS NULL', [t.lyricId]) : null;
    const live = await this.db.all<Row>(
      'SELECT c.name, c.description FROM track_source s JOIN capture c ON c.id = s.capture_id WHERE s.track_id = ?',
      [t.id],
    );
    return searchBody([
      t.name, t.description, t.style, t.prompt, str(lyric?.name ?? null), str(lyric?.text ?? null),
      ...t.sources.flatMap((s) => [s.name, s.description]),
      ...live.flatMap((r) => [str(r.name), str(r.description)]),
    ]);
  }

  async reindexOne(id: string): Promise<void> {
    const t = await this.get(id);
    if (t) await reindex(this.db, 'track', 'track_fts', id, await this.indexBody(t));
  }

  async create(input: Parameters<TrackRepository['create']>[0]): Promise<Track> {
    const id = input.id ?? uuid();
    const t = now();
    await this.db.transaction(async () => {
      await this.db.run(
        `INSERT INTO track (id, name, description, mode, audio_asset_id, duration_ms, bpm, key, scale, style, plan, peaks, lyric_id, prompt, sources, versions, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id, input.name.trim() || 'Untitled track', input.description ?? '', input.mode, input.audioAssetId, input.durationMs,
          input.bpm, input.key, input.scale, input.style, input.plan ? json(input.plan) : null, json(input.peaks ?? []),
          input.lyricId, input.prompt, json(input.sources ?? []), json(input.versions), t, t,
        ],
      );
      for (const s of input.sources ?? []) {
        await this.db.run('INSERT OR REPLACE INTO track_source (track_id, capture_id, role) VALUES (?,?,?)', [id, s.captureId, s.role]);
      }
      await this.reindexOne(id);
    });
    return (await this.get(id))!;
  }

  async update(id: string, patch: Parameters<TrackRepository['update']>[1]): Promise<Track> {
    const cur = await this.get(id);
    if (!cur) throw new Error('Track not found');
    const n = { ...cur, ...patch };
    await this.db.transaction(async () => {
      await this.db.run(
        `UPDATE track SET name = ?, description = ?, lyric_id = ?, plan = ?, audio_asset_id = ?, duration_ms = ?, peaks = ?, prompt = ?, style = ?, bpm = ?, key = ?, scale = ?, sources = ?, updated_at = ? WHERE id = ?`,
        [
          n.name.trim() || cur.name, n.description, n.lyricId, n.plan ? json(n.plan) : null, n.audioAssetId, n.durationMs, json(n.peaks),
          n.prompt, n.style, n.bpm, n.key, n.scale, json(n.sources), now(), id,
        ],
      );
      if (patch.sources) {
        await this.db.run('DELETE FROM track_source WHERE track_id = ?', [id]);
        for (const s of patch.sources) {
          await this.db.run('INSERT OR REPLACE INTO track_source (track_id, capture_id, role) VALUES (?,?,?)', [id, s.captureId, s.role]);
        }
      }
      if (patch.audioAssetId && patch.audioAssetId !== cur.audioAssetId) await this.media.markDeleted([cur.audioAssetId]);
      await this.reindexOne(id);
    });
    if (patch.name !== undefined) await this.onRenamed(id);
    return (await this.get(id))!;
  }

  async get(id: string): Promise<Track | null> {
    const r = await this.db.get<Row>('SELECT * FROM track WHERE id = ? AND deleted_at IS NULL', [id]);
    return r ? toTrack(r) : null;
  }

  private query(q: TrackQuery, useLike: boolean, select: string) {
    const where = ['t.deleted_at IS NULL', "m.status = 'READY'"];
    const params: SqlValue[] = [];
    if (q.modes?.length) {
      where.push(`t.mode IN (${q.modes.map(() => '?').join(',')})`);
      params.push(...q.modes);
    }
    if (q.styles?.length) {
      where.push(`t.style IN (${q.styles.map(() => '?').join(',')})`);
      params.push(...q.styles);
    }
    searchClause('t', 'track_fts', q, useLike, where, params);
    return { sql: `SELECT ${select} FROM track t JOIN media_asset m ON m.id = t.audio_asset_id WHERE ${where.join(' AND ')}`, params };
  }

  list(q: TrackQuery = {}): Promise<Track[]> {
    return withSearchFallback(async (like) => {
      const { sql, params } = this.query(q, like, 't.*');
      const rows = await this.db.all<Row>(`${sql} ORDER BY ${orderBy('t', q.sort)} LIMIT ? OFFSET ?`, [...params, q.limit ?? 200, q.offset ?? 0]);
      return rows.map(toTrack);
    });
  }

  count(q: TrackQuery = {}): Promise<number> {
    return withSearchFallback(async (like) => {
      const { sql, params } = this.query(q, like, 'COUNT(*) AS n');
      return Number((await this.db.get<Row>(sql, params))?.n ?? 0);
    });
  }

  async softDelete(id: string): Promise<void> {
    const cur = await this.get(id);
    if (!cur) return;
    await this.db.transaction(async () => {
      await this.db.run('UPDATE track SET deleted_at = ?, updated_at = ? WHERE id = ?', [now(), now(), id]);
      await this.db.run('DELETE FROM track_fts WHERE docid = (SELECT rowid FROM track WHERE id = ?)', [id]);
      await this.media.markDeleted([cur.audioAssetId]);
      // Lyrics outlive their track; they just lose the link.
      await this.db.run('UPDATE lyric SET source_track_id = NULL, updated_at = ? WHERE source_track_id = ?', [now(), id]);
    });
  }
}

// ------------------------------------------------------------------ lyrics

function toLyric(r: Row, sources: string[]): Lyric {
  return {
    id: String(r.id),
    name: String(r.name),
    description: String(r.description ?? ''),
    text: String(r.text ?? ''),
    structured: parse(r.structured, null),
    language: String(r.language ?? 'en'),
    style: (str(r.style) as Lyric['style']) ?? null,
    sourceTrackId: str(r.source_track_id),
    sourceCaptureIds: sources,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export class SqlLyricRepository implements LyricRepository {
  constructor(private db: SqlExecutor, private onTextChanged: (lyricId: string) => Promise<void>) {}

  private async sources(id: string): Promise<string[]> {
    return (await this.db.all<Row>('SELECT capture_id FROM lyric_source WHERE lyric_id = ?', [id])).map((r) => String(r.capture_id));
  }

  async reindexOne(id: string): Promise<void> {
    const l = await this.get(id);
    if (!l) return;
    const track = l.sourceTrackId ? await this.db.get<Row>('SELECT name FROM track WHERE id = ?', [l.sourceTrackId]) : null;
    const caps = await this.db.all<Row>(
      'SELECT c.name, c.description FROM lyric_source s JOIN capture c ON c.id = s.capture_id WHERE s.lyric_id = ?',
      [id],
    );
    const body = searchBody([l.name, l.description, l.text, str(track?.name ?? null), ...caps.flatMap((c) => [str(c.name), str(c.description)])]);
    await reindex(this.db, 'lyric', 'lyric_fts', id, body);
  }

  private async setSources(id: string, ids: string[]) {
    await this.db.run('DELETE FROM lyric_source WHERE lyric_id = ?', [id]);
    for (const c of ids) await this.db.run('INSERT OR REPLACE INTO lyric_source (lyric_id, capture_id) VALUES (?,?)', [id, c]);
  }

  async create(input: Parameters<LyricRepository['create']>[0]): Promise<Lyric> {
    const id = input.id ?? uuid();
    const t = now();
    await this.db.transaction(async () => {
      await this.db.run(
        `INSERT INTO lyric (id, name, description, text, structured, language, style, source_track_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [id, input.name.trim() || 'Untitled lyrics', input.description ?? '', input.text ?? '', input.structured ? json(input.structured) : null, input.language || 'en', input.style, input.sourceTrackId, t, t],
      );
      await this.setSources(id, input.sourceCaptureIds ?? []);
      await this.reindexOne(id);
    });
    return (await this.get(id))!;
  }

  async update(id: string, patch: Parameters<LyricRepository['update']>[1]): Promise<Lyric> {
    const cur = await this.get(id);
    if (!cur) throw new Error('Lyrics not found');
    const n = { ...cur, ...patch };
    await this.db.transaction(async () => {
      await this.db.run(
        'UPDATE lyric SET name = ?, description = ?, text = ?, structured = ?, language = ?, style = ?, source_track_id = ?, updated_at = ? WHERE id = ?',
        [n.name.trim() || cur.name, n.description, n.text, n.structured ? json(n.structured) : null, n.language, n.style, n.sourceTrackId, now(), id],
      );
      if (patch.sourceCaptureIds) await this.setSources(id, patch.sourceCaptureIds);
      await this.reindexOne(id);
    });
    if (patch.text !== undefined || patch.name !== undefined) await this.onTextChanged(id);
    return (await this.get(id))!;
  }

  async get(id: string): Promise<Lyric | null> {
    const r = await this.db.get<Row>('SELECT * FROM lyric WHERE id = ? AND deleted_at IS NULL', [id]);
    return r ? toLyric(r, await this.sources(id)) : null;
  }

  private query(q: ListQuery, useLike: boolean, select: string) {
    const where = ['l.deleted_at IS NULL'];
    const params: SqlValue[] = [];
    searchClause('l', 'lyric_fts', q, useLike, where, params);
    return { sql: `SELECT ${select} FROM lyric l WHERE ${where.join(' AND ')}`, params };
  }

  list(q: ListQuery = {}): Promise<Lyric[]> {
    return withSearchFallback(async (like) => {
      const { sql, params } = this.query(q, like, 'l.*');
      const rows = await this.db.all<Row>(`${sql} ORDER BY ${orderBy('l', q.sort, 'updated_at')} LIMIT ? OFFSET ?`, [...params, q.limit ?? 200, q.offset ?? 0]);
      return Promise.all(rows.map(async (r) => toLyric(r, await this.sources(String(r.id)))));
    });
  }

  count(q: ListQuery = {}): Promise<number> {
    return withSearchFallback(async (like) => {
      const { sql, params } = this.query(q, like, 'COUNT(*) AS n');
      return Number((await this.db.get<Row>(sql, params))?.n ?? 0);
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run('UPDATE lyric SET deleted_at = ?, updated_at = ? WHERE id = ?', [now(), now(), id]);
      await this.db.run('DELETE FROM lyric_fts WHERE docid = (SELECT rowid FROM lyric WHERE id = ?)', [id]);
      await this.db.run('UPDATE track SET lyric_id = NULL WHERE lyric_id = ?', [id]);
    });
  }
}

// ------------------------------------------------------------------ sessions, jobs, prompts, profile

export class SqlSessionRepository implements SessionRepository {
  constructor(private db: SqlExecutor) {}

  async create(input: Parameters<SessionRepository['create']>[0]): Promise<StudioSession> {
    const t = now();
    const s: StudioSession = { ...input, id: uuid(), draftVersion: 1, dirty: false, createdAt: t, updatedAt: t };
    await this.db.run('INSERT INTO studio_session (id, body, created_at, updated_at) VALUES (?,?,?,?)', [s.id, json(s), t, t]);
    return s;
  }

  async save(session: StudioSession): Promise<StudioSession> {
    const s = { ...session, draftVersion: session.draftVersion + 1, dirty: false, updatedAt: now() };
    const r = await this.db.run('UPDATE studio_session SET body = ?, updated_at = ? WHERE id = ?', [json(s), s.updatedAt, s.id]);
    if (r.changes === 0) {
      await this.db.run('INSERT INTO studio_session (id, body, created_at, updated_at) VALUES (?,?,?,?)', [s.id, json(s), s.createdAt, s.updatedAt]);
    }
    return s;
  }

  async get(id: string): Promise<StudioSession | null> {
    const r = await this.db.get<Row>('SELECT body FROM studio_session WHERE id = ?', [id]);
    return r ? parse<StudioSession | null>(r.body, null) : null;
  }

  async listRecent(limit = 10): Promise<StudioSession[]> {
    const rows = await this.db.all<Row>('SELECT body FROM studio_session ORDER BY updated_at DESC LIMIT ?', [limit]);
    return rows.map((r) => parse<StudioSession | null>(r.body, null)).filter((s): s is StudioSession => !!s);
  }

  async delete(id: string): Promise<void> {
    await this.db.run('DELETE FROM studio_session WHERE id = ?', [id]);
  }
}

function toJob(r: Row): GenerationJob {
  return {
    id: String(r.id),
    sessionId: String(r.session_id),
    kind: r.kind as GenerationJob['kind'],
    state: r.state as JobState,
    prompt: str(r.prompt),
    error: str(r.error),
    timings: parse(r.timings, {}),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export class SqlJobRepository implements JobRepository {
  constructor(private db: SqlExecutor) {}

  async create(input: Pick<GenerationJob, 'sessionId' | 'kind' | 'prompt'>): Promise<GenerationJob> {
    const id = uuid();
    const t = now();
    await this.db.run('INSERT INTO generation_job (id, session_id, kind, state, prompt, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', [
      id, input.sessionId, input.kind, 'QUEUED', input.prompt, t, t,
    ]);
    return (await this.get(id))!;
  }

  async transition(id: string, state: JobState, extra: { error?: string; timingKey?: string } = {}): Promise<GenerationJob> {
    const cur = await this.get(id);
    if (!cur) throw new Error('Job not found');
    const timings = { ...cur.timings, [extra.timingKey ?? state]: now() - cur.createdAt };
    await this.db.run('UPDATE generation_job SET state = ?, error = ?, timings = ?, updated_at = ? WHERE id = ?', [
      state, extra.error ?? cur.error, json(timings), now(), id,
    ]);
    return (await this.get(id))!;
  }

  async get(id: string): Promise<GenerationJob | null> {
    const r = await this.db.get<Row>('SELECT * FROM generation_job WHERE id = ?', [id]);
    return r ? toJob(r) : null;
  }

  /** Jobs left mid-flight by a killed app: mark them failed on the next start. */
  async failInterrupted(): Promise<number> {
    const r = await this.db.run(
      "UPDATE generation_job SET state = 'FAILED', error = 'Interrupted', updated_at = ? WHERE state NOT IN ('READY','FAILED','CANCELLED')",
      [now()],
    );
    return r.changes;
  }
}

export class SqlPromptRepository implements PromptHistoryRepository {
  constructor(private db: SqlExecutor) {}

  async add(e: Omit<PromptHistoryEntry, 'id' | 'createdAt'>): Promise<PromptHistoryEntry> {
    const entry: PromptHistoryEntry = { ...e, id: uuid(), createdAt: now() };
    await this.db.run('INSERT INTO prompt_history (id, session_id, track_id, kind, prompt, plan_json, created_at) VALUES (?,?,?,?,?,?,?)', [
      entry.id, entry.sessionId, entry.trackId, entry.kind, entry.prompt, entry.planJson, entry.createdAt,
    ]);
    return entry;
  }

  private async list(col: 'session_id' | 'track_id', id: string): Promise<PromptHistoryEntry[]> {
    const rows = await this.db.all<Row>(`SELECT * FROM prompt_history WHERE ${col} = ? ORDER BY created_at ASC`, [id]);
    return rows.map((r) => ({
      id: String(r.id),
      sessionId: str(r.session_id),
      trackId: str(r.track_id),
      kind: r.kind as PromptHistoryEntry['kind'],
      prompt: String(r.prompt),
      planJson: str(r.plan_json),
      createdAt: Number(r.created_at),
    }));
  }

  listForSession(sessionId: string) {
    return this.list('session_id', sessionId);
  }

  listForTrack(trackId: string) {
    return this.list('track_id', trackId);
  }
}

export class SqlProfileRepository implements ProfileRepository {
  constructor(private db: SqlExecutor) {}

  async get(): Promise<UserProfile | null> {
    const r = await this.db.get<Row>('SELECT * FROM profile LIMIT 1');
    return r ? { id: String(r.id), name: String(r.name), createdAt: Number(r.created_at) } : null;
  }

  async setName(name: string): Promise<UserProfile> {
    const clean = name.trim();
    if (!clean) throw new Error('Name cannot be empty');
    const cur = await this.get();
    if (cur) await this.db.run('UPDATE profile SET name = ? WHERE id = ?', [clean, cur.id]);
    else await this.db.run('INSERT INTO profile (id, name, created_at) VALUES (?,?,?)', [uuid(), clean, now()]);
    return (await this.get())!;
  }
}

export interface SqlLibrary extends Library {
  media: SqlMediaRepository;
  captures: SqlCaptureRepository;
  tracks: SqlTrackRepository;
  lyrics: SqlLyricRepository;
  jobs: SqlJobRepository;
  db: SqlExecutor;
}

/** Wires the repositories together, including cross-entity reindexing. */
export function createRepositories(db: SqlExecutor): SqlLibrary {
  const media = new SqlMediaRepository(db);
  // Declared first so the rename hooks can reach them.
  let tracks: SqlTrackRepository;
  let lyrics: SqlLyricRepository;
  const reindexTracksWhere = async (sql: string, id: string) => {
    for (const r of await db.all<Row>(sql, [id])) await tracks.reindexOne(String(r.id));
  };
  const reindexLyricsWhere = async (sql: string, id: string) => {
    for (const r of await db.all<Row>(sql, [id])) await lyrics.reindexOne(String(r.id));
  };
  const captures = new SqlCaptureRepository(db, media, async (captureId) => {
    await reindexTracksWhere('SELECT track_id AS id FROM track_source WHERE capture_id = ?', captureId);
    await reindexLyricsWhere('SELECT lyric_id AS id FROM lyric_source WHERE capture_id = ?', captureId);
  });
  tracks = new SqlTrackRepository(db, media, (trackId) =>
    reindexLyricsWhere('SELECT id FROM lyric WHERE source_track_id = ? AND deleted_at IS NULL', trackId),
  );
  lyrics = new SqlLyricRepository(db, (lyricId) =>
    reindexTracksWhere('SELECT id FROM track WHERE lyric_id = ? AND deleted_at IS NULL', lyricId),
  );
  return {
    db,
    media,
    captures,
    tracks,
    lyrics,
    sessions: new SqlSessionRepository(db),
    jobs: new SqlJobRepository(db),
    prompts: new SqlPromptRepository(db),
    profile: new SqlProfileRepository(db),
  };
}
