import * as FileSystem from 'expo-file-system';
import { Asset } from 'expo-asset';

import { fallbackPlan, type PlannerCapture } from '../ai/fallback';
import { interpretPrompt } from '../ai/interpret';
import { KB_VERSION } from '../ai/kb/rules';
import { SYSTEM_PROMPT_VERSION } from '../ai/context';
import { fallbackLyrics, lyricsToText } from '../ai/lyricsV2';
import { compilePlan, RENDERER_VERSION, type InventoryItem } from '../audio/planCompiler';
import type { Capture, CaptureType } from '../contracts/library';
import type { StyleId } from '../contracts/musicPlan';
import type { SqlLibrary } from '../data/repos';
import { mediaStore, saveAudioCapture } from './capture';
import { compileDeps, renderToFile } from './engineLink';
import { notifyLibraryChanged } from './library';
import { captureAudioPath } from './media';

/**
 * The sounds WorldJam ships with (synthesised object sounds, see
 * native-tools/make-library-sounds.py) and the tracks the app arranges from
 * them. Imported once, through the same capture pipeline as a recording
 * (normalise, analyse, store), so they behave exactly like the user's own.
 */
const SOUNDS: Array<{ key: string; file: number; name: string; description: string; type: Exclude<CaptureType, 'VIDEO'> }> = [
  { key: 'knock', file: require('../../../assets/library/desk-knock.wav'), name: 'Desk knock', description: 'Knuckles on a wooden desk', type: 'AUDIO' },
  { key: 'can', file: require('../../../assets/library/steel-can.wav'), name: 'Steel can', description: 'Pen tapping a steel can', type: 'AUDIO' },
  { key: 'keys', file: require('../../../assets/library/key-ring.wav'), name: 'Key ring', description: 'Shaking a ring of keys', type: 'AUDIO' },
  { key: 'rice', file: require('../../../assets/library/rice-jar.wav'), name: 'Rice jar', description: 'Rice shaken in a glass jar', type: 'AUDIO' },
  { key: 'snap', file: require('../../../assets/library/finger-snap.wav'), name: 'Finger snap', description: 'Finger snaps', type: 'AUDIO' },
  { key: 'glass', file: require('../../../assets/library/wine-glass.wav'), name: 'Wine glass', description: 'Spoon on a wine glass, rings on E', type: 'AUDIO' },
  { key: 'bottle', file: require('../../../assets/library/bottle-note.wav'), name: 'Bottle note', description: 'Blowing across a bottle top', type: 'AUDIO' },
  { key: 'band', file: require('../../../assets/library/rubber-band.wav'), name: 'Rubber band', description: 'Rubber band plucked over a box', type: 'AUDIO' },
  { key: 'hum', file: require('../../../assets/library/evening-hum.wav'), name: 'Evening hum', description: 'Hummed tune in A minor', type: 'HUM' },
];

const TRACKS: Array<{ name: string; description: string; style: StyleId; durationSec: number; prompt: string; sounds: string[]; lyrics?: string }> = [
  {
    name: 'Late Night Glass',
    description: 'Slow lo-fi built on a ringing glass and a hummed tune',
    style: 'lofi',
    durationSec: 30,
    prompt: 'chill lofi night, soft and warm',
    sounds: ['knock', 'snap', 'rice', 'glass', 'bottle', 'hum'],
  },
  {
    name: 'Kitchen Festival',
    description: 'Mass beat out of a steel can, keys and a desk',
    style: 'massbeat',
    durationSec: 20,
    prompt: 'mass beat for a festival night, high energy',
    sounds: ['can', 'knock', 'keys', 'rice', 'band'],
  },
  {
    name: 'Monsoon Evening',
    description: 'Romantic Bollywood groove with bottle and glass melodies',
    style: 'bollywood',
    durationSec: 30,
    prompt: 'romantic bollywood evening in the rain',
    sounds: ['knock', 'snap', 'rice', 'glass', 'bottle', 'band', 'hum'],
    lyrics: 'rain on the window',
  },
];

const MARKER = 'v2/.library-1';

let running: Promise<void> | null = null;

export function installStarterLibrary(lib: SqlLibrary): Promise<void> {
  running ??= run(lib).finally(() => {
    running = null;
  });
  return running;
}

async function run(lib: SqlLibrary): Promise<void> {
  const marker = `${FileSystem.documentDirectory ?? ''}${MARKER}`;
  if ((await FileSystem.getInfoAsync(marker)).exists) return;
  const store = await mediaStore();

  // Sounds (skipped if a previous, interrupted run already imported them).
  const existing = await lib.captures.list({ limit: 5000 });
  const byKey: Record<string, Capture> = {};
  for (const s of SOUNDS) {
    const have = existing.find((c) => c.name === s.name && c.description === s.description);
    if (have) {
      byKey[s.key] = have;
      continue;
    }
    const asset = Asset.fromModule(s.file);
    await asset.downloadAsync();
    if (!asset.localUri) throw new Error(`missing ${s.name}`);
    const temp = store.tempUri('wav');
    await FileSystem.copyAsync({ from: asset.localUri, to: temp });
    byKey[s.key] = await saveAudioCapture(temp, s.type, { name: s.name, description: s.description, detectedLabel: null, inLibrary: true });
  }

  // Tracks, arranged and mixed on the phone from those sounds.
  const tracks = await lib.tracks.list({ limit: 5000 });
  for (const r of TRACKS) {
    if (tracks.some((t) => t.name === r.name)) continue;
    const caps = r.sounds.map((k) => byKey[k]).filter(Boolean);
    const planner: PlannerCapture[] = caps.map((c) => ({ id: c.id, name: c.name, description: c.description, type: c.type, features: c.features, detectedLabel: c.detectedLabel, role: null }));
    const plan = { ...fallbackPlan({ captures: planner, intent: interpretPrompt(r.prompt, planner), style: r.style, durationSec: r.durationSec }), title: r.name };
    const inventory: Record<string, InventoryItem> = {};
    for (const c of caps) {
      const path = await captureAudioPath(c);
      if (path) inventory[c.id] = { path, durationSec: (c.durationMs || 1000) / 1000, features: c.features };
    }
    const graph = await compilePlan(plan, inventory, compileDeps);
    const temp = store.tempUri('wav');
    const out = await renderToFile(graph, temp);
    const asset = await store.commit(temp, {
      kind: 'AI_TRACK',
      dir: 'track',
      ext: 'wav',
      mimeType: 'audio/wav',
      durationMs: Math.round(out.durationSec * 1000),
      sampleRate: 48000,
      channels: 2,
    });
    let lyricId: string | null = null;
    if (r.lyrics) {
      const l = fallbackLyrics(planner, r.lyrics, r.style, 'en');
      const text = lyricsToText(l);
      const saved = await lib.lyrics.create({ name: `${r.name}`, description: `Words for ${r.name}`, text, structured: { ...l, title: r.name }, language: 'en', style: r.style, sourceTrackId: null, sourceCaptureIds: caps.map((c) => c.id) });
      lyricId = saved.id;
    }
    const roleOf = (id: string) => plan.layers.find((l) => l.source.kind === 'capture' && l.source.captureId === id)?.role ?? null;
    const track = await lib.tracks.create({
      name: r.name,
      description: r.description,
      mode: 'AI',
      audioAssetId: asset.id,
      durationMs: Math.round(out.durationSec * 1000),
      bpm: plan.tempoBpm,
      key: plan.key,
      scale: plan.scale,
      style: plan.style,
      plan,
      peaks: out.peaks,
      lyricId,
      prompt: r.prompt,
      sources: caps.filter((c) => plan.layers.some((l) => l.source.kind === 'capture' && l.source.captureId === c.id)).map((c) => ({ captureId: c.id, name: c.name, description: c.description, role: roleOf(c.id) })),
      versions: { model: 'built-in director', kb: KB_VERSION, systemPrompt: SYSTEM_PROMPT_VERSION, renderer: RENDERER_VERSION },
    });
    if (lyricId) await lib.lyrics.update(lyricId, { sourceTrackId: track.id });
    notifyLibraryChanged();
  }

  await FileSystem.writeAsStringAsync(marker, String(Date.now()));
  notifyLibraryChanged();
}
