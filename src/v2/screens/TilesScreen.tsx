import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WorldJamAudio from 'worldjam-audio';

import { toast } from '../components/Toasts';
import { Button, Chip, Field, Header, Screen } from '../components/ui';
import type { Capture, Track } from '../contracts/library';
import { chartDone, chartFromPlan, chartFromTake, defaultChart, LANES, newTilesState, sweepMisses, tap, type Grade, type ScoreEntry, type Tile, type TilesState } from '../games/logic';
import { loadKit, pickKitCaptures, playKit, readBoard, saveScore } from '../games/kit';
import { useNav } from '../nav/store';
import { getLibrary, useLibraryQuery } from '../services/library';
import { useStudio } from '../services/studio';
import { color, font, radius, roleColor, space } from '../theme';

type Source = 'grid' | 'ai' | 'jam';
type Phase = 'setup' | 'playing' | 'done';

/** How long a tile takes to fall from the top to the pads. */
const FALL_MS = 1800;
const PAD_H = 96;
const LANE_TINT = [roleColor.kick ?? color.pink, color.cyan, color.violet];

export function TilesScreen() {
  const insets = useSafeAreaInsets();
  const { pop, setTab } = useNav();
  const [phase, setPhase] = useState<Phase>('setup');
  const [name, setName] = useState('');
  const [source, setSource] = useState<Source>('grid');
  const [jamId, setJamId] = useState<string | null>(null);
  const [kit, setKit] = useState<Capture[]>([]);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [now, setNow] = useState(0);
  const [flash, setFlash] = useState<{ lane: number; grade: Grade | null; at: number } | null>(null);
  const [board, setBoard] = useState<ScoreEntry[]>([]);
  const [result, setResult] = useState<ScoreEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const state = useRef<TilesState>(newTilesState());
  const t0 = useRef(0);
  const raf = useRef<number | null>(null);
  const take = useStudio((s) => s.take);
  const preview = useStudio((s) => s.preview);
  const sessionPlan = useStudio((s) => s.session?.plan ?? null);
  const { data: jams } = useLibraryQuery((lib) => lib.tracks.list({ sort: 'newest', limit: 30 }), []);

  useEffect(() => {
    getLibrary().then((l) => l.profile.get()).then((p) => p && setName(p.name)).catch(() => {});
    readBoard().then(setBoard);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      WorldJamAudio.setMetronome(false, 90);
    };
  }, []);

  const aiPlan = preview?.plan ?? sessionPlan;
  const W = Dimensions.get('window').width;
  const laneW = W / LANES;
  const H = Dimensions.get('window').height - insets.top - insets.bottom - 150;

  const start = async (skipName: boolean) => {
    setBusy(true);
    try {
      let chart: Tile[];
      let prefer: string[] = [];
      let bpm = 90;
      let lanePadCaps: string[] = [];
      if (source === 'grid' && take?.events.length) {
        const c = chartFromTake(take.events);
        chart = c.tiles;
        const src = useStudio.getState().session?.sources ?? [];
        lanePadCaps = c.lanePads.map((p) => src.find((s) => s.padIndex === p)?.captureId ?? '').filter(Boolean);
        bpm = useStudio.getState().session?.bpm ?? 90;
      } else if (source === 'ai' && aiPlan) {
        const c = chartFromPlan(aiPlan);
        chart = c.tiles;
        lanePadCaps = c.laneCaptures;
        bpm = c.bpm;
      } else if (source === 'jam' && jamId) {
        const t = (jams ?? []).find((j: Track) => j.id === jamId);
        if (!t?.plan) throw new Error('That jam has no arrangement to play');
        const c = chartFromPlan(t.plan);
        chart = c.tiles;
        lanePadCaps = c.laneCaptures;
        bpm = c.bpm;
      } else {
        chart = defaultChart(90, 12);
        toast('No beat yet — playing a practice groove');
      }
      prefer = lanePadCaps;
      const caps = await pickKitCaptures(LANES, prefer);
      if (caps.length === 0) throw new Error('Capture a few sounds first — the lanes play your own sounds');
      while (caps.length < LANES) caps.push(caps[caps.length % Math.max(1, caps.length)]);
      await loadKit(caps);
      setKit(caps);
      if (!skipName && name.trim()) {
        /* name kept for the leaderboard */
      }
      state.current = newTilesState();
      setTiles(chart);
      setResult(null);
      t0.current = Date.now() + 300;
      WorldJamAudio.setMetronome(true, bpm);
      setPhase('playing');
      const loop = () => {
        const n = Date.now() - t0.current;
        sweepMisses(state.current, chart, n);
        setNow(n);
        if (chartDone(state.current, chart)) {
          void finish(chart, source);
          return;
        }
        raf.current = requestAnimationFrame(loop);
      };
      raf.current = requestAnimationFrame(loop);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const finish = async (chart: Tile[], src: Source) => {
    WorldJamAudio.setMetronome(false, 90);
    const s = state.current;
    const entry: ScoreEntry = { name: name.trim() || 'Player', score: s.score, bestCombo: s.bestCombo, misses: s.misses, source: src === 'grid' ? 'My beat grid' : src === 'ai' ? 'AI beat' : 'Saved jam', at: Date.now() };
    setResult(entry);
    setBoard(await saveScore(entry));
    setPhase('done');
    void chart;
  };

  const quit = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    WorldJamAudio.setMetronome(false, 90);
    setPhase('setup');
  };

  const onLane = useCallback((lane: number) => {
    const n = Date.now() - t0.current;
    const r = tap(state.current, tiles, lane, n);
    playKit(lane, r.grade ? 1 : 0.7);
    setFlash({ lane, grade: r.grade, at: Date.now() });
  }, [tiles]);

  const visible = useMemo(
    () => tiles.filter((t) => !state.current.hit.has(t.id) && t.timeMs - now < FALL_MS && now - t.timeMs < 400),
    [tiles, now],
  );

  if (phase === 'playing') {
    const s = state.current;
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.hud}>
          <Text style={font.heading}>{s.score}</Text>
          <Text style={font.label}>Combo ×{s.combo}</Text>
          <Text style={[font.label, { color: s.misses ? color.error : color.textSecondary }]}>Misses {s.misses}/3</Text>
          <Chip label="Quit" onPress={quit} />
        </View>
        <View style={{ height: H + PAD_H, flexDirection: 'row' }}>
          {Array.from({ length: LANES }, (_, lane) => (
            <Pressable key={lane} onPressIn={() => onLane(lane)} style={[styles.lane, { width: laneW }]} accessibilityLabel={`Lane ${lane + 1}, ${kit[lane]?.name ?? ''}`}>
              {visible
                .filter((t) => t.lane === lane)
                .map((t) => {
                  const y = ((now - (t.timeMs - FALL_MS)) / FALL_MS) * H;
                  const missed = s.missed.has(t.id);
                  return <View key={t.id} style={[styles.tile, { top: y - 56, backgroundColor: missed ? color.line : LANE_TINT[lane] }]} />;
                })}
              <View style={[styles.pad, { top: H, borderColor: LANE_TINT[lane] }, flash?.lane === lane && Date.now() - flash.at < 160 && { backgroundColor: LANE_TINT[lane] }]}>
                <Text numberOfLines={1} style={styles.padText}>{kit[lane]?.name ?? ['Left', 'Centre', 'Right'][lane]}</Text>
                {flash?.lane === lane && Date.now() - flash.at < 500 && flash.grade && <Text style={styles.grade}>{flash.grade}</Text>}
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  return (
    <Screen scroll>
      <Header title="Tiles" subtitle="Tap each lane as its tile lands — in time with your beat" onBack={pop} />
      {phase === 'done' && result && (
        <View style={styles.card}>
          <Text style={font.title}>{result.score} points</Text>
          <Text style={font.body}>Best combo ×{result.bestCombo} · Misses {result.misses} · {result.source}</Text>
        </View>
      )}
      <View style={{ gap: space.lg, marginTop: space.lg }}>
        <Field label="Your name for the leaderboard" value={name} onChangeText={setName} maxLength={24} />
        <Text style={font.label}>Tiles fall to</Text>
        <View style={styles.wrap}>
          <Chip label="My beat grid" selected={source === 'grid'} onPress={() => setSource('grid')} />
          <Chip label="AI beat" selected={source === 'ai'} onPress={() => setSource('ai')} />
          <Chip label="Saved jams" selected={source === 'jam'} onPress={() => setSource('jam')} />
        </View>
        {source === 'grid' && !take?.events.length && <Text style={font.caption}>No take recorded in Studio yet — a practice groove will play.</Text>}
        {source === 'ai' && !aiPlan && (
          <View style={{ gap: space.sm }}>
            <Text style={font.caption}>No AI beat yet.</Text>
            <Button label="Generate in Studio" icon="ai" onPress={() => { pop(); setTab('studio'); }} />
          </View>
        )}
        {source === 'jam' && (
          <View style={styles.wrap}>
            {(jams ?? []).filter((j) => j.plan).map((j) => (
              <Chip key={j.id} label={j.name} selected={jamId === j.id} onPress={() => setJamId(j.id)} />
            ))}
            {!(jams ?? []).some((j) => j.plan) && <Text style={font.caption}>No saved jams yet — a practice groove will play.</Text>}
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Button label="Skip name" onPress={() => { setName('Player'); void start(true); }} disabled={busy} style={{ flex: 1 }} />
          <Button label={phase === 'done' ? 'Play again' : 'Start'} kind="primary" icon="play" busy={busy} onPress={() => void start(false)} style={{ flex: 1.4 }} />
        </View>
        <Text style={font.caption}>PERFECT within 150 ms = 30 · GOOD within 300 ms = 20 · OK = 10. Points × combo. Three misses ends the game.</Text>
      </View>
      <View style={[styles.card, { marginTop: space.xl }]}>
        <Text style={font.heading}>Leaderboard</Text>
        {board.length === 0 && <Text style={font.body}>No scores yet.</Text>}
        {board.slice(0, 10).map((e, i) => (
          <View key={`${e.at}${i}`} style={styles.row}>
            <Text style={[font.label, { width: 24 }]}>{i + 1}</Text>
            <Text style={[font.body, { flex: 1, color: color.text }]} numberOfLines={1}>{e.name}</Text>
            <Text style={font.mono}>{e.score} · ×{e.bestCombo}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  hud: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.md },
  lane: { height: '100%', borderRightWidth: 1, borderRightColor: color.line, overflow: 'hidden' },
  tile: { position: 'absolute', left: 8, right: 8, height: 56, borderRadius: radius.card },
  pad: { position: 'absolute', left: 6, right: 6, height: PAD_H - 12, borderRadius: radius.card, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  padText: { color: color.text, fontWeight: '600', fontSize: 13, paddingHorizontal: 4 },
  grade: { color: color.text, fontSize: 11, fontWeight: '700', marginTop: 2 },
  card: { padding: space.lg, gap: space.sm, borderRadius: radius.panel, backgroundColor: color.surface },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
