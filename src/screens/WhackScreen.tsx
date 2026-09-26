import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useCameraPermission } from 'react-native-vision-camera';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system';
import { useSession } from '@/state/sessionStore';
import { gridHitCount, gridRows, stepBeats } from '@/audio/beatGrid';
import { FootCamera } from '@/components/FootCamera';
import type { FootReading, FootSignature } from '@/vision/footTracker';
import {
  CELL_COUNT,
  GRID_COLS,
  WhackDetector,
  activeMoles,
  collectMisses,
  moleRise,
  roundComplete,
  spawnPlan,
  whack,
  type BeatHit,
  type Judgement,
  type Mole,
} from '@/game/moleEngine';
import { colors, radius, spacing, type } from '@/theme';
import { gradients } from '@/theme/gradients';

interface Props {
  onBack: () => void;
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/** Misses allowed before the round ends. */
const MAX_MISSES = 5;
/** How many times the loop repeats in one round. */
const REPEATS = 4;

const LEADERBOARD_PATH = `${FileSystem.documentDirectory}worldjam-whack-scores.json`;

interface ScoreEntry {
  name: string;
  score: number;
  combo: number;
  date: string;
}

async function loadScores(): Promise<ScoreEntry[]> {
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(LEADERBOARD_PATH));
  } catch {
    return [];
  }
}

async function saveScores(entries: ScoreEntry[]): Promise<void> {
  const top = [...entries].sort((a, b) => b.score - a.score).slice(0, 10);
  await FileSystem.writeAsStringAsync(LEADERBOARD_PATH, JSON.stringify(top));
}

/** One colour per column, so a sound's position is learnable at a glance. */
const COLUMN_COLOURS = ['#0A84FF', '#30D158', '#BF5AF2'];

type Step = 'calibrate' | 'ready' | 'playing' | 'over';

export function WhackScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();

  const objects = useSession((s) => s.objects);
  const grid = useSession((s) => s.grid);
  const bpm = useSession((s) => s.bpm);
  const bars = useSession((s) => s.bars);
  const plan = useSession((s) => s.plan);
  const playObject = useSession((s) => s.playObject);

  /*
   * VisionCamera keeps its own permission record, separate from the one
   * expo-camera asks for at launch. Without this the preview mounts into a
   * black rectangle with no error, because FootCamera renders its fallback.
   */
  const { hasPermission, requestPermission } = useCameraPermission();

  useEffect(() => {
    if (hasPermission) return;
    // On a tick: asking during mount can run before the Activity is attached.
    const id = setTimeout(() => {
      void requestPermission().catch(() => {});
    }, 0);
    return () => clearTimeout(id);
  }, [hasPermission, requestPermission]);

  const [step, setStep] = useState<Step>('calibrate');
  const [signature, setSignature] = useState<FootSignature | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [reading, setReading] = useState<FootReading | null>(null);

  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [misses, setMisses] = useState(0);
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [flash, setFlash] = useState<{ cell: number; judgement: Judgement } | null>(null);

  /** The round, mutated in place by the frame loop. */
  const molesRef = useRef<Mole[]>([]);
  /** Bumped once per frame so React repaints the moles. */
  const [, tick] = useState(0);

  const rafRef = useRef<number | null>(null);
  const detector = useMemo(() => new WhackDetector(), []);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const missRef = useRef(0);
  const overRef = useRef(false);
  /** Read by the frame loop, which must not close over stale state. */
  const readingRef = useRef<FootReading | null>(null);

  useEffect(() => {
    void loadScores().then(setScores);
  }, []);

  // ── The beat ──────────────────────────────────────────────────────────────

  /**
   * Flattens whatever the studio has into a flat list of hits.
   *
   * Prefers the player's own programmed grid, falls back to the AI plan, and
   * finally invents a groove — the game must never open with nothing to do.
   */
  const beatHits = useMemo((): BeatHit[] => {
    const out: BeatHit[] = [];

    if (gridHitCount(grid) > 0 && objects.length > 0) {
      const rows = gridRows(grid, objects);
      const unit = stepBeats(grid.steps);
      for (const { object, row } of rows) {
        row.forEach((on, s) => {
          if (!on) return;
          out.push({
            objectId: object.id,
            label: object.label,
            beatTime: s * unit,
          });
        });
      }
    } else if (plan) {
      for (const entry of plan.objectPattern) {
        const obj = objects.find(
          (o) => o.label.toLowerCase() === entry.object.toLowerCase(),
        );
        for (const b of entry.beats) {
          out.push({
            objectId: obj?.id ?? '',
            label: entry.object,
            beatTime: b - 1,
          });
        }
      }
    }

    if (out.length === 0) {
      for (let b = 0; b < 8; b++) {
        const obj = objects[b % Math.max(1, objects.length)];
        out.push({
          objectId: obj?.id ?? '',
          label: obj?.label ?? `Beat ${b + 1}`,
          beatTime: b,
        });
      }
    }

    return out.sort((a, b) => a.beatTime - b.beatTime);
  }, [grid, objects, plan]);

  const loopBeats = useMemo(() => {
    const last = beatHits.length ? beatHits[beatHits.length - 1].beatTime : 0;
    // Round up to whole bars so repeats land on a downbeat.
    return Math.max(4, Math.ceil((last + 1) / 4) * 4, bars * 4 > 32 ? 16 : bars * 4);
  }, [beatHits, bars]);

  const objectOrder = useMemo(() => objects.map((o) => o.id), [objects]);

  // ── The round ─────────────────────────────────────────────────────────────

  const finish = useCallback(async () => {
    if (overRef.current) return;
    overRef.current = true;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setStep('over');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});

    const entry: ScoreEntry = {
      name: 'You',
      score: scoreRef.current,
      combo: maxComboRef.current,
      date: new Date().toLocaleDateString(),
    };
    const updated = [...(await loadScores()), entry]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    await saveScores(updated);
    setScores(updated);
  }, []);

  /**
   * One frame: resolve any strike, retire anything missed, repaint.
   *
   * The hand is read here rather than in a callback so a strike is always
   * judged against the same clock reading that drew the moles.
   */
  const frame = useCallback(() => {
    if (overRef.current) return;
    const now = performance.now();
    const moles = molesRef.current;

    const r = readingRef.current;
    if (r) {
      const cell = detector.push(r, now);
      if (cell != null) {
        const result = whack(moles, cell, now, comboRef.current);

        if (result) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          const obj = objects.find((o) => o.id === result.mole.objectId);
          if (obj) playObject(obj.id);

          scoreRef.current += result.points;
          comboRef.current += 1;
          if (comboRef.current > maxComboRef.current) {
            maxComboRef.current = comboRef.current;
            setMaxCombo(comboRef.current);
          }
          setScore(scoreRef.current);
          setCombo(comboRef.current);
          setFlash({ cell, judgement: result.judgement });
          setTimeout(() => setFlash(null), 300);
        } else {
          // A swing at nothing still sounds, so the room answers the hand.
          const obj = objects[cell % Math.max(1, objects.length)];
          if (obj) playObject(obj.id);
        }
      }
    }

    const missed = collectMisses(moles, now);
    if (missed > 0) {
      missRef.current += missed;
      comboRef.current = 0;
      setMisses(missRef.current);
      setCombo(0);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      if (missRef.current >= MAX_MISSES) {
        void finish();
        return;
      }
    }

    if (roundComplete(moles, now)) {
      void finish();
      return;
    }

    tick((n) => n + 1);
    rafRef.current = requestAnimationFrame(frame);
  }, [detector, finish, objects, playObject]);

  const start = useCallback(() => {
    scoreRef.current = 0;
    comboRef.current = 0;
    maxComboRef.current = 0;
    missRef.current = 0;
    overRef.current = false;
    detector.reset();
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setMisses(0);
    setFlash(null);

    // Start one loop-length out, so the first mole is not already overdue.
    const lead = (60000 / bpm) * 2;
    molesRef.current = spawnPlan(
      beatHits,
      bpm,
      loopBeats,
      REPEATS,
      performance.now() + lead,
      objectOrder,
    );

    setStep('playing');
    rafRef.current = requestAnimationFrame(frame);
  }, [beatHits, bpm, loopBeats, objectOrder, detector, frame]);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const onReading = useCallback((r: FootReading) => {
    readingRef.current = r;
    setReading(r);
  }, []);

  const onCalibrated = useCallback((sig: FootSignature) => {
    setCapturing(false);
    setSignature(sig);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, []);

  // ── Layout ────────────────────────────────────────────────────────────────

  const boardTop = insets.top + 96;
  const boardH = SCREEN_H - boardTop - insets.bottom - 40;
  const cellW = SCREEN_W / GRID_COLS;
  const cellH = boardH / 3;

  const now = performance.now();
  const live = step === 'playing' ? activeMoles(molesRef.current, now) : [];

  /** Where the hand is seen, for the cursor. */
  const handCell =
    reading && reading.x != null && reading.y != null && reading.coverage >= 0.03
      ? { x: reading.x, y: reading.y, strong: reading.coverage >= 0.05 }
      : null;

  return (
    <View style={styles.root}>
      <FootCamera
        signature={signature}
        capturing={capturing}
        onCalibrated={onCalibrated}
        onReading={onReading}
      />
      <LinearGradient
        colors={
          step === 'calibrate'
            ? ['rgba(2,2,6,0.3)', 'rgba(2,2,6,0.06)', 'rgba(2,2,6,0.45)']
            : ['rgba(2,2,6,0.62)', 'rgba(2,2,6,0.3)', 'rgba(2,2,6,0.72)']
        }
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={onBack} style={styles.back} accessibilityRole="button">
          <Text style={styles.backChevron}>‹</Text>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Whack</Text>
        {step === 'playing' ? (
          <View style={styles.scorePill}>
            <Text style={styles.scoreNum}>{score}</Text>
          </View>
        ) : (
          <View style={styles.back} />
        )}
      </View>

      {/* ── calibrate ─────────────────────────────────────────────────────── */}
      {step === 'calibrate' && (
        <View style={styles.centre}>
          <Text style={styles.bigTitle}>
            {signature ? 'Move your hand around' : 'Point at your hand'}
          </Text>
          <Text style={styles.body}>
            {signature
              ? 'The ring should follow it. Check every cell lights up, then start.'
              : 'Fill the square with your hand — or a glove, or anything you want to hit with — then tap Capture.'}
          </Text>

          <View style={styles.reticle}>
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />
          </View>

          {/* A live 3x3 so calibration quality is obvious before committing. */}
          <View style={styles.calGrid}>
            {Array.from({ length: CELL_COUNT }).map((_, i) => {
              const lit =
                signature != null &&
                handCell != null &&
                handCell.strong &&
                Math.floor(handCell.y * 3) * GRID_COLS +
                  Math.floor(handCell.x * GRID_COLS) ===
                  i;
              const colour = COLUMN_COLOURS[i % GRID_COLS];
              return (
                <View
                  key={i}
                  style={[
                    styles.calCell,
                    {
                      borderColor: lit ? colour : `${colour}40`,
                      backgroundColor: lit ? `${colour}55` : 'transparent',
                    },
                  ]}
                />
              );
            })}
          </View>

          <Pressable
            onPress={() => {
              setCapturing(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            }}
            style={styles.primaryBtn}
          >
            <LinearGradient
              colors={gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryInner}
            >
              <Text style={styles.primaryText}>
                {signature ? 'Recapture' : 'Capture'}
              </Text>
            </LinearGradient>
          </Pressable>

          {signature && (
            <Pressable onPress={() => setStep('ready')} style={styles.ghost}>
              <Text style={styles.ghostText}>Looks good →</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* ── ready ─────────────────────────────────────────────────────────── */}
      {step === 'ready' && (
        <View style={styles.centre}>
          <Text style={styles.bigTitle}>Ready?</Text>
          <Text style={styles.body}>
            Targets pop out of a 3×3 grid in front of you.{'\n'}
            Hit each one with your hand as it peaks.{'\n'}
            {MAX_MISSES} misses and the round ends.
          </Text>
          <Text style={styles.meta}>
            {bpm} BPM · {beatHits.length} hits per loop · {REPEATS} loops
          </Text>
          <Pressable onPress={start} style={styles.primaryBtn}>
            <LinearGradient
              colors={gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryInner}
            >
              <Text style={styles.primaryText}>Start</Text>
            </LinearGradient>
          </Pressable>
          <Pressable onPress={() => setStep('calibrate')} style={styles.ghost}>
            <Text style={styles.ghostText}>Recalibrate</Text>
          </Pressable>
        </View>
      )}

      {/* ── playing ───────────────────────────────────────────────────────── */}
      {step === 'playing' && (
        <>
          <View style={styles.hud}>
            <Hud label="COMBO" value={`${combo}x`} warn={combo >= 5} />
            <Hud label="BPM" value={String(bpm)} />
            <Hud label="MISS" value={`${misses}/${MAX_MISSES}`} warn={misses >= 3} />
          </View>

          {/* The board. Holes are always drawn; moles rise out of them. */}
          <View
            style={[styles.board, { top: boardTop, height: boardH }]}
            pointerEvents="none"
          >
            {Array.from({ length: CELL_COUNT }).map((_, i) => {
              const colour = COLUMN_COLOURS[i % GRID_COLS];
              const mole = live.find((m) => m.cell === i);
              const rise = mole ? moleRise(mole, now) : 0;
              const isFlash = flash?.cell === i;

              return (
                <View key={i} style={[styles.cell, { width: cellW, height: cellH }]}>
                  <View style={[styles.hole, { borderColor: `${colour}33` }]} />

                  {mole && (
                    <View
                      style={[
                        styles.mole,
                        {
                          borderColor: colour,
                          backgroundColor: `${colour}${rise > 0.6 ? 'DD' : '88'}`,
                          transform: [{ scale: 0.45 + rise * 0.55 }],
                          opacity: 0.35 + rise * 0.65,
                        },
                      ]}
                    >
                      <Text style={styles.moleLabel} numberOfLines={1}>
                        {mole.label}
                      </Text>
                    </View>
                  )}

                  {isFlash && (
                    <Text
                      style={[
                        styles.judgement,
                        {
                          color:
                            flash.judgement === 'PERFECT'
                              ? colors.warn
                              : flash.judgement === 'GOOD'
                                ? colors.live
                                : colors.textDim,
                        },
                      ]}
                    >
                      {flash.judgement}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>

          {/* Where the tracker sees the hand. */}
          {handCell && (
            <View
              pointerEvents="none"
              style={[
                styles.cursor,
                {
                  left: handCell.x * SCREEN_W - 30,
                  top: boardTop + handCell.y * boardH - 30,
                  borderColor: handCell.strong ? '#FFFFFF' : 'rgba(255,255,255,0.4)',
                  transform: [{ scale: handCell.strong ? 1.1 : 0.9 }],
                },
              ]}
            />
          )}
        </>
      )}

      {/* ── over ──────────────────────────────────────────────────────────── */}
      {step === 'over' && (
        <ScrollView
          contentContainerStyle={[styles.centre, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.bigTitle}>
            {score > 600 ? '🔥 Monster' : score > 250 ? '🎯 Sharp' : '💀 Round over'}
          </Text>

          <View style={styles.stats}>
            <Stat label="Score" value={String(score)} colour={colors.vibe} />
            <Stat label="Best combo" value={`${maxCombo}x`} colour={colors.warn} />
            <Stat label="Misses" value={String(misses)} colour={colors.accent} />
          </View>

          {scores.length > 0 && (
            <View style={styles.boardList}>
              <Text style={styles.boardTitle}>🏆 BEST</Text>
              {scores.slice(0, 5).map((e, i) => (
                <View key={i} style={styles.boardRow}>
                  <Text style={styles.boardRank}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                  </Text>
                  <Text style={styles.boardName}>{e.date}</Text>
                  <Text style={styles.boardScore}>{e.score}</Text>
                </View>
              ))}
            </View>
          )}

          <Pressable onPress={start} style={styles.primaryBtn}>
            <LinearGradient
              colors={gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryInner}
            >
              <Text style={styles.primaryText}>Again</Text>
            </LinearGradient>
          </Pressable>
          <Pressable onPress={onBack} style={styles.ghost}>
            <Text style={styles.ghostText}>Back to studio</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

function Hud({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.hudItem}>
      <Text style={styles.hudLabel}>{label}</Text>
      <Text style={[styles.hudValue, warn && { color: colors.warn }]}>{value}</Text>
    </View>
  );
}

function Stat({ label, value, colour }: { label: string; value: string; colour: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: colour }]}>{value}</Text>
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
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 72 },
  backChevron: { fontSize: 22, fontWeight: '300', color: colors.vibe, marginTop: -1 },
  backText: { ...type.body, color: colors.vibe },
  title: { ...type.title, color: colors.text },
  scorePill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,214,10,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,214,10,0.2)',
  },
  scoreNum: { ...type.label, fontSize: 16, color: colors.warn, fontVariant: ['tabular-nums'] },

  centre: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  bigTitle: { ...type.display, fontSize: 27, color: '#FFFFFF', textAlign: 'center' },
  body: {
    ...type.body,
    color: '#FFFFFF',
    opacity: 0.85,
    textAlign: 'center',
    lineHeight: 23,
  },
  meta: { ...type.caption, color: colors.textDim },

  reticle: { width: 170, height: 170 },
  corner: { position: 'absolute', width: 40, height: 40, borderColor: colors.vibe },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 8 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 8 },
  bl: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 8,
  },
  br: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 8,
  },

  calGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
  },
  /*
   * An explicit height, not an aspect ratio. Inside a wrapping row whose
   * parent has no fixed height, `aspectRatio` resolves against a zero
   * height and the cells collapse into lines.
   */
  calCell: {
    width: '31%',
    height: 44,
    borderRadius: radius.md,
    borderWidth: 2,
  },

  primaryBtn: { width: '100%', marginTop: spacing.sm },
  primaryInner: { paddingVertical: spacing.lg, borderRadius: radius.pill, alignItems: 'center' },
  primaryText: { ...type.label, fontSize: 17, color: '#FFFFFF' },
  ghost: { paddingVertical: spacing.sm },
  ghostText: { ...type.body, color: colors.textDim },

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

  board: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    zIndex: 10,
  },
  cell: { alignItems: 'center', justifyContent: 'center' },
  hole: {
    position: 'absolute',
    width: '62%',
    height: '46%',
    borderRadius: 999,
    borderWidth: 2,
    borderStyle: 'dashed',
  },
  mole: {
    width: '58%',
    aspectRatio: 1,
    maxHeight: '78%',
    borderRadius: 999,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moleLabel: {
    ...type.label,
    fontSize: 12,
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 4,
  },
  judgement: {
    position: 'absolute',
    ...type.label,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.5,
  },

  cursor: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 3,
    zIndex: 25,
  },

  stats: { flexDirection: 'row', gap: spacing.sm },
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

  boardList: {
    width: '100%',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(8,8,14,0.92)',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  boardTitle: { ...type.caption, letterSpacing: 2, color: colors.warn },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  boardRank: { ...type.caption, color: colors.textFaint, width: 28, textAlign: 'center' },
  boardName: { ...type.label, color: colors.text, flex: 1, fontSize: 13 },
  boardScore: { ...type.label, color: colors.warn, fontSize: 14, fontVariant: ['tabular-nums'] },
});
