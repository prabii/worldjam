import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system';
import { useSession } from '@/state/sessionStore';
import { gridRows, gridHitCount, stepBeats } from '@/audio/beatGrid';
import { colors, radius, spacing, type } from '@/theme';
import { gradients } from '@/theme/gradients';
import type { SessionSummary } from '@/state/sessionStorage';

interface Props {
  onBack: () => void;
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const LANE_COUNT = 3;
const TILE_H = 86;
/** Height of the AR floor pads at the bottom — big enough for a foot. */
const PAD_H = 190;
/**
 * How far above the pad top a tile still counts as a hit.
 * A foot is coarse and slow, so this is deliberately generous.
 */
const HIT_ABOVE = 170;
/** How far past the pad top a late tile still counts. */
const HIT_BELOW = 120;
const LEADERBOARD_PATH = `${FileSystem.documentDirectory}worldjam-leaderboard.json`;

type BeatSource = 'grid' | 'jam' | 'ai';
type Step = 'name' | 'source' | 'ready' | 'playing' | 'over';

interface BeatHit {
  objectId: string;
  label: string;
  lane: number;
  /** Absolute beat position within the loop. */
  beatTime: number;
}

/**
 * A tile in flight.
 *
 * Position is stored as a plain number and advanced by the rAF loop rather
 * than by Animated: the hit test has to read the true on-screen position
 * every frame, and a native-driven Animated.Value cannot be read from JS.
 */
interface Tile {
  id: number;
  lane: number;
  label: string;
  /** Milliseconds (performance clock) at which this tile reaches the pad. */
  dueAt: number;
  hit: boolean;
  missed: boolean;
}

interface LeaderboardEntry {
  name: string;
  score: number;
  combo: number;
  date: string;
}

async function loadLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const raw = await FileSystem.readAsStringAsync(LEADERBOARD_PATH);
    return JSON.parse(raw) as LeaderboardEntry[];
  } catch {
    return [];
  }
}

async function saveLeaderboard(entries: LeaderboardEntry[]): Promise<void> {
  const sorted = [...entries].sort((a, b) => b.score - a.score).slice(0, 10);
  await FileSystem.writeAsStringAsync(LEADERBOARD_PATH, JSON.stringify(sorted));
}

const LANE_PALETTE = [
  { base: '#0A84FF', soft: 'rgba(10,132,255,0.22)', glow: 'rgba(10,132,255,0.45)' },
  { base: '#30D158', soft: 'rgba(48,209,88,0.22)', glow: 'rgba(48,209,88,0.45)' },
  { base: '#BF5AF2', soft: 'rgba(191,90,242,0.22)', glow: 'rgba(191,90,242,0.45)' },
];

export function PlayScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();

  const objects = useSession((s) => s.objects);
  const grid = useSession((s) => s.grid);
  const bpm = useSession((s) => s.bpm);
  const bars = useSession((s) => s.bars);
  const plan = useSession((s) => s.plan);
  const arranging = useSession((s) => s.arranging);
  const arrange = useSession((s) => s.arrange);
  const savedSessions = useSession((s) => s.savedSessions);
  const refreshSessions = useSession((s) => s.refreshSessions);
  const openSession = useSession((s) => s.openSession);
  const playObject = useSession((s) => s.playObject);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [arOn, setArOn] = useState(false);

  const [step, setStep] = useState<Step>('name');
  const [playerName, setPlayerName] = useState('');
  const [beatSource, setBeatSource] = useState<BeatSource>('grid');
  const [selectedJam, setSelectedJam] = useState<SessionSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [misses, setMisses] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  /** Tiles currently in flight. Mutated in place by the rAF loop. */
  const tilesRef = useRef<Tile[]>([]);
  /** Bumped once per frame to re-render tile positions. */
  const [, forceFrame] = useState(0);
  const [padFlash, setPadFlash] = useState<{ lane: number; kind: string } | null>(null);
  const [pressedLane, setPressedLane] = useState<number | null>(null);

  const rafRef = useRef<number | null>(null);
  const nextSpawn = useRef(0);
  const startedAt = useRef(0);
  const nextTileId = useRef(0);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const missRef = useRef(0);
  const overRef = useRef(false);

  const padTop = SCREEN_H - insets.bottom - PAD_H;
  const laneW = SCREEN_W / LANE_COUNT;
  /** Seconds a tile takes to travel from spawn to the pad line. */
  const travelMs = useMemo(() => Math.max(1400, (60000 / bpm) * 3), [bpm]);

  useEffect(() => {
    void loadLeaderboard().then(setLeaderboard);
    void refreshSessions();
  }, [refreshSessions]);

  /** Objects mapped one per lane, so every lane has a distinct sound. */
  const laneObjects = useMemo(() => {
    const out: (typeof objects[number] | null)[] = [];
    for (let i = 0; i < LANE_COUNT; i++) out.push(objects[i] ?? null);
    return out;
  }, [objects]);

  const laneLabels = useMemo(
    () => laneObjects.map((o, i) => o?.label ?? ['Left', 'Centre', 'Right'][i]),
    [laneObjects],
  );

  // ── Beat sequence ─────────────────────────────────────────────────────────

  const beatSequence = useMemo((): BeatHit[] => {
    const hits: BeatHit[] = [];

    /** Stable lane for an object: its index in the captured list. */
    const laneFor = (objectId: string, fallback: number) => {
      const i = objects.findIndex((o) => o.id === objectId);
      return i >= 0 ? i % LANE_COUNT : fallback % LANE_COUNT;
    };

    if (beatSource === 'ai' && plan) {
      plan.objectPattern.forEach((entry, idx) => {
        const obj = objects.find(
          (o) => o.label.toLowerCase() === entry.object.toLowerCase(),
        );
        for (const b of entry.beats) {
          hits.push({
            objectId: obj?.id ?? '',
            label: entry.object,
            lane: obj ? laneFor(obj.id, idx) : idx % LANE_COUNT,
            beatTime: b - 1,
          });
        }
      });
    } else if (gridHitCount(grid) > 0 && objects.length > 0) {
      const rows = gridRows(grid, objects);
      const unit = stepBeats(grid.steps);
      for (let bar = 0; bar < bars; bar++) {
        rows.forEach(({ object, row }) => {
          row.forEach((on, s) => {
            if (!on) return;
            hits.push({
              objectId: object.id,
              label: object.label,
              lane: laneFor(object.id, 0),
              beatTime: bar * 4 + s * unit,
            });
          });
        });
      }
    }

    // Nothing programmed: build a playable four-on-the-floor so the game
    // always has something to play rather than standing empty.
    if (hits.length === 0) {
      const total = Math.max(bars, 2) * 4;
      for (let b = 0; b < total; b++) {
        const lane = b % LANE_COUNT;
        hits.push({
          objectId: laneObjects[lane]?.id ?? '',
          label: laneLabels[lane],
          lane,
          beatTime: b,
        });
        // A syncopated off-beat every other bar keeps it from feeling flat.
        if (b % 4 === 2) {
          const l2 = (b + 1) % LANE_COUNT;
          hits.push({
            objectId: laneObjects[l2]?.id ?? '',
            label: laneLabels[l2],
            lane: l2,
            beatTime: b + 0.5,
          });
        }
      }
    }

    return hits.sort((a, b) => a.beatTime - b.beatTime);
  }, [grid, objects, bars, plan, beatSource, laneObjects, laneLabels]);

  // ── Game loop ─────────────────────────────────────────────────────────────

  const finish = useCallback(async () => {
    if (overRef.current) return;
    overRef.current = true;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setStep('over');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});

    const entry: LeaderboardEntry = {
      name: playerName.trim() || 'Anonymous',
      score: scoreRef.current,
      combo: maxComboRef.current,
      date: new Date().toLocaleDateString(),
    };
    const updated = [...(await loadLeaderboard()), entry]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    await saveLeaderboard(updated);
    setLeaderboard(updated);
  }, [playerName]);

  /**
   * One frame: spawn anything due, retire anything that fell past the pad,
   * then ask React to repaint. Position is derived from the clock rather
   * than stored, so a dropped frame never desynchronises the tiles from the
   * music or from the hit test.
   */
  const frame = useCallback(() => {
    if (overRef.current) return;

    const now = performance.now();
    const beatMs = 60000 / bpm;
    const loopBeats = Math.max(bars, 2) * 4;
    const loopMs = loopBeats * beatMs;

    // Spawn every hit whose arrival is now within one travel window.
    while (beatSequence.length > 0) {
      const i = nextSpawn.current;
      const rep = Math.floor(i / beatSequence.length);
      const hit = beatSequence[i % beatSequence.length];
      const dueAt = startedAt.current + rep * loopMs + hit.beatTime * beatMs;
      if (dueAt - now > travelMs) break;
      tilesRef.current.push({
        id: nextTileId.current++,
        lane: hit.lane,
        label: hit.label,
        dueAt,
        hit: false,
        missed: false,
      });
      nextSpawn.current++;
    }

    // Retire tiles that fell past the hit window.
    let missedThisFrame = 0;
    tilesRef.current = tilesRef.current.filter((t) => {
      if (t.hit) return false;
      const late = now - t.dueAt;
      if (late > HIT_BELOW + PAD_H) {
        if (!t.missed) missedThisFrame++;
        return false;
      }
      return true;
    });

    if (missedThisFrame > 0) {
      missRef.current += missedThisFrame;
      comboRef.current = 0;
      setMisses(missRef.current);
      setCombo(0);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      if (missRef.current >= 3) {
        void finish();
        return;
      }
    }

    forceFrame((n) => n + 1);
    rafRef.current = requestAnimationFrame(frame);
  }, [beatSequence, bpm, bars, travelMs, finish]);

  const startGame = useCallback(() => {
    tilesRef.current = [];
    nextSpawn.current = 0;
    nextTileId.current = 0;
    scoreRef.current = 0;
    comboRef.current = 0;
    maxComboRef.current = 0;
    missRef.current = 0;
    overRef.current = false;
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setMisses(0);
    setStep('playing');
    startedAt.current = performance.now() + travelMs;
    rafRef.current = requestAnimationFrame(frame);
  }, [frame, travelMs]);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  /** Screen Y of a tile's top edge, derived from how long until it is due. */
  const yOf = useCallback(
    (t: Tile, now: number) => {
      const remaining = t.dueAt - now;
      const progress = 1 - remaining / travelMs;
      return -TILE_H + progress * (padTop + TILE_H);
    },
    [travelMs, padTop],
  );

  // ── Hit test ──────────────────────────────────────────────────────────────

  const strike = useCallback(
    (lane: number) => {
      if (step !== 'playing' || overRef.current) return;

      const now = performance.now();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});

      // The tile in this lane closest to being due right now.
      let best: Tile | null = null;
      let bestOff = Infinity;
      for (const t of tilesRef.current) {
        if (t.lane !== lane || t.hit) continue;
        const off = now - t.dueAt; // negative = early, positive = late
        const px = (Math.abs(off) / travelMs) * (padTop + TILE_H);
        if (off < 0 ? px > HIT_ABOVE : px > HIT_BELOW) continue;
        if (Math.abs(off) < bestOff) {
          bestOff = Math.abs(off);
          best = t;
        }
      }

      if (!best) return;

      best.hit = true;
      const obj = laneObjects[lane];
      if (obj) playObject(obj.id);

      // Timing grades are in milliseconds, not pixels — a foot is slow, so
      // the windows are wide compared with a thumb-played rhythm game.
      const kind = bestOff < 140 ? 'PERFECT' : bestOff < 300 ? 'GOOD' : 'OK';
      const points = kind === 'PERFECT' ? 30 : kind === 'GOOD' ? 20 : 10;

      setPadFlash({ lane, kind });
      setTimeout(() => setPadFlash(null), 320);

      scoreRef.current += points * (comboRef.current + 1);
      comboRef.current += 1;
      if (comboRef.current > maxComboRef.current) {
        maxComboRef.current = comboRef.current;
        setMaxCombo(comboRef.current);
      }
      setScore(scoreRef.current);
      setCombo(comboRef.current);
    },
    [step, travelMs, padTop, laneObjects, playObject],
  );

  // ── Setup actions ─────────────────────────────────────────────────────────

  const enableAR = useCallback(async () => {
    if (!cameraPermission?.granted) {
      const res = await requestCameraPermission();
      setArOn(res.granted);
      return;
    }
    setArOn((v) => !v);
  }, [cameraPermission, requestCameraPermission]);

  /** Ask Gemma for an arrangement right here, rather than sending the user away. */
  const generateAI = useCallback(async () => {
    if (objects.length === 0) return;
    setBusy('Gemma is writing your beat…');
    await arrange('a punchy danceable beat for a rhythm game, strong downbeats');
    setBusy(null);
    setBeatSource('ai');
    setStep('ready');
  }, [arrange, objects.length]);

  const pickJam = useCallback(
    async (jam: SessionSummary) => {
      setBusy(`Loading ${jam.name}…`);
      await openSession(jam.id);
      setSelectedJam(jam);
      setBeatSource(gridHitCount(useSession.getState().grid) > 0 ? 'grid' : 'ai');
      setBusy(null);
      setStep('ready');
    },
    [openSession],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const now = performance.now();
  const liveTiles = step === 'playing' ? tilesRef.current : [];

  return (
    <View style={styles.root}>
      {/* Camera is the world. When AR is off we fall back to a dark stage. */}
      {arOn && cameraPermission?.granted ? (
        <View style={StyleSheet.absoluteFill}>
          <CameraView style={StyleSheet.absoluteFill} facing="back" />
          <LinearGradient
            colors={['rgba(2,2,6,0.72)', 'rgba(2,2,6,0.25)', 'rgba(2,2,6,0.82)']}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>
      ) : (
        <LinearGradient
          colors={['#05050A', '#0B0B16', '#05050A']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}

      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={onBack} style={styles.back} accessibilityRole="button">
          <Text style={styles.backChevron}>‹</Text>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.screenTitle}>AR Play</Text>
        {step === 'playing' ? (
          <View style={styles.scorePill}>
            <Text style={styles.scoreNum}>{score}</Text>
          </View>
        ) : (
          <Pressable onPress={enableAR} style={styles.arBtn} accessibilityRole="switch">
            <View style={[styles.arDot, arOn && styles.arDotOn]} />
            <Text style={[styles.arBtnText, arOn && { color: colors.live }]}>AR</Text>
          </Pressable>
        )}
      </View>

      {/* ── name ─────────────────────────────────────────────────────────── */}
      {step === 'name' && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.centre}
        >
          <View style={styles.card}>
            <LinearGradient
              colors={gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cardIcon}
            >
              <Text style={styles.cardIconText}>🕹️</Text>
            </LinearGradient>
            <Text style={styles.cardTitle}>Who&apos;s playing?</Text>
            <Text style={styles.cardSub}>Your score goes on the leaderboard</Text>
            <TextInput
              style={styles.input}
              value={playerName}
              onChangeText={setPlayerName}
              placeholder="Your name…"
              placeholderTextColor={colors.textFaint}
              maxLength={20}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => {
                Keyboard.dismiss();
                setStep('source');
              }}
            />
            <Pressable
              onPress={() => {
                Keyboard.dismiss();
                setStep('source');
              }}
              style={styles.primaryBtn}
            >
              <LinearGradient
                colors={gradients.brand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.primaryInner}
              >
                <Text style={styles.primaryText}>Continue</Text>
              </LinearGradient>
            </Pressable>
            <Pressable
              onPress={() => {
                setPlayerName('Anonymous');
                setStep('source');
              }}
              style={styles.ghost}
            >
              <Text style={styles.ghostText}>Skip</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* ── source ───────────────────────────────────────────────────────── */}
      {step === 'source' && (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.setupTitle}>Pick your beat</Text>
          <Text style={styles.setupSub}>
            {playerName || 'Player'} — what should the tiles fall to?
          </Text>

          <Pressable
            onPress={() => {
              setBeatSource('grid');
              setStep('ready');
            }}
            style={[styles.srcCard, beatSource === 'grid' && styles.srcCardOn]}
          >
            <LinearGradient
              colors={gridHitCount(grid) > 0 ? gradients.brand : ['#1C1C22', '#1C1C22']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.srcIcon}
            >
              <Text style={styles.srcIconText}>⊞</Text>
            </LinearGradient>
            <View style={styles.srcInfo}>
              <Text style={styles.srcTitle}>My beat grid</Text>
              <Text style={styles.srcSub}>
                {gridHitCount(grid) > 0
                  ? `${gridHitCount(grid)} hits · ${bpm} BPM`
                  : 'Nothing programmed — plays a default groove'}
              </Text>
            </View>
          </Pressable>

          <Pressable
            onPress={plan ? () => { setBeatSource('ai'); setStep('ready'); } : generateAI}
            disabled={objects.length === 0 || arranging || busy != null}
            style={[
              styles.srcCard,
              beatSource === 'ai' && styles.srcCardOn,
              objects.length === 0 && styles.srcCardOff,
            ]}
          >
            <LinearGradient
              colors={objects.length > 0 ? ['#BF5AF2', '#7C3AED'] : ['#1C1C22', '#1C1C22']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.srcIcon}
            >
              <Text style={styles.srcIconText}>✦</Text>
            </LinearGradient>
            <View style={styles.srcInfo}>
              <Text style={styles.srcTitle}>
                {plan ? 'AI beat' : 'Generate an AI beat'}
              </Text>
              <Text style={styles.srcSub}>
                {objects.length === 0
                  ? 'Capture a sound first'
                  : plan
                    ? `Gemma · ${plan.style} · ${bpm} BPM`
                    : 'Gemma writes a pattern from your sounds'}
              </Text>
            </View>
            {plan && <Text style={styles.regen} onPress={generateAI}>↻</Text>}
          </Pressable>

          {savedSessions.length > 0 && (
            <>
              <Text style={styles.srcSection}>SAVED JAMS</Text>
              {savedSessions.slice(0, 6).map((jam) => (
                <Pressable
                  key={jam.id}
                  onPress={() => pickJam(jam)}
                  style={[styles.srcCard, selectedJam?.id === jam.id && styles.srcCardOn]}
                >
                  <LinearGradient
                    colors={gradients.brandShort}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.srcIcon}
                  >
                    <Text style={styles.srcIconText}>♪</Text>
                  </LinearGradient>
                  <View style={styles.srcInfo}>
                    <Text style={styles.srcTitle} numberOfLines={1}>
                      {jam.name}
                    </Text>
                    <Text style={styles.srcSub}>
                      {jam.objectCount} sounds · {jam.style} · {jam.bpm} BPM
                    </Text>
                  </View>
                </Pressable>
              ))}
            </>
          )}

          {(busy || arranging) && (
            <Text style={styles.busy}>{busy ?? 'Working…'}</Text>
          )}
        </ScrollView>
      )}

      {/* ── ready ────────────────────────────────────────────────────────── */}
      {step === 'ready' && (
        <View style={styles.centre}>
          <LinearGradient
            colors={gradients.brand}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.readyIcon}
          >
            <Text style={styles.readyGlyph}>♪</Text>
          </LinearGradient>
          <Text style={styles.readyTitle}>Ready, {playerName || 'Player'}?</Text>
          <Text style={styles.readySub}>
            {beatSource === 'ai'
              ? `AI beat · ${plan?.style ?? ''}`
              : selectedJam
                ? selectedJam.name
                : 'Your grid beat'}{' '}
            · {bpm} BPM · {beatSequence.length} tiles
          </Text>

          <View style={styles.padPreview}>
            {LANE_PALETTE.map((lp, i) => (
              <View
                key={i}
                style={[
                  styles.padPreviewBlock,
                  { backgroundColor: lp.soft, borderColor: lp.base },
                ]}
              >
                <Text style={[styles.padPreviewText, { color: lp.base }]} numberOfLines={1}>
                  {laneLabels[i]}
                </Text>
              </View>
            ))}
          </View>

          <Text style={styles.readyHow}>
            Put the phone on the floor, camera up.{'\n'}
            Stamp the pad when its tile lands.{'\n'}
            Three misses and you&apos;re out.
          </Text>

          {!arOn && (
            <Pressable onPress={enableAR} style={styles.arPrompt}>
              <Text style={styles.arPromptText}>📷 Turn on AR camera</Text>
            </Pressable>
          )}

          <Pressable onPress={startGame} style={styles.primaryBtn}>
            <LinearGradient
              colors={gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryInner}
            >
              <Text style={styles.primaryText}>Start</Text>
            </LinearGradient>
          </Pressable>
          <Pressable onPress={() => setStep('source')} style={styles.ghost}>
            <Text style={styles.ghostText}>Change beat</Text>
          </Pressable>
        </View>
      )}

      {/* ── playing ──────────────────────────────────────────────────────── */}
      {step === 'playing' && (
        <>
          <View style={styles.hud}>
            <View style={styles.hudItem}>
              <Text style={styles.hudLabel}>COMBO</Text>
              <Text style={[styles.hudValue, combo >= 5 && { color: colors.warn }]}>
                {combo}x
              </Text>
            </View>
            <View style={styles.hudItem}>
              <Text style={styles.hudLabel}>BPM</Text>
              <Text style={styles.hudValue}>{bpm}</Text>
            </View>
            <View style={styles.hudItem}>
              <Text style={styles.hudLabel}>MISS</Text>
              <View style={styles.missRow}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={[styles.missDot, i < misses && styles.missDotOn]} />
                ))}
              </View>
            </View>
          </View>

          {/*
            The AR runway: lane walls converge toward a vanishing point so the
            three pads read as lying on the floor in front of the player rather
            than as flat buttons stuck to the glass.
          */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {Array.from({ length: LANE_COUNT + 1 }).map((_, i) => {
              const bottomX = i * laneW;
              const topX = SCREEN_W / 2 + (bottomX - SCREEN_W / 2) * 0.18;
              const dx = bottomX - topX;
              const dy = padTop - SCREEN_H * 0.26;
              const len = Math.hypot(dx, dy);
              const angle = Math.atan2(dy, dx) - Math.PI / 2;
              return (
                <View
                  key={i}
                  style={[
                    styles.runwayEdge,
                    {
                      left: topX,
                      top: SCREEN_H * 0.26,
                      height: len,
                      transform: [
                        { translateY: len / 2 },
                        { rotateZ: `${angle}rad` },
                        { translateY: -len / 2 },
                      ],
                    },
                  ]}
                />
              );
            })}
            {/* Horizon haze at the vanishing point. */}
            <LinearGradient
              colors={['rgba(120,140,255,0.16)', 'transparent']}
              style={[styles.horizon, { top: SCREEN_H * 0.24 }]}
            />
          </View>

          {/* Tiles. Position comes from the clock, so they cannot drift. */}
          {liveTiles.map((t) => {
            const lp = LANE_PALETTE[t.lane];
            const y = yOf(t, now);
            if (y < -TILE_H || y > SCREEN_H) return null;
            // Perspective: a tile far away is narrower and dimmer.
            const depth = Math.max(0, Math.min(1, (y + TILE_H) / (padTop + TILE_H)));
            const scale = 0.45 + depth * 0.55;
            const w = (laneW - 14) * scale;
            const cx = t.lane * laneW + laneW / 2;
            const shift = (cx - SCREEN_W / 2) * (1 - scale) * 0.55;
            return (
              <View
                key={t.id}
                pointerEvents="none"
                style={[
                  styles.tile,
                  {
                    left: cx - w / 2 - shift,
                    width: w,
                    top: y,
                    height: TILE_H * (0.55 + depth * 0.45),
                    opacity: 0.35 + depth * 0.65,
                    borderColor: lp.base,
                    backgroundColor: lp.soft,
                  },
                ]}
              >
                <View style={[styles.tileEdge, { backgroundColor: lp.base }]} />
                <Text style={styles.tileLabel} numberOfLines={1}>
                  {t.label}
                </Text>
              </View>
            );
          })}

          {padFlash && (
            <View
              pointerEvents="none"
              style={[
                styles.flash,
                {
                  left: padFlash.lane * laneW,
                  width: laneW,
                  top: padTop - 52,
                },
              ]}
            >
              <Text
                style={[
                  styles.flashText,
                  {
                    color:
                      padFlash.kind === 'PERFECT'
                        ? colors.warn
                        : padFlash.kind === 'GOOD'
                          ? colors.live
                          : colors.textDim,
                  },
                ]}
              >
                {padFlash.kind}
              </Text>
            </View>
          )}

          {/* The three floor pads. */}
          <View style={[styles.padRow, { top: padTop, height: PAD_H + insets.bottom }]}>
            {LANE_PALETTE.map((lp, i) => {
              const down = pressedLane === i;
              return (
                <Pressable
                  key={i}
                  onPressIn={() => {
                    setPressedLane(i);
                    strike(i);
                  }}
                  onPressOut={() => setPressedLane(null)}
                  // A foot lands wide and early; reach up the runway for it.
                  hitSlop={{ top: HIT_ABOVE, bottom: 0, left: 0, right: 0 }}
                  android_disableSound
                  accessibilityRole="button"
                  accessibilityLabel={`Pad ${i + 1}, ${laneLabels[i]}`}
                  style={[
                    styles.pad,
                    {
                      borderColor: down ? lp.base : `${lp.base}44`,
                      backgroundColor: down ? lp.glow : `${lp.base}0F`,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.padLip,
                      { backgroundColor: lp.base, opacity: down ? 1 : 0.45 },
                    ]}
                  />
                  <View style={styles.padBody}>
                    <View
                      style={[
                        styles.padRing,
                        {
                          borderColor: lp.base,
                          backgroundColor: down ? `${lp.base}55` : 'transparent',
                          transform: [{ scale: down ? 1.12 : 1 }],
                        },
                      ]}
                    >
                      <Text style={[styles.padNum, { color: down ? '#FFF' : lp.base }]}>
                        {i + 1}
                      </Text>
                    </View>
                    <Text
                      style={[styles.padLabel, { color: down ? '#FFF' : lp.base }]}
                      numberOfLines={1}
                    >
                      {laneLabels[i]}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {/* ── over ─────────────────────────────────────────────────────────── */}
      {step === 'over' && (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.overTitle}>
            {score > 500 ? '🔥 Insane' : score > 200 ? '🎵 Nice' : '💀 Game over'}
          </Text>
          <Text style={styles.overSub}>{playerName || 'Player'}</Text>

          <View style={styles.overStats}>
            <Stat label="Score" value={String(score)} color={colors.vibe} />
            <Stat label="Best combo" value={`${maxCombo}x`} color={colors.warn} />
            <Stat label="Misses" value={String(misses)} color={colors.accent} />
          </View>

          {leaderboard.length > 0 && (
            <View style={styles.board}>
              <Text style={styles.boardTitle}>🏆 LEADERBOARD</Text>
              {leaderboard.map((e, i) => {
                const mine = e.name === (playerName || 'Anonymous') && e.score === score;
                return (
                  <View key={i} style={[styles.boardRow, mine && styles.boardRowMine]}>
                    <Text style={[styles.boardRank, i === 0 && { color: colors.warn }]}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                    </Text>
                    <Text
                      style={[styles.boardName, mine && { color: colors.vibe }]}
                      numberOfLines={1}
                    >
                      {e.name}
                    </Text>
                    <Text style={styles.boardScore}>{e.score}</Text>
                    <Text style={styles.boardCombo}>{e.combo}x</Text>
                  </View>
                );
              })}
            </View>
          )}

          <View style={styles.overBtns}>
            <Pressable onPress={startGame} style={styles.primaryBtn}>
              <LinearGradient
                colors={gradients.brand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.primaryInner}
              >
                <Text style={styles.primaryText}>Play again</Text>
              </LinearGradient>
            </Pressable>
            <Pressable onPress={() => setStep('source')} style={styles.ghost}>
              <Text style={styles.ghostText}>Change beat</Text>
            </Pressable>
            <Pressable onPress={onBack} style={styles.ghost}>
              <Text style={styles.ghostText}>Back to studio</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05050A' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    zIndex: 30,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: spacing.md },
  backChevron: { fontSize: 22, fontWeight: '300', color: colors.vibe, marginTop: -1 },
  backText: { ...type.body, color: colors.vibe },
  screenTitle: { ...type.title, color: colors.text },
  scorePill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,214,10,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,214,10,0.2)',
  },
  scoreNum: { ...type.label, fontSize: 16, color: colors.warn, fontVariant: ['tabular-nums'] },
  arBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: spacing.sm },
  arDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textFaint },
  arDotOn: { backgroundColor: colors.live },
  arBtnText: { ...type.caption, color: colors.textDim, letterSpacing: 1 },

  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },

  card: {
    width: '100%',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(8,8,14,0.94)',
  },
  cardIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconText: { fontSize: 30 },
  cardTitle: { ...type.title, fontSize: 22, color: colors.text },
  cardSub: { ...type.body, color: colors.textDim, textAlign: 'center' },
  input: {
    width: '100%',
    height: 54,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.vibe,
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: spacing.lg,
    ...type.body,
    color: colors.text,
    fontSize: 19,
    textAlign: 'center',
    marginTop: spacing.sm,
  },

  primaryBtn: { width: '100%', marginTop: spacing.sm },
  primaryInner: { paddingVertical: spacing.lg, borderRadius: radius.pill, alignItems: 'center' },
  primaryText: { ...type.label, fontSize: 17, color: '#FFFFFF', letterSpacing: 0.5 },
  ghost: { paddingVertical: spacing.sm },
  ghostText: { ...type.body, color: colors.textDim },

  setupTitle: { ...type.display, fontSize: 26, color: colors.text, textAlign: 'center' },
  setupSub: {
    ...type.body,
    color: colors.textDim,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  srcCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  srcCardOn: { borderColor: colors.vibe, backgroundColor: 'rgba(10,132,255,0.08)' },
  srcCardOff: { opacity: 0.45 },
  srcIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  srcIconText: { fontSize: 22, color: '#FFFFFF' },
  srcInfo: { flex: 1, gap: 3 },
  srcTitle: { ...type.label, color: colors.text, fontSize: 15 },
  srcSub: { ...type.caption, color: colors.textDim },
  srcSection: {
    ...type.caption,
    letterSpacing: 2,
    color: colors.textFaint,
    alignSelf: 'flex-start',
    marginTop: spacing.md,
  },
  regen: { fontSize: 20, color: colors.ai, paddingHorizontal: spacing.sm },
  busy: { ...type.caption, color: colors.ai },

  readyIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyGlyph: { fontSize: 38, color: '#FFFFFF' },
  readyTitle: { ...type.display, fontSize: 27, color: colors.text, textAlign: 'center' },
  readySub: { ...type.body, color: colors.textDim, textAlign: 'center' },
  readyHow: {
    ...type.body,
    color: colors.textDim,
    textAlign: 'center',
    lineHeight: 23,
  },
  padPreview: { flexDirection: 'row', width: '100%', gap: spacing.sm, marginVertical: spacing.sm },
  padPreviewBlock: {
    flex: 1,
    height: 58,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  padPreviewText: { ...type.caption, fontWeight: '700', fontSize: 11 },
  arPrompt: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  arPromptText: { ...type.caption, color: colors.textDim },

  hud: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xxl,
    paddingVertical: spacing.sm,
    zIndex: 20,
  },
  hudItem: { alignItems: 'center', gap: 4 },
  hudLabel: { ...type.caption, fontSize: 9, letterSpacing: 2, color: colors.textFaint },
  hudValue: { ...type.title, fontSize: 20, color: colors.text, fontVariant: ['tabular-nums'] },
  missRow: { flexDirection: 'row', gap: 6 },
  missDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(255,69,58,0.3)',
  },
  missDotOn: { backgroundColor: colors.accent, borderColor: colors.accent },

  runwayEdge: {
    position: 'absolute',
    width: 1.5,
    backgroundColor: 'rgba(150,170,255,0.18)',
  },
  horizon: { position: 'absolute', left: 0, right: 0, height: 140 },

  tile: {
    position: 'absolute',
    borderRadius: radius.lg,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    overflow: 'hidden',
  },
  tileEdge: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  tileLabel: {
    ...type.label,
    fontSize: 13,
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  flash: { position: 'absolute', alignItems: 'center', zIndex: 18 },
  flashText: { ...type.label, fontSize: 18, fontWeight: '900', letterSpacing: 2 },

  padRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', zIndex: 25 },
  pad: {
    flex: 1,
    borderTopWidth: 2,
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    alignItems: 'center',
    paddingTop: spacing.md,
  },
  padLip: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  padBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  padRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  padNum: { ...type.title, fontSize: 22, fontWeight: '900' },
  padLabel: { ...type.label, fontSize: 12, fontWeight: '700', maxWidth: 96, textAlign: 'center' },

  overTitle: { ...type.display, fontSize: 31, color: colors.text, textAlign: 'center' },
  overSub: { ...type.body, color: colors.textDim },
  overStats: { flexDirection: 'row', gap: spacing.sm },
  overBtns: { gap: spacing.sm, alignItems: 'center', width: '100%' },

  board: {
    width: '100%',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(8,8,14,0.92)',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  boardTitle: { ...type.caption, letterSpacing: 2, color: colors.warn, marginBottom: spacing.xs },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 4 },
  boardRowMine: {
    backgroundColor: 'rgba(10,132,255,0.1)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
  },
  boardRank: { ...type.caption, color: colors.textFaint, width: 28, textAlign: 'center' },
  boardName: { ...type.label, color: colors.text, flex: 1, fontSize: 13 },
  boardScore: { ...type.label, color: colors.warn, fontSize: 14, fontVariant: ['tabular-nums'] },
  boardCombo: { ...type.caption, color: colors.textDim, width: 32, textAlign: 'right' },

  stat: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSolid,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 90,
  },
  statValue: { ...type.title, fontSize: 24, fontVariant: ['tabular-nums'] },
  statLabel: { ...type.caption, color: colors.textDim },
});
