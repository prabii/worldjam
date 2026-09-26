import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
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
const TILE_H = 80;
// Piano blocks at bottom — tall enough to tap with a foot
const PIANO_H = 180;
// Very generous hit zone for foot-tapping
const HIT_TOLERANCE = 150;
const LEADERBOARD_PATH = `${FileSystem.documentDirectory}worldjam-leaderboard.json`;

// Beat source modes
type BeatSource = 'grid' | 'jam' | 'ai';

interface BeatHit {
  objectId: string;
  label: string;
  color: string;
  lane: number;
  beatTime: number;
}

interface Tile {
  id: number;
  lane: number;
  label: string;
  color: string;
  y: Animated.Value;
  spawnedAt: number;
  targetMs: number;
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

// LANE COLORS — vivid, distinct per lane
const LANE_PALETTE = [
  { base: '#0A84FF', dim: 'rgba(10,132,255,0.18)', glow: 'rgba(10,132,255,0.5)' },   // blue
  { base: '#30D158', dim: 'rgba(48,209,88,0.18)',  glow: 'rgba(48,209,88,0.5)' },    // green
  { base: '#FF453A', dim: 'rgba(255,69,58,0.18)',  glow: 'rgba(255,69,58,0.5)' },    // red
];

export function PlayScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const objects = useSession((s) => s.objects);
  const grid = useSession((s) => s.grid);
  const bpm = useSession((s) => s.bpm);
  const bars = useSession((s) => s.bars);
  const plan = useSession((s) => s.plan);
  const savedSessions = useSession((s) => s.savedSessions);
  const openSession = useSession((s) => s.openSession);
  const playObject = useSession((s) => s.playObject);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [arEnabled, setArEnabled] = useState(false);

  // Setup flow
  const [step, setStep] = useState<'name' | 'source' | 'ready' | 'playing' | 'over'>('name');
  const [playerName, setPlayerName] = useState('');
  const [beatSource, setBeatSource] = useState<BeatSource>('grid');
  const [selectedJam, setSelectedJam] = useState<SessionSummary | null>(null);
  const [loadingJam, setLoadingJam] = useState(false);

  // Game state
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [misses, setMisses] = useState(0);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [pressedLane, setPressedLane] = useState<number | null>(null);
  const [hitEffect, setHitEffect] = useState<{ lane: number; type: 'perfect' | 'good' | 'ok' } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  // Lane labels — 3 objects mapped to 3 lanes
  const laneObjects = useMemo(() => {
    const objs = objects.slice(0, LANE_COUNT);
    while (objs.length < LANE_COUNT) objs.push(null as any);
    return objs;
  }, [objects]);

  const laneLabels = useMemo(
    () => laneObjects.map((o, i) => o?.label ?? `Lane ${i + 1}`),
    [laneObjects],
  );

  const tileId = useRef(0);
  const spawnIndex = useRef(0);
  const spawnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameStart = useRef(0);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const missesRef = useRef(0);

  // Piano block dimensions
  const pianoTop = SCREEN_H - insets.bottom - PIANO_H;
  const laneW = SCREEN_W / LANE_COUNT;
  // Tiles hit zone is just above the piano blocks
  const hitZoneY = pianoTop - TILE_H / 2;

  useEffect(() => {
    void loadLeaderboard().then(setLeaderboard);
  }, []);

  const requestAR = useCallback(async () => {
    if (!cameraPermission?.granted) {
      const res = await requestCameraPermission();
      if (res.granted) setArEnabled(true);
    } else {
      setArEnabled((v) => !v);
    }
  }, [cameraPermission, requestCameraPermission]);

  const fallDuration = useMemo(() => (60000 / bpm) * 3.5, [bpm]);

  // Build beat sequence from current grid or plan
  const beatSequence = useMemo((): BeatHit[] => {
    const hits: BeatHit[] = [];

    if (beatSource === 'ai' && plan) {
      // Use AI plan's objectPattern
      plan.objectPattern.forEach((entry, idx) => {
        const obj = objects.find((o) => o.label.toLowerCase() === entry.object.toLowerCase());
        entry.beats.forEach((b) => {
          hits.push({
            objectId: obj?.id ?? `ai-${idx}`,
            label: entry.object,
            color: obj?.color ?? LANE_PALETTE[idx % LANE_COUNT].base,
            lane: idx % LANE_COUNT,
            beatTime: b - 1,
          });
        });
      });
    } else if (gridHitCount(grid) > 0 && objects.length > 0) {
      // Use grid
      const rows = gridRows(grid, objects);
      const unit = stepBeats(grid.steps);
      for (let bar = 0; bar < bars; bar++) {
        rows.forEach(({ object, row }, rowIdx) => {
          row.forEach((on, step) => {
            if (!on) return;
            hits.push({
              objectId: object.id,
              label: object.label,
              color: object.color,
              lane: rowIdx % LANE_COUNT,
              beatTime: bar * 4 + step * unit,
            });
          });
        });
      }
    } else {
      // Fallback: simple 3-lane pattern
      for (let beat = 0; beat < bars * 4; beat += 1) {
        hits.push({
          objectId: '', label: `Beat ${beat + 1}`,
          color: LANE_PALETTE[beat % LANE_COUNT].base,
          lane: beat % LANE_COUNT, beatTime: beat,
        });
      }
    }

    return hits.sort((a, b) => a.beatTime - b.beatTime);
  }, [grid, objects, bars, plan, beatSource]);

  const getTileScreenY = useCallback(
    (tile: Tile) => {
      const elapsed = Date.now() - tile.spawnedAt;
      const total = tile.targetMs - tile.spawnedAt + (hitZoneY / SCREEN_H) * fallDuration;
      return -TILE_H + ((SCREEN_H + TILE_H * 2) * elapsed) / Math.max(total, 1);
    },
    [fallDuration, hitZoneY],
  );

  const spawnNextTile = useCallback(() => {
    if (beatSequence.length === 0) return;

    const idx = spawnIndex.current % beatSequence.length;
    const loopNum = Math.floor(spawnIndex.current / beatSequence.length);
    const hit = beatSequence[idx];
    const beatMs = 60000 / bpm;
    const totalLoopMs = bars * 4 * beatMs;
    const targetMs = gameStart.current + loopNum * totalLoopMs + hit.beatTime * beatMs;

    const y = new Animated.Value(-TILE_H);
    const id = tileId.current++;
    const now = Date.now();
    const timeUntilTarget = targetMs - now;
    const animDuration = timeUntilTarget + (hitZoneY / SCREEN_H) * fallDuration;

    const tile: Tile = {
      id, lane: hit.lane, label: hit.label, color: hit.color,
      y, spawnedAt: now, targetMs,
      hit: false, missed: false,
    };

    setTiles((prev) => [...prev, tile]);

    Animated.timing(y, {
      toValue: SCREEN_H + TILE_H,
      duration: Math.max(animDuration, 600),
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(() => {
      setTiles((prev) => {
        const t = prev.find((x) => x.id === id);
        if (t && !t.hit && !t.missed) {
          t.missed = true;
          missesRef.current += 1;
          setMisses(missesRef.current);
          setCombo(0);
          comboRef.current = 0;
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        }
        return prev.filter((x) => x.id !== id);
      });
    });

    spawnIndex.current++;

    const nextIdx = spawnIndex.current % beatSequence.length;
    const nextLoopNum = Math.floor(spawnIndex.current / beatSequence.length);
    const nextHit = beatSequence[nextIdx];
    const nextTargetMs =
      gameStart.current + nextLoopNum * totalLoopMs + nextHit.beatTime * beatMs;
    const delay = nextTargetMs - targetMs;

    spawnTimer.current = setTimeout(spawnNextTile, Math.max(delay - fallDuration * 0.65, 50));
  }, [beatSequence, bpm, bars, fallDuration, hitZoneY]);

  const startGame = useCallback(() => {
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setMisses(0);
    setTiles([]);
    scoreRef.current = 0;
    comboRef.current = 0;
    maxComboRef.current = 0;
    missesRef.current = 0;
    tileId.current = 0;
    spawnIndex.current = 0;
    gameStart.current = Date.now() + fallDuration * 0.5;
    setStep('playing');
    setTimeout(spawnNextTile, 200);
  }, [fallDuration, spawnNextTile]);

  const endGame = useCallback(async () => {
    if (spawnTimer.current) clearTimeout(spawnTimer.current);
    setStep('over');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});

    const entry: LeaderboardEntry = {
      name: playerName.trim() || 'Anonymous',
      score: scoreRef.current,
      combo: maxComboRef.current,
      date: new Date().toLocaleDateString(),
    };
    const existing = await loadLeaderboard();
    const updated = [...existing, entry].sort((a, b) => b.score - a.score).slice(0, 10);
    await saveLeaderboard(updated);
    setLeaderboard(updated);
  }, [playerName]);

  useEffect(() => {
    if (missesRef.current >= 3 && step === 'playing') {
      void endGame();
    }
  }, [misses, step, endGame]);

  useEffect(() => () => { if (spawnTimer.current) clearTimeout(spawnTimer.current); }, []);

  // Piano block press — generous target for foot/leg
  const handlePianoPress = useCallback(
    (lane: number) => {
      if (step !== 'playing') return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});

      setTiles((prev) => {
        let bestTile: Tile | null = null;
        let bestDist = Infinity;

        for (const t of prev) {
          if (t.lane !== lane || t.hit || t.missed) continue;
          const tileY = getTileScreenY(t);
          const dist = Math.abs(tileY - hitZoneY);
          if (dist < HIT_TOLERANCE && dist < bestDist) {
            bestDist = dist;
            bestTile = t;
          }
        }

        if (bestTile) {
          bestTile.hit = true;
          const obj = laneObjects[lane];
          if (obj) playObject(obj.id);

          const hitType = bestDist < 40 ? 'perfect' : bestDist < 80 ? 'good' : 'ok';
          setHitEffect({ lane, type: hitType });
          setTimeout(() => setHitEffect(null), 300);

          const points = hitType === 'perfect' ? 30 : hitType === 'good' ? 20 : 10;
          const newScore = scoreRef.current + points * (comboRef.current + 1);
          scoreRef.current = newScore;
          setScore(newScore);

          const newCombo = comboRef.current + 1;
          comboRef.current = newCombo;
          if (newCombo > maxComboRef.current) {
            maxComboRef.current = newCombo;
            setMaxCombo(newCombo);
          }
          setCombo(newCombo);
        }

        return prev;
      });
    },
    [step, getTileScreenY, hitZoneY, laneObjects, playObject],
  );

  // ─── SELECT JAM FLOW ──────────────────────────────────────────────────────

  const handleSelectJam = useCallback(
    async (jam: SessionSummary) => {
      setLoadingJam(true);
      await openSession(jam.id);
      setSelectedJam(jam);
      setBeatSource('jam');
      setLoadingJam(false);
      setStep('ready');
    },
    [openSession],
  );

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      {/* AR / background */}
      {arEnabled && cameraPermission?.granted ? (
        <View style={StyleSheet.absoluteFill}>
          <CameraView style={StyleSheet.absoluteFill} facing="back" />
          <LinearGradient
            colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.7)']}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>
      ) : (
        <LinearGradient
          colors={['#060609', '#0C0C18', '#060609']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}

      {/* HEADER — always visible */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={onBack} style={styles.back}>
          <Text style={styles.backChevron}>‹</Text>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.screenTitle}>AR Play Zone</Text>
        {step === 'playing' ? (
          <View style={styles.scoreWrap}>
            <Text style={styles.scoreNum}>{score}</Text>
          </View>
        ) : (
          <Pressable onPress={requestAR} style={styles.arBtn}>
            <View style={[styles.arDot, arEnabled && styles.arDotOn]} />
            <Text style={[styles.arBtnText, arEnabled && { color: colors.live }]}>AR</Text>
          </Pressable>
        )}
      </View>

      {/* ── STEP: NAME ENTRY ──────────────────────────────────────────────── */}
      {step === 'name' && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.centred}
        >
          <View style={styles.card}>
            <LinearGradient
              colors={gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cardIcon}
            >
              <Text style={styles.cardIconText}>🎮</Text>
            </LinearGradient>
            <Text style={styles.cardTitle}>What's your name?</Text>
            <Text style={styles.cardSub}>Shows on the leaderboard</Text>
            <TextInput
              style={styles.nameInput}
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
              onPress={() => { Keyboard.dismiss(); setStep('source'); }}
              style={styles.primaryBtn}
            >
              <LinearGradient
                colors={gradients.brand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.primaryBtnInner}
              >
                <Text style={styles.primaryBtnText}>Continue →</Text>
              </LinearGradient>
            </Pressable>
            <Pressable
              onPress={() => { setPlayerName('Anonymous'); setStep('source'); }}
              style={styles.ghostBtn}
            >
              <Text style={styles.ghostBtnText}>Skip</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* ── STEP: BEAT SOURCE PICKER ──────────────────────────────────────── */}
      {step === 'source' && (
        <ScrollView
          contentContainerStyle={[styles.centred, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.setupTitle}>Choose your beat</Text>
          <Text style={styles.setupSub}>Hey {playerName || 'Player'} — pick what tiles fall to</Text>

          {/* My Grid */}
          <Pressable
            onPress={() => { setBeatSource('grid'); setStep('ready'); }}
            style={[styles.sourceCard, beatSource === 'grid' && styles.sourceCardActive]}
          >
            <LinearGradient
              colors={gridHitCount(grid) > 0 ? gradients.brand : ['#1C1C1E', '#1C1C1E']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.sourceIcon}
            >
              <Text style={styles.sourceIconText}>⊞</Text>
            </LinearGradient>
            <View style={styles.sourceInfo}>
              <Text style={styles.sourceTitle}>My Beat Grid</Text>
              <Text style={styles.sourceSub}>
                {gridHitCount(grid) > 0
                  ? `${gridHitCount(grid)} hits · ${bpm} BPM`
                  : 'No beat yet — random tiles'}
              </Text>
            </View>
            {beatSource === 'grid' && <View style={styles.selectedDot} />}
          </Pressable>

          {/* AI Plan */}
          <Pressable
            onPress={() => { setBeatSource('ai'); setStep('ready'); }}
            style={[styles.sourceCard, beatSource === 'ai' && styles.sourceCardActive]}
          >
            <LinearGradient
              colors={plan ? ['#BF5AF2', '#7C3AED'] : ['#1C1C1E', '#1C1C1E']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.sourceIcon}
            >
              <Text style={styles.sourceIconText}>✦</Text>
            </LinearGradient>
            <View style={styles.sourceInfo}>
              <Text style={styles.sourceTitle}>AI Generated Beat</Text>
              <Text style={styles.sourceSub}>
                {plan
                  ? `Gemma · ${plan.style} · ${bpm} BPM`
                  : 'Arrange in Studio first'}
              </Text>
            </View>
            {beatSource === 'ai' && <View style={[styles.selectedDot, { backgroundColor: colors.ai }]} />}
          </Pressable>

          {/* Saved Jams */}
          {savedSessions.length > 0 && (
            <>
              <Text style={styles.jamSectionLabel}>SAVED JAMS</Text>
              {savedSessions.slice(0, 6).map((jam) => (
                <Pressable
                  key={jam.id}
                  onPress={() => handleSelectJam(jam)}
                  style={[
                    styles.sourceCard,
                    selectedJam?.id === jam.id && styles.sourceCardActive,
                  ]}
                >
                  <LinearGradient
                    colors={gradients.brandShort}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.sourceIcon}
                  >
                    <Text style={styles.sourceIconText}>♪</Text>
                  </LinearGradient>
                  <View style={styles.sourceInfo}>
                    <Text style={styles.sourceTitle} numberOfLines={1}>{jam.name}</Text>
                    <Text style={styles.sourceSub}>
                      {jam.objectCount} sounds · {jam.style} · {jam.bpm} BPM
                    </Text>
                  </View>
                  {selectedJam?.id === jam.id && <View style={styles.selectedDot} />}
                </Pressable>
              ))}
            </>
          )}

          {loadingJam && (
            <Text style={styles.loadingText}>Loading jam…</Text>
          )}
        </ScrollView>
      )}

      {/* ── STEP: READY ───────────────────────────────────────────────────── */}
      {step === 'ready' && (
        <View style={styles.centred}>
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
            {beatSource === 'ai' ? 'AI beat' : beatSource === 'jam' ? selectedJam?.name ?? 'Saved jam' : 'Your grid beat'} · {bpm} BPM
          </Text>
          <Text style={styles.readyInstructions}>
            3 piano blocks at the bottom{'\n'}Hit them with your foot when a tile lands{'\n'}3 misses = game over
          </Text>

          {/* Mini lane preview */}
          <View style={styles.lanePreview}>
            {Array.from({ length: LANE_COUNT }).map((_, i) => (
              <View key={i} style={[styles.lanePreviewBlock, { backgroundColor: LANE_PALETTE[i].dim, borderColor: LANE_PALETTE[i].base }]}>
                <Text style={[styles.lanePreviewLabel, { color: LANE_PALETTE[i].base }]}>{laneLabels[i]}</Text>
              </View>
            ))}
          </View>

          <Pressable onPress={startGame} style={styles.primaryBtn}>
            <LinearGradient
              colors={gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryBtnInner}
            >
              <Text style={styles.primaryBtnText}>Start!</Text>
            </LinearGradient>
          </Pressable>
          <Pressable onPress={() => setStep('source')} style={styles.ghostBtn}>
            <Text style={styles.ghostBtnText}>← Change beat</Text>
          </Pressable>
        </View>
      )}

      {/* ── STEP: PLAYING ─────────────────────────────────────────────────── */}
      {step === 'playing' && (
        <>
          {/* HUD */}
          <View style={styles.hud}>
            <HudItem label="COMBO" value={`${combo}x`} highlight={combo >= 5} />
            <HudItem label="BPM" value={String(bpm)} />
            <View style={styles.missHud}>
              <Text style={styles.hudLabel}>MISS</Text>
              <View style={styles.missRow}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={[styles.missDot, i < misses && styles.missDotFilled]} />
                ))}
              </View>
            </View>
          </View>

          {/* Lane guide lines */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {Array.from({ length: LANE_COUNT + 1 }).map((_, i) => (
              <View key={i} style={[styles.laneLine, { left: i * laneW }]} />
            ))}
          </View>

          {/* Hit zone line */}
          <View
            style={[styles.hitZoneLine, { top: hitZoneY }]}
            pointerEvents="none"
          >
            <LinearGradient
              colors={['transparent', 'rgba(255,255,255,0.08)', 'transparent']}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.hitZoneBar} />
          </View>

          {/* Falling tiles */}
          {tiles.filter((t) => !t.hit).map((t) => {
            const lp = LANE_PALETTE[t.lane];
            return (
              <Animated.View
                key={t.id}
                pointerEvents="none"
                style={[
                  styles.tile,
                  {
                    left: t.lane * laneW + 6,
                    width: laneW - 12,
                    transform: [{ translateY: t.y }],
                    backgroundColor: t.missed ? 'rgba(255,69,58,0.2)' : `${lp.base}22`,
                    borderColor: t.missed ? colors.accent : lp.base,
                  },
                ]}
              >
                <View style={[styles.tileTopGlow, { backgroundColor: lp.base }]} />
                <Text
                  style={[styles.tileLabel, { color: t.missed ? colors.accent : '#FFFFFF' }]}
                  numberOfLines={1}
                >
                  {t.missed ? '✕' : t.label}
                </Text>
              </Animated.View>
            );
          })}

          {/* Hit effect overlay per lane */}
          {hitEffect && (
            <View
              pointerEvents="none"
              style={[
                styles.hitEffect,
                {
                  left: hitEffect.lane * laneW,
                  width: laneW,
                  top: hitZoneY - 60,
                  backgroundColor: LANE_PALETTE[hitEffect.lane].glow,
                },
              ]}
            >
              <Text style={styles.hitLabel}>
                {hitEffect.type === 'perfect' ? 'PERFECT!' : hitEffect.type === 'good' ? 'GOOD' : 'OK'}
              </Text>
            </View>
          )}

          {/* ── 3 PIANO BLOCKS ──────────────────────────────────────────── */}
          <View style={[styles.pianoRow, { top: pianoTop, height: PIANO_H + insets.bottom }]}>
            {Array.from({ length: LANE_COUNT }).map((_, i) => {
              const lp = LANE_PALETTE[i];
              const isPressed = pressedLane === i;
              return (
                <Pressable
                  key={i}
                  onPressIn={() => {
                    setPressedLane(i);
                    handlePianoPress(i);
                  }}
                  onPressOut={() => setPressedLane(null)}
                  style={[
                    styles.pianoBlock,
                    {
                      borderColor: isPressed ? lp.base : `${lp.base}55`,
                      backgroundColor: isPressed ? `${lp.base}30` : `${lp.base}0D`,
                    },
                  ]}
                >
                  {/* Top edge glow */}
                  <View style={[styles.pianoTopEdge, { backgroundColor: lp.base, opacity: isPressed ? 1 : 0.4 }]} />
                  <View style={styles.pianoContent}>
                    <View style={[styles.pianoCircle, { borderColor: lp.base, backgroundColor: isPressed ? `${lp.base}40` : 'transparent' }]}>
                      <Text style={[styles.pianoNum, { color: lp.base }]}>{i + 1}</Text>
                    </View>
                    <Text style={[styles.pianoLabel, { color: isPressed ? '#FFFFFF' : lp.base }]} numberOfLines={2}>
                      {laneLabels[i]}
                    </Text>
                    <Text style={[styles.pianoHint, { color: `${lp.base}80` }]}>TAP / FOOT</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {/* ── STEP: GAME OVER ───────────────────────────────────────────────── */}
      {step === 'over' && (
        <ScrollView
          contentContainerStyle={[styles.centred, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.overTitle}>
            {score > 500 ? '🔥 Insane!' : score > 200 ? '🎵 Nice!' : '💀 Game Over'}
          </Text>
          <Text style={styles.overSub}>{playerName || 'Player'}</Text>

          <View style={styles.overStats}>
            <StatBadge label="Score" value={String(score)} color={colors.vibe} />
            <StatBadge label="Best Combo" value={`${maxCombo}x`} color={colors.warn} />
            <StatBadge label="Misses" value={String(misses)} color={colors.accent} />
          </View>

          {leaderboard.length > 0 && (
            <View style={styles.leaderboard}>
              <Text style={styles.lbTitle}>🏆 LEADERBOARD</Text>
              {leaderboard.map((e, i) => {
                const isMe = e.name === (playerName || 'Anonymous') && e.score === score;
                return (
                  <View key={i} style={[styles.lbRow, isMe && styles.lbRowMe]}>
                    <Text style={[styles.lbRank, i === 0 && { color: colors.warn }]}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                    </Text>
                    <Text style={[styles.lbName, isMe && { color: colors.vibe }]} numberOfLines={1}>
                      {e.name}
                    </Text>
                    <Text style={styles.lbScore}>{e.score}</Text>
                    <Text style={styles.lbCombo}>{e.combo}x</Text>
                  </View>
                );
              })}
            </View>
          )}

          <View style={styles.overButtons}>
            <Pressable onPress={startGame} style={styles.primaryBtn}>
              <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryBtnInner}>
                <Text style={styles.primaryBtnText}>Play Again</Text>
              </LinearGradient>
            </Pressable>
            <Pressable onPress={() => setStep('source')} style={styles.ghostBtn}>
              <Text style={styles.ghostBtnText}>Change Beat</Text>
            </Pressable>
            <Pressable onPress={onBack} style={styles.ghostBtn}>
              <Text style={styles.ghostBtnText}>Back to Studio</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function HudItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.hudItem}>
      <Text style={styles.hudLabel}>{label}</Text>
      <Text style={[styles.hudValue, highlight && { color: colors.warn }]}>{value}</Text>
    </View>
  );
}

function StatBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.statBadge}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#060609' },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, zIndex: 20,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: spacing.md },
  backChevron: { fontSize: 22, fontWeight: '300', color: colors.vibe, marginTop: -1 },
  backText: { ...type.body, color: colors.vibe },
  screenTitle: { ...type.title, color: colors.text },
  scoreWrap: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.pill,
    backgroundColor: 'rgba(255,214,10,0.12)', borderWidth: 1, borderColor: 'rgba(255,214,10,0.2)',
  },
  scoreNum: { ...type.label, fontSize: 16, color: colors.warn, fontVariant: ['tabular-nums'] },
  arBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: spacing.sm },
  arDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textFaint },
  arDotOn: { backgroundColor: colors.live },
  arBtnText: { ...type.caption, color: colors.textDim, letterSpacing: 1 },

  // ── Shared layout ─────────────────────────────────────────────────────────
  centred: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: spacing.md, paddingHorizontal: spacing.xl,
  },
  card: {
    width: '100%', alignItems: 'center', gap: spacing.md,
    padding: spacing.xl, borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: 'rgba(10,10,16,0.92)',
  },
  cardIcon: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
  },
  cardIconText: { fontSize: 30 },
  cardTitle: { ...type.title, fontSize: 22, color: colors.text },
  cardSub: { ...type.body, color: colors.textDim, textAlign: 'center' },

  // ── Name input ────────────────────────────────────────────────────────────
  nameInput: {
    width: '100%', height: 54, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.vibe,
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: spacing.lg, ...type.body, color: colors.text,
    fontSize: 19, textAlign: 'center', marginTop: spacing.sm,
  },

  // ── Buttons ───────────────────────────────────────────────────────────────
  primaryBtn: { width: '100%', marginTop: spacing.sm },
  primaryBtnInner: {
    paddingVertical: spacing.lg, borderRadius: radius.pill, alignItems: 'center',
  },
  primaryBtnText: { ...type.label, fontSize: 17, color: '#FFFFFF', letterSpacing: 0.5 },
  ghostBtn: { paddingVertical: spacing.sm },
  ghostBtnText: { ...type.body, color: colors.textDim },

  // ── Source picker ─────────────────────────────────────────────────────────
  setupTitle: { ...type.display, fontSize: 26, color: colors.text, textAlign: 'center' },
  setupSub: { ...type.body, color: colors.textDim, textAlign: 'center', marginBottom: spacing.sm },
  sourceCard: {
    width: '100%', flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg, borderRadius: radius.xl, borderWidth: 1,
    borderColor: colors.border, backgroundColor: 'rgba(255,255,255,0.03)',
  },
  sourceCardActive: {
    borderColor: colors.vibe, backgroundColor: 'rgba(10,132,255,0.08)',
  },
  sourceIcon: {
    width: 52, height: 52, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center',
  },
  sourceIconText: { fontSize: 22, color: '#FFFFFF' },
  sourceInfo: { flex: 1, gap: 3 },
  sourceTitle: { ...type.label, color: colors.text, fontSize: 15 },
  sourceSub: { ...type.caption, color: colors.textDim },
  selectedDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: colors.vibe,
  },
  jamSectionLabel: {
    ...type.caption, letterSpacing: 2, color: colors.textFaint,
    alignSelf: 'flex-start', marginTop: spacing.md,
  },
  loadingText: { ...type.caption, color: colors.textDim },

  // ── Ready screen ──────────────────────────────────────────────────────────
  readyIcon: {
    width: 88, height: 88, borderRadius: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  readyGlyph: { fontSize: 40, color: '#FFFFFF' },
  readyTitle: { ...type.display, fontSize: 28, color: colors.text, textAlign: 'center' },
  readySub: { ...type.body, color: colors.textDim },
  readyInstructions: {
    ...type.body, color: colors.textDim, textAlign: 'center', lineHeight: 24,
    paddingHorizontal: spacing.md,
  },
  lanePreview: {
    flexDirection: 'row', width: '100%', gap: spacing.sm, marginVertical: spacing.sm,
  },
  lanePreviewBlock: {
    flex: 1, height: 56, borderRadius: radius.md, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  lanePreviewLabel: { ...type.caption, fontWeight: '700', fontSize: 11 },

  // ── HUD ───────────────────────────────────────────────────────────────────
  hud: {
    flexDirection: 'row', justifyContent: 'center', gap: spacing.xxl,
    paddingVertical: spacing.md, zIndex: 10,
  },
  hudItem: { alignItems: 'center', gap: 4 },
  hudLabel: { ...type.caption, fontSize: 9, letterSpacing: 2, color: colors.textFaint },
  hudValue: { ...type.title, fontSize: 20, color: colors.text, fontVariant: ['tabular-nums'] },
  missHud: { alignItems: 'center', gap: 4 },
  missRow: { flexDirection: 'row', gap: 6 },
  missDot: {
    width: 12, height: 12, borderRadius: 6,
    borderWidth: 2, borderColor: 'rgba(255,69,58,0.3)',
  },
  missDotFilled: { backgroundColor: colors.accent, borderColor: colors.accent },

  // ── Lane guide ────────────────────────────────────────────────────────────
  laneLine: {
    position: 'absolute', top: 0, bottom: 0, width: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  hitZoneLine: {
    position: 'absolute', left: 0, right: 0, height: 40, zIndex: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  hitZoneBar: {
    height: 2, alignSelf: 'stretch',
    marginHorizontal: spacing.sm,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },

  // ── Tiles ─────────────────────────────────────────────────────────────────
  tile: {
    position: 'absolute', height: TILE_H,
    borderRadius: radius.lg, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 5, overflow: 'hidden',
  },
  tileTopGlow: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 3, opacity: 0.9,
  },
  tileLabel: {
    ...type.label, fontSize: 14, color: '#FFFFFF',
    textTransform: 'uppercase', letterSpacing: 1,
  },
  hitEffect: {
    position: 'absolute', height: 90, zIndex: 8,
    borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
  },
  hitLabel: {
    ...type.label, fontSize: 16, color: '#FFFFFF',
    letterSpacing: 2, fontWeight: '900',
  },

  // ── 3 PIANO BLOCKS ────────────────────────────────────────────────────────
  pianoRow: {
    position: 'absolute', left: 0, right: 0,
    flexDirection: 'row', zIndex: 15,
  },
  pianoBlock: {
    flex: 1,
    borderTopWidth: 2,
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderBottomWidth: 0,
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  pianoTopEdge: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: 1.5,
  },
  pianoContent: {
    alignItems: 'center', gap: spacing.sm, flex: 1, justifyContent: 'center',
  },
  pianoCircle: {
    width: 56, height: 56, borderRadius: 28,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
  pianoNum: { ...type.title, fontSize: 20, fontWeight: '900' },
  pianoLabel: {
    ...type.label, fontSize: 13, textAlign: 'center',
    maxWidth: 90, fontWeight: '700',
  },
  pianoHint: {
    ...type.caption, fontSize: 9, letterSpacing: 2, marginTop: 2,
  },

  // ── Game over ─────────────────────────────────────────────────────────────
  overTitle: { ...type.display, fontSize: 32, color: colors.text, textAlign: 'center' },
  overSub: { ...type.body, color: colors.textDim },
  overStats: { flexDirection: 'row', gap: spacing.sm },
  overButtons: { gap: spacing.md, alignItems: 'center', width: '100%' },

  leaderboard: {
    width: '100%', borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, backgroundColor: 'rgba(10,10,16,0.9)',
    padding: spacing.lg, gap: spacing.sm,
  },
  lbTitle: { ...type.caption, letterSpacing: 2, color: colors.warn, marginBottom: spacing.xs },
  lbRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 4 },
  lbRowMe: {
    backgroundColor: 'rgba(10,132,255,0.1)',
    borderRadius: radius.sm, paddingHorizontal: spacing.sm,
  },
  lbRank: { ...type.caption, color: colors.textFaint, width: 28, textAlign: 'center' },
  lbName: { ...type.label, color: colors.text, flex: 1, fontSize: 13 },
  lbScore: { ...type.label, color: colors.warn, fontSize: 14, fontVariant: ['tabular-nums'] },
  lbCombo: { ...type.caption, color: colors.textDim, width: 32, textAlign: 'right' },

  statBadge: {
    alignItems: 'center', gap: 4, paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg, borderRadius: radius.lg,
    backgroundColor: colors.surfaceSolid, borderWidth: 1,
    borderColor: colors.border, minWidth: 90,
  },
  statValue: { ...type.title, fontSize: 24, fontVariant: ['tabular-nums'] },
  statLabel: { ...type.caption, color: colors.textDim },
});
