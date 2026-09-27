import type { SqlExecutor } from '../contracts/library';

/**
 * Versioned migrations, tracked with PRAGMA user_version. Each entry moves the
 * schema from version i to i+1; running them is idempotent because only the
 * missing versions run.
 *
 * FTS4 (not FTS5): the phone's SQLite has both, but sql.js — the driver the
 * tests run on — only has FTS4, and one tested code path beats two.
 * FTS rows are keyed by the owning table's rowid (docid = rowid).
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS profile (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS media_asset (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    width INTEGER,
    height INTEGER,
    sample_rate INTEGER,
    channels INTEGER,
    sha256 TEXT,
    status TEXT NOT NULL,
    cleaned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS media_status ON media_asset(status, cleaned);

  CREATE TABLE IF NOT EXISTS capture (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL,
    media_asset_id TEXT NOT NULL,
    audio_asset_id TEXT,
    thumbnail_asset_id TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    features TEXT,
    detected_label TEXT,
    in_library INTEGER NOT NULL DEFAULT 1,
    search_text TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS capture_list ON capture(deleted_at, in_library, created_at);
  CREATE INDEX IF NOT EXISTS capture_name ON capture(name COLLATE NOCASE);
  CREATE VIRTUAL TABLE IF NOT EXISTS capture_fts USING fts4(body);

  CREATE TABLE IF NOT EXISTS track (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL,
    audio_asset_id TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    bpm INTEGER,
    key TEXT,
    scale TEXT,
    style TEXT,
    plan TEXT,
    peaks TEXT NOT NULL DEFAULT '[]',
    lyric_id TEXT,
    prompt TEXT,
    sources TEXT NOT NULL DEFAULT '[]',
    versions TEXT NOT NULL DEFAULT '{}',
    search_text TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS track_list ON track(deleted_at, created_at);
  CREATE INDEX IF NOT EXISTS track_name ON track(name COLLATE NOCASE);
  CREATE VIRTUAL TABLE IF NOT EXISTS track_fts USING fts4(body);

  CREATE TABLE IF NOT EXISTS track_source (
    track_id TEXT NOT NULL,
    capture_id TEXT NOT NULL,
    role TEXT,
    PRIMARY KEY (track_id, capture_id)
  );
  CREATE INDEX IF NOT EXISTS track_source_capture ON track_source(capture_id);

  CREATE TABLE IF NOT EXISTS lyric (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    structured TEXT,
    language TEXT NOT NULL DEFAULT 'en',
    style TEXT,
    source_track_id TEXT,
    search_text TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS lyric_list ON lyric(deleted_at, updated_at);
  CREATE VIRTUAL TABLE IF NOT EXISTS lyric_fts USING fts4(body);

  CREATE TABLE IF NOT EXISTS lyric_source (
    lyric_id TEXT NOT NULL,
    capture_id TEXT NOT NULL,
    PRIMARY KEY (lyric_id, capture_id)
  );
  CREATE INDEX IF NOT EXISTS lyric_source_capture ON lyric_source(capture_id);

  CREATE TABLE IF NOT EXISTS studio_session (
    id TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS generation_job (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    state TEXT NOT NULL,
    prompt TEXT,
    error TEXT,
    timings TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prompt_history (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    track_id TEXT,
    kind TEXT NOT NULL,
    prompt TEXT NOT NULL,
    plan_json TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS prompt_session ON prompt_history(session_id, created_at);
  CREATE INDEX IF NOT EXISTS prompt_track ON prompt_history(track_id, created_at);
  `,
];

export async function migrate(db: SqlExecutor): Promise<number> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    await db.exec(MIGRATIONS[version]);
    version += 1;
    await db.exec(`PRAGMA user_version = ${version}`);
  }
  return version;
}
