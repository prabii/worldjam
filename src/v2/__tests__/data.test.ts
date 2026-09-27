import type { Capture, NewCapture, SqlExecutor } from '../contracts/library';
import { openLibrary } from '../data/library';
import { MediaStore, InsufficientStorageError, type FileOps } from '../data/mediaStore';
import type { SqlLibrary } from '../data/repos';
import { ftsQuery, normalizeText } from '../data/search';
import { migrate } from '../data/schema';
import { openSqlJs } from './helpers/sqlJsExecutor';

async function fresh(): Promise<{ db: SqlExecutor; lib: SqlLibrary }> {
  const db = await openSqlJs();
  return { db, lib: await openLibrary(db) };
}

async function readyAsset(lib: SqlLibrary, kind: 'AUDIO_CAPTURE' | 'AI_TRACK' = 'AUDIO_CAPTURE') {
  return lib.media.create({
    kind,
    path: `v2/x/${Math.random()}.wav`,
    mimeType: 'audio/wav',
    sizeBytes: 100,
    durationMs: 1000,
    width: null,
    height: null,
    sampleRate: 48000,
    channels: 1,
    sha256: null,
    status: 'READY',
  });
}

async function addCapture(lib: SqlLibrary, over: Partial<NewCapture> = {}): Promise<Capture> {
  const a = await readyAsset(lib);
  return lib.captures.create({
    name: 'Glass tap',
    description: 'Sharp glassy knock on a tumbler',
    type: 'AUDIO',
    mediaAssetId: a.id,
    audioAssetId: a.id,
    thumbnailAssetId: null,
    durationMs: 1200,
    tags: [],
    features: null,
    detectedLabel: null,
    inLibrary: true,
    ...over,
  });
}

describe('search helpers', () => {
  it('normalises case, punctuation and accents', () => {
    expect(normalizeText('  Café-Glass!!  TAP ')).toBe('cafe glass tap');
  });
  it('builds prefix MATCH terms and ignores empty queries', () => {
    expect(ftsQuery('Glas TA')).toBe('glas* ta*');
    expect(ftsQuery('  !!  ')).toBeNull();
  });
});

describe('library repositories', () => {
  it('creates, reads and updates captures with JSON round-trips', async () => {
    const { lib } = await fresh();
    const c = await addCapture(lib, { tags: ['kitchen', 'glass'], features: { durationSec: 1, rms: 0.2, peak: 0.9, brightness: 3000, decay: 0.2, tonality: 0.3, pitchHz: 880, transient: 0.9, sustained: 0.1, onsetCount: 1, tempoBpm: null, suggestedRole: 'percussion' } });
    const got = await lib.captures.get(c.id);
    expect(got?.tags).toEqual(['kitchen', 'glass']);
    expect(got?.features?.pitchHz).toBe(880);
    const up = await lib.captures.update(c.id, { name: 'Wine glass', description: 'Ringing rim' });
    expect(up.name).toBe('Wine glass');
    expect(up.updatedAt).toBeGreaterThanOrEqual(c.updatedAt);
  });

  it('search: exact, partial, description, case-insensitive, punctuation, empty, no results', async () => {
    const { lib } = await fresh();
    await addCapture(lib, { name: 'Glass tap', description: 'Sharp glassy knock' });
    await addCapture(lib, { name: 'Table thump', description: 'Low wooden hit' });
    await addCapture(lib, { name: 'Rain', description: 'Window at night' });
    const names = async (search: string) => (await lib.captures.list({ search, sort: 'name_asc' })).map((c) => c.name);
    expect(await names('Glass tap')).toEqual(['Glass tap']);
    expect(await names('gla')).toEqual(['Glass tap']);
    expect(await names('wooden')).toEqual(['Table thump']);
    expect(await names('RAIN')).toEqual(['Rain']);
    expect(await names('window, night!')).toEqual(['Rain']);
    expect((await names('')).length).toBe(3);
    expect(await names('saxophone')).toEqual([]);
    expect(await lib.captures.count({ search: 'thump' })).toBe(1);
  });

  it('sorts newest/oldest/name and filters by type', async () => {
    const { lib } = await fresh();
    const a = await addCapture(lib, { name: 'bravo', type: 'AUDIO' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await addCapture(lib, { name: 'Alpha', type: 'VIDEO' });
    await new Promise((r) => setTimeout(r, 5));
    const c = await addCapture(lib, { name: 'charlie', type: 'HUM' });
    const ids = async (sort: 'newest' | 'oldest' | 'name_asc' | 'name_desc') => (await lib.captures.list({ sort })).map((x) => x.id);
    expect(await ids('newest')).toEqual([c.id, b.id, a.id]);
    expect(await ids('oldest')).toEqual([a.id, b.id, c.id]);
    expect(await ids('name_asc')).toEqual([b.id, a.id, c.id]);
    expect(await ids('name_desc')).toEqual([c.id, a.id, b.id]);
    expect((await lib.captures.list({ types: ['VIDEO'] })).map((x) => x.id)).toEqual([b.id]);
    expect((await lib.captures.list({ types: ['HUM', 'VOCAL'] })).map((x) => x.id)).toEqual([c.id]);
  });

  it('hides soft-deleted, session-only and not-ready captures', async () => {
    const { lib } = await fresh();
    const keep = await addCapture(lib, { name: 'keep' });
    const del = await addCapture(lib, { name: 'gone' });
    await addCapture(lib, { name: 'draft', inLibrary: false });
    const pending = await lib.media.create({ kind: 'AUDIO_CAPTURE', path: 'v2/p.wav', mimeType: 'audio/wav', sizeBytes: 1, durationMs: 1, width: null, height: null, sampleRate: null, channels: null, sha256: null, status: 'PROCESSING' });
    await addCapture(lib, { name: 'processing', mediaAssetId: pending.id });
    await lib.captures.softDelete(del.id);
    expect((await lib.captures.list()).map((c) => c.id)).toEqual([keep.id]);
    expect(await lib.captures.list({ search: 'gone' })).toEqual([]);
    // Deleting a capture queues its files for cleanup.
    expect((await lib.media.listPendingCleanup()).map((a) => a.id)).toContain(del.mediaAssetId);
  });

  it('tracks are searchable by source sound names and by lyric words; renames reindex', async () => {
    const { lib } = await fresh();
    const bottle = await addCapture(lib, { name: 'Blue bottle', description: 'Hollow glass knock' });
    const audio = await readyAsset(lib, 'AI_TRACK');
    const lyric = await lib.lyrics.create({ name: 'Night song', description: '', text: 'neon rivers under the moon', structured: null, language: 'en', style: 'lofi', sourceTrackId: null, sourceCaptureIds: [bottle.id] });
    const t = await lib.tracks.create({
      name: 'Late walk', description: 'chill loop', mode: 'AI', audioAssetId: audio.id, durationMs: 36000, bpm: 84, key: 'A', scale: 'minor',
      style: 'lofi', plan: null, peaks: [0.1, 0.5], lyricId: lyric.id, prompt: 'make it dusty',
      sources: [{ captureId: bottle.id, name: 'Blue bottle', description: 'Hollow glass knock', role: 'percussion' }],
      versions: { model: 'gemma-4-e2b', kb: 'kb-1', systemPrompt: 'sp-1', renderer: 'r-1' },
    });
    const find = async (q: string) => (await lib.tracks.list({ search: q })).map((x) => x.id);
    expect(await find('bottle')).toEqual([t.id]);
    expect(await find('neon rivers')).toEqual([t.id]);
    expect(await find('dusty')).toEqual([t.id]);
    expect(await find('lofi')).toEqual([t.id]);
    // Renaming the capture reindexes the track (live names are indexed too).
    await lib.captures.update(bottle.id, { name: 'Green jar' });
    expect(await find('jar')).toEqual([t.id]);
    // Editing lyric text reindexes the track.
    await lib.lyrics.update(lyric.id, { text: 'paper lanterns' });
    expect(await find('lanterns')).toEqual([t.id]);
    // Lyrics find their source track and sounds.
    expect((await lib.lyrics.list({ search: 'late walk' })).map((l) => l.id)).toEqual([]);
    await lib.lyrics.update(lyric.id, { sourceTrackId: t.id });
    expect((await lib.lyrics.list({ search: 'late walk' })).map((l) => l.id)).toEqual([lyric.id]);
    expect((await lib.lyrics.list({ search: 'jar' })).map((l) => l.id)).toEqual([lyric.id]);
    await lib.tracks.update(t.id, { name: 'Early run' });
    expect((await lib.lyrics.list({ search: 'early' })).map((l) => l.id)).toEqual([lyric.id]);
    expect((await lib.tracks.get(t.id))?.versions.kb).toBe('kb-1');
    // Deleting the track keeps the lyric but drops the link.
    await lib.tracks.softDelete(t.id);
    expect(await lib.tracks.list()).toEqual([]);
    expect((await lib.lyrics.get(lyric.id))?.sourceTrackId).toBeNull();
    expect((await lib.media.listPendingCleanup()).map((m) => m.id)).toContain(audio.id);
  });

  it('filters tracks by mode/style and deleting a lyric unlinks it', async () => {
    const { lib } = await fresh();
    const a1 = await readyAsset(lib, 'AI_TRACK');
    const a2 = await readyAsset(lib, 'AI_TRACK');
    const base = { description: '', durationMs: 1, bpm: 90, key: null, scale: null, plan: null, peaks: [], prompt: null, sources: [], versions: { model: null, kb: null, systemPrompt: null, renderer: 'r' } };
    const ai = await lib.tracks.create({ ...base, name: 'A', mode: 'AI', audioAssetId: a1.id, style: 'edm', lyricId: null });
    const manual = await lib.tracks.create({ ...base, name: 'B', mode: 'MANUAL', audioAssetId: a2.id, style: null, lyricId: null });
    expect((await lib.tracks.list({ modes: ['AI'] })).map((t) => t.id)).toEqual([ai.id]);
    expect((await lib.tracks.list({ styles: ['edm'] })).map((t) => t.id)).toEqual([ai.id]);
    const l = await lib.lyrics.create({ name: 'L', description: '', text: 'x', structured: null, language: 'en', style: null, sourceTrackId: null, sourceCaptureIds: [] });
    await lib.tracks.update(manual.id, { lyricId: l.id });
    await lib.lyrics.softDelete(l.id);
    expect((await lib.tracks.get(manual.id))?.lyricId).toBeNull();
  });

  it('rolls back a failed transaction', async () => {
    const { db, lib } = await fresh();
    await expect(
      db.transaction(async () => {
        await lib.profile.setName('Maya');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await lib.profile.get()).toBeNull();
  });

  it('migrations are idempotent', async () => {
    const { db } = await fresh();
    expect(await migrate(db)).toBe(1);
    expect(await migrate(db)).toBe(1);
  });

  it('profile, sessions, jobs and prompt history', async () => {
    const { lib } = await fresh();
    await expect(lib.profile.setName('   ')).rejects.toThrow();
    expect((await lib.profile.setName(' Maya ')).name).toBe('Maya');
    expect((await lib.profile.setName('Ravi')).name).toBe('Ravi');

    const s = await lib.sessions.create({ name: 'Jam', mode: 'AI', bpm: 92, key: null, scale: null, style: null, sources: [], performance: [], plan: null, lyricId: null, padLayout: 'auto' });
    const saved = await lib.sessions.save({ ...s, bpm: 100 });
    expect(saved.draftVersion).toBe(2);
    expect((await lib.sessions.get(s.id))?.bpm).toBe(100);
    expect((await lib.sessions.listRecent()).map((x) => x.id)).toEqual([s.id]);

    const job = await lib.jobs.create({ sessionId: s.id, kind: 'PLAN', prompt: 'lofi' });
    const planning = await lib.jobs.transition(job.id, 'PLANNING');
    expect(planning.state).toBe('PLANNING');
    expect(planning.timings.PLANNING).toBeGreaterThanOrEqual(0);
    expect(await lib.jobs.failInterrupted()).toBe(1);
    expect((await lib.jobs.get(job.id))?.state).toBe('FAILED');

    await lib.prompts.add({ sessionId: s.id, trackId: null, kind: 'PLAN', prompt: 'make it dusty', planJson: null });
    expect((await lib.prompts.listForSession(s.id)).map((p) => p.prompt)).toEqual(['make it dusty']);
  });

  it('stays fast with 1000 captures / 100 tracks / 100 lyrics', async () => {
    const { lib } = await fresh();
    for (let i = 0; i < 1000; i++) await addCapture(lib, { name: `Sound ${i}`, description: i % 10 === 0 ? 'metal bell' : 'wood knock' });
    const audio = await readyAsset(lib, 'AI_TRACK');
    for (let i = 0; i < 100; i++) {
      await lib.tracks.create({ name: `Track ${i}`, description: '', mode: 'AI', audioAssetId: audio.id, durationMs: 1, bpm: 90, key: null, scale: null, style: 'lofi', plan: null, peaks: [], lyricId: null, prompt: null, sources: [], versions: { model: null, kb: null, systemPrompt: null, renderer: 'r' } });
      await lib.lyrics.create({ name: `Lyric ${i}`, description: '', text: 'la la', structured: null, language: 'en', style: null, sourceTrackId: null, sourceCaptureIds: [] });
    }
    const t0 = Date.now();
    const hits = await lib.captures.list({ search: 'metal bell', limit: 40 });
    const total = await lib.captures.count({ search: 'metal' });
    const ms = Date.now() - t0;
    expect(hits.length).toBe(40);
    expect(total).toBe(100);
    expect(ms).toBeLessThan(250);
  }, 60000);
});

describe('media store', () => {
  function fakeFs(free = 10e9) {
    const files = new Map<string, number>();
    const fs: FileOps = {
      exists: async (u) => files.has(u),
      size: async (u) => files.get(u) ?? 0,
      move: async (a, b) => {
        if (!files.has(a)) throw new Error('missing');
        files.set(b, files.get(a)!);
        files.delete(a);
      },
      remove: async (u) => void files.delete(u),
      mkdir: async () => {},
      list: async (dir) => [...files.keys()].filter((k) => k.startsWith(dir + '/')).map((k) => k.slice(dir.length + 1)),
      freeBytes: async () => free,
    };
    return { fs, files };
  }

  it('commits temp media atomically and cleans up deleted files', async () => {
    const { lib } = await fresh();
    const { fs, files } = fakeFs();
    const store = new MediaStore(lib.media, fs, 'file:///docs/');
    await store.init();
    const tmp = store.tempUri('wav');
    files.set(tmp, 1234);
    const asset = await store.commit(tmp, { kind: 'AUDIO_CAPTURE', dir: 'audio', ext: 'wav', mimeType: 'audio/wav', durationMs: 900 });
    expect(asset.status).toBe('READY');
    expect(asset.sizeBytes).toBe(1234);
    expect(files.has(tmp)).toBe(false);
    expect(files.has(store.uri(asset.path))).toBe(true);

    await lib.media.setStatus(asset.id, 'DELETED');
    expect(await store.cleanup()).toEqual({ removed: 1, failed: 0 });
    expect(files.has(store.uri(asset.path))).toBe(false);
    expect(await lib.media.listPendingCleanup()).toEqual([]);
  });

  it('refuses empty or missing recordings and low storage', async () => {
    const { lib } = await fresh();
    const { fs, files } = fakeFs(50 * 1024 * 1024);
    const store = new MediaStore(lib.media, fs, 'file:///docs/');
    await expect(store.commit('file:///docs/nope.wav', { kind: 'AUDIO_CAPTURE', dir: 'audio', ext: 'wav', mimeType: 'audio/wav' })).rejects.toThrow('not written');
    const empty = store.tempUri('wav');
    files.set(empty, 0);
    await expect(store.commit(empty, { kind: 'AUDIO_CAPTURE', dir: 'audio', ext: 'wav', mimeType: 'audio/wav' })).rejects.toThrow('empty');
    await expect(store.ensureSpace()).rejects.toBeInstanceOf(InsufficientStorageError);
  });

  it('startup clears the temp directory', async () => {
    const { lib } = await fresh();
    const { fs, files } = fakeFs();
    const store = new MediaStore(lib.media, fs, 'file:///docs/');
    files.set(store.uri('v2/temp/left-over.wav'), 10);
    await store.init();
    expect(files.size).toBe(0);
  });
});
