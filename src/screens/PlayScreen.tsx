import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSession } from '@/state/sessionStore';
import { gridRows, gridHitCount, stepBeats } from '@/audio/beatGrid';
import { colors, radius, spacing, type } from '@/theme';
import { gradients } from '@/theme/gradients';

interface Props {
  onBack: () => void;
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const LANE_COUNT = 3;
const TILE_H = 72;
const HIT_TOLERANCE = 110;

interface BeatHit {
  objectId: string;
  label: string;
  color: string;
  step: number;
  bar: number;
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
  held: boolean;
}

export function PlayScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const objects = useSession((s) => s.objects);
  const grid = useSession((s) => s.grid);
  const bpm = useSession((s) => s.bpm);
  const bars = useSession((s) => s.bars);
  const playObject = useSession((s) => s.playObject);

  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [misses, setMisses] = useState(0);
  const [gameState, setGameState] = useState<'idle' | 'playing' | 'over'>('idle');
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [hitFlash, setHitFlash] = useState<{ lane: number; color: string } | null>(null);
  const tileId = useRef(0);
  const spawnIndex = useRef(0);
  const spawnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameStart = useRef(0);

  const hitZoneY = SCREEN_H - insets.bottom - 200;
  const laneW = (SCREEN_W - spacing.md * 2) / LANE_COUNT;

  const fallDuration = useMemo(() => {
    const beatMs = 60000 / bpm;
    return beatMs * 4;
  }, [bpm]);

  const beatSequence = useMemo((): BeatHit[] => {
    if (gridHitCount(grid) === 0 || objects.length === 0) return [];

    const hits: BeatHit[] = [];
    const rows = gridRows(grid, objects);
    const unit = stepBeats(grid.steps);

    for (let bar = 0; bar < bars; bar++) {
      for (const { object, row } of rows) {
        row.forEach((on, step) => {
          if (!on) return;
          const beatTime = bar * 4 + step * unit;
          hits.push({
            objectId: object.id,
            label: object.label,
            color: object.color,
            step,
            bar,
            beatTime,
          });
        });
      }
    }

    hits.sort((a, b) => a.beatTime - b.beatTime);
    return hits;
  }, [grid, objects, bars]);

  const assignLane = useCallback(
    (hit: BeatHit, idx: number): number => {
      const objIdx = objects.findIndex((o) => o.id === hit.objectId);
      if (objIdx >= 0) return objIdx % LANE_COUNT;
      return idx % LANE_COUNT;
    },
    [objects],
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
    const lane = assignLane(hit, idx);
    const now = Date.now();
    const spawnedAt = now;
    const timeUntilTarget = targetMs - now;
    const animDuration = timeUntilTarget + (hitZoneY / SCREEN_H) * fallDuration;

    const tile: Tile = {
      id,
      lane,
      label: hit.label,
      color: hit.color,
      y,
      spawnedAt,
      targetMs,
      hit: false,
      missed: false,
      held: false,
    };

    setTiles((prev) => [...prev, tile]);

    Animated.timing(y, {
      toValue: SCREEN_H + TILE_H,
      duration: Math.max(animDuration, 500),
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(() => {
      setTiles((prev) => {
        const t = prev.find((x) => x.id === id);
        if (t && !t.hit && !t.missed) {
          t.missed = true;
          setMisses((m) => m + 1);
          setCombo(0);
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

    spawnTimer.current = setTimeout(spawnNextTile, Math.max(delay - fallDuration * 0.7, 50));
  }, [beatSequence, bpm, bars, assignLane, fallDuration, hitZoneY]);

  const startGame = useCallback(() => {
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setMisses(0);
    setTiles([]);
    setGameState('playing');
    tileId.current = 0;
    spawnIndex.current = 0;
    gameStart.current = Date.now() + fallDuration;

    if (beatSequence.length > 0) {
      setTimeout(spawnNextTile, 100);
    } else {
      const interval = Math.max(350, 60000 / (bpm * 2));
      const fallback = () => {
        const labels = objects.length > 0
          ? objects
          : [{ id: '', label: 'Tap', color: colors.vibe }, { id: '', label: 'Beat', color: colors.ai }, { id: '', label: 'Drop', color: colors.live }];
        const pick = labels[tileId.current % labels.length];
        const lane = tileId.current % LANE_COUNT;
        const y = new Animated.Value(-TILE_H);
        const id = tileId.current++;

        const tile: Tile = {
          id, lane,
          label: 'label' in pick ? pick.label : 'Tap',
          color: 'color' in pick ? pick.color : colors.vibe,
          y, spawnedAt: Date.now(), targetMs: Date.now() + fallDuration,
          hit: false, missed: false, held: false,
        };
        setTiles((prev) => [...prev, tile]);
        Animated.timing(y, {
          toValue: SCREEN_H + TILE_H,
          duration: fallDuration * 1.5,
          easing: Easing.linear,
          useNativeDriver: true,
        }).start(() => {
          setTiles((prev) => {
            const t = prev.find((x) => x.id === id);
            if (t && !t.hit && !t.missed) {
              t.missed = true;
              setMisses((m) => m + 1);
              setCombo(0);
            }
            return prev.filter((x) => x.id !== id);
          });
        });

        spawnTimer.current = setTimeout(fallback, interval);
      };
      spawnTimer.current = setTimeout(fallback, 500);
    }
  }, [bpm, beatSequence, objects, fallDuration, spawnNextTile]);

  useEffect(() => {
    if (misses >= 3 && gameState === 'playing') {
      if (spawnTimer.current) clearTimeout(spawnTimer.current);
      setGameState('over');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }, [misses, gameState]);

  useEffect(() => {
    return () => {
      if (spawnTimer.current) clearTimeout(spawnTimer.current);
    };
  }, []);

  const getTileScreenY = useCallback(
    (tile: Tile) => {
      const elapsed = Date.now() - tile.spawnedAt;
      const total = (tile.targetMs - tile.spawnedAt) + (hitZoneY / SCREEN_H) * fallDuration;
      return -TILE_H + ((SCREEN_H + TILE_H * 2) * elapsed) / Math.max(total, 1);
    },
    [fallDuration, hitZoneY],
  );

  const handleLaneTap = useCallback(
    (lane: number) => {
      if (gameState !== 'playing') return;

      const now = Date.now();
      let bestTile: Tile | null = null;
      let bestDist = Infinity;

      setTiles((prev) => {
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
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

          const obj = objects.find((o) => o.label === bestTile!.label);
          if (obj) playObject(obj.id);

          setHitFlash({ lane, color: bestTile.color });
          setTimeout(() => setHitFlash(null), 150);

          const points = bestDist < 40 ? 20 : bestDist < 70 ? 15 : 10;
          setScore((s) => s + points * (combo + 1));
          setCombo((c) => {
            const next = c + 1;
            setMaxCombo((m) => Math.max(m, next));
            return next;
          });
        }

        return prev;
      });
    },
    [combo, gameState, getTileScreenY, hitZoneY, objects, playObject],
  );

  const handleLaneLongPress = useCallback(
    (lane: number) => {
      if (gameState !== 'playing') return;

      setTiles((prev) => {
        for (const t of prev) {
          if (t.lane !== lane || t.hit || t.missed) continue;
          const tileY = getTileScreenY(t);
          if (Math.abs(tileY - hitZoneY) < HIT_TOLERANCE * 1.5) {
            t.hit = true;
            t.held = true;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});

            const obj = objects.find((o) => o.label === t.label);
            if (obj) playObject(obj.id);

            setHitFlash({ lane, color: t.color });
            setTimeout(() => setHitFlash(null), 300);

            const points = 30;
            setScore((s) => s + points * (combo + 1));
            setCombo((c) => {
              const next = c + 1;
              setMaxCombo((m) => Math.max(m, next));
              return next;
            });
            break;
          }
        }
        return prev;
      });
    },
    [combo, gameState, getTileScreenY, hitZoneY, objects, playObject],
  );

  const hasBeat = gridHitCount(grid) > 0 && objects.length > 0;

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={onBack} accessibilityRole="button" style={styles.back}>
          <Text style={styles.backChevron}>{'‹'}</Text>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.screenTitle}>Play Zone</Text>
        <View style={styles.scoreWrap}>
          <Text style={styles.scoreNum}>{score}</Text>
        </View>
      </View>

      {gameState === 'idle' && (
        <View style={styles.startOverlay}>
          <LinearGradient
            colors={gradients.brand}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.startIcon}
          >
            <Text style={styles.startGlyph}>♪</Text>
          </LinearGradient>
          <Text style={styles.startTitle}>Rhythm Game</Text>
          <Text style={styles.startSub}>
            {hasBeat
              ? `Your beat at ${bpm} BPM · ${objects.length} sound${objects.length === 1 ? '' : 's'}\nTiles fall to YOUR rhythm.\nTap to hit · Long press to hold · Miss 3 = game over`
              : 'Create a beat in Studio first!\nOr play with random tiles.\nTap to hit · Long press to hold · Miss 3 = game over'}
          </Text>
          <Pressable onPress={startGame} style={styles.startBtn}>
            <LinearGradient
              colors={gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.startBtnInner}
            >
              <Text style={styles.startBtnText}>
                {hasBeat ? 'Play My Beat' : 'Start Game'}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
      )}

      {gameState === 'playing' && (
        <>
          {/* HUD */}
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
                  <View
                    key={i}
                    style={[
                      styles.missDot,
                      i < misses && styles.missDotFilled,
                    ]}
                  />
                ))}
              </View>
            </View>
          </View>

          {/* Lane dividers */}
          <View style={styles.lanes} pointerEvents="none">
            {Array.from({ length: LANE_COUNT + 1 }).map((_, i) => (
              <View
                key={i}
                style={[styles.laneLine, { left: spacing.md + i * laneW }]}
              />
            ))}
          </View>

          {/* Hit zone glow */}
          <View style={[styles.hitZone, { top: hitZoneY - 2 }]} pointerEvents="none">
            <LinearGradient
              colors={['rgba(10,132,255,0)', 'rgba(10,132,255,0.2)', 'rgba(10,132,255,0)']}
              style={styles.hitZoneGlow}
            />
            <View style={styles.hitZoneLine} />
            <Text style={styles.hitZoneLabel}>HIT</Text>
          </View>

          {/* Falling tiles */}
          {tiles
            .filter((t) => !t.hit)
            .map((t) => (
              <Animated.View
                key={t.id}
                pointerEvents="none"
                style={[
                  styles.tile,
                  {
                    left: spacing.md + t.lane * laneW + 8,
                    width: laneW - 16,
                    transform: [{ translateY: t.y }],
                    backgroundColor: t.missed
                      ? 'rgba(255,69,58,0.3)'
                      : t.color,
                    borderColor: t.missed ? colors.accent : 'rgba(255,255,255,0.15)',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.tileLabel,
                    t.missed && { color: colors.accent },
                  ]}
                  numberOfLines={1}
                >
                  {t.missed ? '✕' : t.label}
                </Text>
              </Animated.View>
            ))}

          {/* Hit flash effect */}
          {hitFlash && (
            <View
              style={[
                styles.flashOverlay,
                {
                  left: spacing.md + hitFlash.lane * laneW,
                  width: laneW,
                  top: hitZoneY - 40,
                  backgroundColor: hitFlash.color,
                },
              ]}
              pointerEvents="none"
            />
          )}

          {/* Tap zones at bottom */}
          <View style={[styles.tapArea, { bottom: insets.bottom + 8 }]}>
            {Array.from({ length: LANE_COUNT }).map((_, i) => (
              <Pressable
                key={i}
                onPress={() => handleLaneTap(i)}
                onLongPress={() => handleLaneLongPress(i)}
                delayLongPress={250}
                style={({ pressed }) => [
                  styles.tapLane,
                  pressed && styles.tapLanePressed,
                ]}
              >
                <View style={styles.tapTarget}>
                  <View style={styles.tapCircle} />
                  <Text style={styles.tapText}>TAP</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </>
      )}

      {gameState === 'over' && (
        <View style={styles.startOverlay}>
          <Text style={styles.overTitle}>
            {score > 500 ? 'Amazing!' : score > 200 ? 'Nice Beat!' : 'Game Over'}
          </Text>
          <Text style={styles.overSub}>
            {misses >= 3 ? 'You missed 3 tiles!' : 'Round complete'}
          </Text>

          <View style={styles.overStats}>
            <StatBadge label="Score" value={String(score)} color={colors.vibe} />
            <StatBadge label="Best Combo" value={`${maxCombo}x`} color={colors.warn} />
            <StatBadge label="Misses" value={String(misses)} color={colors.accent} />
          </View>

          <View style={styles.overButtons}>
            <Pressable onPress={startGame} style={styles.startBtn}>
              <LinearGradient
                colors={gradients.brand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.startBtnInner}
              >
                <Text style={styles.startBtnText}>Play Again</Text>
              </LinearGradient>
            </Pressable>
            <Pressable onPress={onBack} style={styles.backToStudio}>
              <Text style={styles.backToStudioText}>Back to Studio</Text>
            </Pressable>
          </View>
        </View>
      )}
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
  root: { flex: 1, backgroundColor: '#050508' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    zIndex: 10,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingRight: spacing.md,
    gap: 2,
  },
  backChevron: { fontSize: 22, fontWeight: '300', color: colors.vibe, marginTop: -1 },
  backText: { ...type.body, color: colors.vibe },
  screenTitle: { ...type.title, color: colors.text, textAlign: 'center' },
  scoreWrap: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,214,10,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,214,10,0.2)',
  },
  scoreNum: { ...type.label, fontSize: 16, color: colors.warn, fontVariant: ['tabular-nums'] },

  hud: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xxl,
    paddingVertical: spacing.md,
    zIndex: 10,
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
  missDotFilled: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },

  lanes: { ...StyleSheet.absoluteFillObject, zIndex: 0 },
  laneLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },

  hitZone: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6,
    zIndex: 1,
    alignItems: 'center',
  },
  hitZoneGlow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -35,
    height: 76,
  },
  hitZoneLine: {
    height: 2,
    marginHorizontal: spacing.md,
    borderRadius: 1,
    backgroundColor: colors.vibe,
    alignSelf: 'stretch',
  },
  hitZoneLabel: {
    ...type.caption,
    fontSize: 9,
    letterSpacing: 3,
    color: 'rgba(10,132,255,0.5)',
    marginTop: 6,
  },

  tile: {
    position: 'absolute',
    height: TILE_H,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  tileLabel: {
    ...type.label,
    fontSize: 15,
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  flashOverlay: {
    position: 'absolute',
    height: 80,
    opacity: 0.15,
    borderRadius: radius.md,
    zIndex: 3,
  },

  tapArea: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    height: 100,
    flexDirection: 'row',
    zIndex: 5,
  },
  tapLane: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
  },
  tapLanePressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  tapTarget: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 2,
  },
  tapCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  tapText: {
    ...type.caption,
    fontSize: 8,
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.3)',
  },

  startOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  startIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startGlyph: { fontSize: 40, color: '#FFFFFF' },
  startTitle: { ...type.display, fontSize: 32, color: colors.text },
  startSub: {
    ...type.body,
    color: colors.textDim,
    textAlign: 'center',
    lineHeight: 24,
  },
  startBtn: { marginTop: spacing.md },
  startBtnInner: {
    paddingHorizontal: spacing.xxl * 1.5,
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
  },
  startBtnText: { ...type.label, fontSize: 16, color: '#FFFFFF', letterSpacing: 0.5 },

  overTitle: { ...type.display, fontSize: 34, color: colors.text },
  overSub: { ...type.body, color: colors.textDim },
  overStats: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  overButtons: {
    gap: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  backToStudio: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  backToStudioText: { ...type.label, color: colors.textDim },

  statBadge: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSolid,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 95,
  },
  statValue: { ...type.title, fontSize: 26, fontVariant: ['tabular-nums'] },
  statLabel: { ...type.caption, color: colors.textDim },
});
