import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSession } from '@/state/sessionStore';
import {
  accuracyOf,
  checkEcho,
  earRound,
  extendPattern,
  gradeTap,
  nextTempo,
  rng,
  scoreFor,
  tapOffset,
  type EarRound,
  type TapResult,
} from '@/game/practice';
import { colors, radius, spacing, type } from '@/theme';
import { gradients } from '@/theme/gradients';

interface Props {
  onBack: () => void;
  /** Opens the falling-tiles game. */
  onTiles: () => void;
}

type Game = 'hub' | 'rhythm' | 'echo' | 'ear';

/**
 * Practice: short drills that build the skills a player uses in the studio —
 * keeping time, remembering a phrase, and knowing their sounds by ear. Every
 * drill uses the objects they recorded, so practising is also getting to know
 * their own kit.
 */
export function PracticeScreen({ onBack, onTiles }: Props) {
  const insets = useSafeAreaInsets();
  const [game, setGame] = useState<Game>('hub');
  const objects = useSession((s) => s.objects);

  const header = (title: string, back: () => void) => (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable onPress={back} style={styles.back} accessibilityRole="button">
        <Text style={styles.backChevron}>‹</Text>
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.back} />
    </View>
  );

  if (game === 'rhythm') {
    return (
      <View style={styles.root}>
        {header('Rhythm Trainer', () => setGame('hub'))}
        <RhythmTrainer />
      </View>
    );
  }
  if (game === 'echo') {
    return (
      <View style={styles.root}>
        {header('Echo', () => setGame('hub'))}
        <Echo />
      </View>
    );
  }
  if (game === 'ear') {
    return (
      <View style={styles.root}>
        {header('Ear Trainer', () => setGame('hub'))}
        <EarTrainer />
      </View>
    );
  }

  const games = [
    {
      id: 'rhythm' as const,
      name: 'Rhythm Trainer',
      emoji: '⏱️',
      desc: 'Tap on the click. See how many ms early or late you are. Tempo rises as you improve.',
      skill: 'Timing',
      color: '#0A84FF',
    },
    {
      id: 'echo' as const,
      name: 'Echo',
      emoji: '🔁',
      desc: 'Hear a pattern of your sounds, tap it back. One more hit every round.',
      skill: 'Memory · groove',
      color: '#BF5AF2',
    },
    {
      id: 'ear' as const,
      name: 'Ear Trainer',
      emoji: '👂',
      desc: 'One of your sounds plays. Which object was it?',
      skill: 'Listening',
      color: '#30D158',
    },
  ];

  return (
    <View style={styles.root}>
      {header('Practice', onBack)}
      <ScrollView contentContainerStyle={[styles.hub, { paddingBottom: insets.bottom + 120 }]}>
        <Text style={styles.hubSub}>
          Drills that use your own recorded sounds.
          {objects.length === 0 ? ' Capture a sound first to unlock them.' : ''}
        </Text>

        {games.map((g) => {
          const needs = g.id === 'ear' || g.id === 'echo' ? 2 : 1;
          const locked = objects.length < needs;
          return (
            <Pressable
              key={g.id}
              onPress={() => !locked && setGame(g.id)}
              style={[styles.gameCard, locked && styles.locked]}
              accessibilityRole="button"
            >
              <View style={[styles.gameIcon, { backgroundColor: `${g.color}26`, borderColor: g.color }]}>
                <Text style={styles.gameEmoji}>{g.emoji}</Text>
              </View>
              <View style={styles.gameInfo}>
                <Text style={styles.gameName}>{g.name}</Text>
                <Text style={[styles.gameSkill, { color: g.color }]}>{g.skill}</Text>
                <Text style={styles.gameDesc}>
                  {locked ? `Needs ${needs} captured sound${needs > 1 ? 's' : ''}` : g.desc}
                </Text>
              </View>
            </Pressable>
          );
        })}

        <Pressable onPress={onTiles} style={styles.gameCard} accessibilityRole="button">
          <View style={[styles.gameIcon, { backgroundColor: '#FF9F0A26', borderColor: '#FF9F0A' }]}>
            <Text style={styles.gameEmoji}>🎹</Text>
          </View>
          <View style={styles.gameInfo}>
            <Text style={styles.gameName}>Tiles</Text>
            <Text style={[styles.gameSkill, { color: '#FF9F0A' }]}>Reaction · rhythm</Text>
            <Text style={styles.gameDesc}>Tap the three lanes as tiles fall to your beat.</Text>
          </View>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ── Rhythm Trainer ──────────────────────────────────────────────────────────

const ROUND_TAPS = 16;

function RhythmTrainer() {
  const objects = useSession((s) => s.objects);
  const playObject = useSession((s) => s.playObject);
  const [bpm, setBpm] = useState(80);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<TapResult[]>([]);
  const [last, setLast] = useState<TapResult | null>(null);
  const [beatFlash, setBeatFlash] = useState(false);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const t0 = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const click = objects[0];

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setRunning(false);
  }, []);

  useEffect(() => stop, [stop]);

  const start = () => {
    setResults([]);
    setLast(null);
    setStreak(0);
    const beat = 60000 / bpm;
    t0.current = performance.now() + beat;
    setRunning(true);
    let n = 0;
    // The click is one of the player's own sounds, so the drill is in their kit.
    setTimeout(() => {
      const fire = () => {
        if (click) playObject(click.id);
        setBeatFlash(true);
        setTimeout(() => setBeatFlash(false), 90);
        n++;
        if (n > ROUND_TAPS + 1) stop();
      };
      fire();
      timer.current = setInterval(fire, beat);
    }, beat);
  };

  const tap = () => {
    if (!running) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const offset = tapOffset(performance.now() - t0.current, bpm);
    const r: TapResult = { offsetMs: offset, grade: gradeTap(offset) };
    setLast(r);
    setResults((prev) => {
      const next = [...prev, r];
      if (next.length >= ROUND_TAPS) {
        stop();
        setBpm((b) => nextTempo(b, accuracyOf(next)));
      }
      return next;
    });
    setStreak((st) => {
      const s2 = r.grade === 'MISS' ? 0 : st + 1;
      setBest((b) => Math.max(b, s2));
      return s2;
    });
  };

  const score = results.reduce((a, r) => a + scoreFor(r.grade), 0);
  const acc = Math.round(accuracyOf(results) * 100);
  const gradeColor = (g?: string) =>
    g === 'PERFECT' ? colors.warn : g === 'GOOD' ? colors.live : g === 'OK' ? colors.vibe : colors.accent;

  return (
    <View style={styles.game}>
      <View style={styles.stats}>
        <Stat label="BPM" value={String(bpm)} />
        <Stat label="ACCURACY" value={results.length ? `${acc}%` : '—'} />
        <Stat label="STREAK" value={`${streak} · best ${best}`} />
      </View>

      <View style={[styles.metronome, beatFlash && styles.metronomeOn]}>
        <Text style={styles.metronomeText}>{running ? '●' : '○'}</Text>
      </View>

      {last && (
        <Text style={[styles.grade, { color: gradeColor(last.grade) }]}>
          {last.grade} · {last.offsetMs > 0 ? '+' : ''}
          {last.offsetMs} ms {last.offsetMs < 0 ? '(early)' : last.offsetMs > 0 ? '(late)' : ''}
        </Text>
      )}

      <Pressable onPressIn={tap} style={styles.bigPad} accessibilityRole="button">
        <Text style={styles.bigPadText}>{running ? 'TAP ON THE CLICK' : 'Ready'}</Text>
        <Text style={styles.bigPadSub}>
          {running ? `${results.length}/${ROUND_TAPS}` : `Score ${score}`}
        </Text>
      </Pressable>

      {!running && (
        <PrimaryButton
          label={results.length ? 'Next round' : 'Start'}
          onPress={start}
        />
      )}
    </View>
  );
}

// ── Echo ────────────────────────────────────────────────────────────────────

function Echo() {
  const objects = useSession((s) => s.objects);
  const playObject = useSession((s) => s.playObject);
  const pads = Math.min(4, objects.length);
  const rand = useRef(rng(Date.now()));
  const [pattern, setPattern] = useState<number[]>([]);
  const [input, setInput] = useState<number[]>([]);
  const [phase, setPhase] = useState<'idle' | 'listen' | 'play' | 'over'>('idle');
  const [lit, setLit] = useState<number | null>(null);
  const [best, setBest] = useState(0);

  const flash = (i: number) => {
    setLit(i);
    setTimeout(() => setLit(null), 220);
  };

  const playPattern = (p: number[]) => {
    setPhase('listen');
    setInput([]);
    p.forEach((pad, k) => {
      setTimeout(() => {
        playObject(objects[pad].id);
        flash(pad);
        if (k === p.length - 1) setTimeout(() => setPhase('play'), 350);
      }, 500 + k * 520);
    });
  };

  const newRound = (base: number[]) => {
    const p = extendPattern(base, pads, rand.current);
    setPattern(p);
    playPattern(p);
  };

  const press = (i: number) => {
    if (phase !== 'play') return;
    playObject(objects[i].id);
    flash(i);
    const next = [...input, i];
    setInput(next);
    const state = checkEcho(pattern, next);
    if (state === 'wrong') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setBest((b) => Math.max(b, pattern.length - 1));
      setPhase('over');
    } else if (state === 'done') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setBest((b) => Math.max(b, pattern.length));
      setTimeout(() => newRound(pattern), 600);
    }
  };

  const colorsFor = ['#0A84FF', '#30D158', '#FF9F0A', '#BF5AF2'];

  return (
    <View style={styles.game}>
      <View style={styles.stats}>
        <Stat label="LENGTH" value={String(pattern.length)} />
        <Stat label="BEST" value={String(best)} />
      </View>
      <Text style={styles.phase}>
        {phase === 'idle'
          ? 'Listen, then tap the pattern back'
          : phase === 'listen'
            ? 'Listen…'
            : phase === 'play'
              ? `Your turn — ${input.length}/${pattern.length}`
              : `Missed! You reached ${Math.max(0, pattern.length - 1)}`}
      </Text>

      <View style={styles.padGrid}>
        {Array.from({ length: pads }).map((_, i) => (
          <Pressable
            key={i}
            onPressIn={() => press(i)}
            style={[
              styles.echoPad,
              { borderColor: colorsFor[i] },
              lit === i && { backgroundColor: `${colorsFor[i]}88` },
            ]}
          >
            <Text style={styles.echoLabel} numberOfLines={1}>
              {objects[i]?.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {(phase === 'idle' || phase === 'over') && (
        <PrimaryButton label={phase === 'over' ? 'Try again' : 'Start'} onPress={() => newRound([])} />
      )}
    </View>
  );
}

// ── Ear Trainer ─────────────────────────────────────────────────────────────

function EarTrainer() {
  const objects = useSession((s) => s.objects);
  const playObject = useSession((s) => s.playObject);
  const rand = useRef(rng(Date.now() ^ 0x5bd1));
  const [round, setRound] = useState<EarRound | null>(null);
  const [level, setLevel] = useState(0);
  const [score, setScore] = useState(0);
  const [asked, setAsked] = useState(0);
  const [feedback, setFeedback] = useState<'right' | 'wrong' | null>(null);

  const next = (lvl: number) => {
    const r = earRound(objects.length, lvl, rand.current);
    setRound(r);
    setFeedback(null);
    if (r) setTimeout(() => playObject(objects[r.answer].id), 300);
  };

  const pick = (i: number) => {
    if (!round || feedback) return;
    const right = i === round.answer;
    setFeedback(right ? 'right' : 'wrong');
    setAsked((a) => a + 1);
    if (right) {
      setScore((s) => s + 1);
      setLevel((l) => l + 1);
    }
    Haptics.notificationAsync(
      right ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
    ).catch(() => {});
    setTimeout(() => next(right ? level + 1 : level), 900);
  };

  return (
    <View style={styles.game}>
      <View style={styles.stats}>
        <Stat label="SCORE" value={`${score}/${asked}`} />
        <Stat label="LEVEL" value={String(level)} />
      </View>

      {!round ? (
        <PrimaryButton label="Start" onPress={() => next(0)} />
      ) : (
        <>
          <Pressable
            onPress={() => playObject(objects[round.answer].id)}
            style={styles.replay}
            accessibilityRole="button"
          >
            <Text style={styles.replayText}>🔊 Play again</Text>
          </Pressable>
          <Text style={styles.phase}>
            {feedback === 'right'
              ? '✓ Correct!'
              : feedback === 'wrong'
                ? `✗ It was ${objects[round.answer].label}`
                : 'Which object was that?'}
          </Text>
          <View style={styles.padGrid}>
            {round.choices.map((i) => {
              const o = objects[i];
              const show = feedback != null && i === round.answer ? colors.live : undefined;
              return (
                <Pressable
                  key={o.id}
                  onPress={() => pick(i)}
                  style={[styles.echoPad, { borderColor: show ?? o.color }]}
                >
                  <Text style={styles.echoLabel} numberOfLines={1}>
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

// ── shared bits ─────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.primary} accessibilityRole="button">
      <LinearGradient
        colors={gradients.brand}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.primaryInner}
      >
        <Text style={styles.primaryText}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 72 },
  backChevron: { fontSize: 22, fontWeight: '300', color: colors.vibe, marginTop: -1 },
  backText: { ...type.body, color: colors.vibe },
  title: { ...type.title, color: colors.text },

  hub: { paddingHorizontal: spacing.lg, gap: spacing.md },
  hubSub: { ...type.body, color: colors.textDim, marginBottom: spacing.xs },
  gameCard: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSolid,
    alignItems: 'center',
  },
  locked: { opacity: 0.45 },
  gameIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameEmoji: { fontSize: 26 },
  gameInfo: { flex: 1, gap: 2 },
  gameName: { ...type.label, fontSize: 16, color: colors.text },
  gameSkill: { ...type.caption, fontSize: 11, letterSpacing: 0.5 },
  gameDesc: { ...type.caption, color: colors.textDim, lineHeight: 16 },

  game: { flex: 1, paddingHorizontal: spacing.lg, gap: spacing.lg, alignItems: 'center' },
  stats: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.md },
  stat: { alignItems: 'center', gap: 2 },
  statLabel: { ...type.caption, fontSize: 9, letterSpacing: 2, color: colors.textFaint },
  statValue: { ...type.title, fontSize: 18, color: colors.text, fontVariant: ['tabular-nums'] },

  metronome: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metronomeOn: { borderColor: colors.vibe, backgroundColor: 'rgba(10,132,255,0.3)' },
  metronomeText: { fontSize: 26, color: colors.text },
  grade: { ...type.title, fontSize: 18, fontVariant: ['tabular-nums'] },
  bigPad: {
    width: '100%',
    flex: 1,
    maxHeight: 280,
    borderRadius: radius.xl,
    borderWidth: 2,
    borderColor: colors.vibe,
    backgroundColor: 'rgba(10,132,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  bigPadText: { ...type.title, fontSize: 20, color: colors.text, letterSpacing: 1 },
  bigPadSub: { ...type.body, color: colors.textDim },

  phase: { ...type.body, color: colors.text, textAlign: 'center' },
  padGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'center',
  },
  echoPad: {
    width: '46%',
    height: 110,
    borderRadius: radius.xl,
    borderWidth: 2,
    backgroundColor: colors.surfaceSolid,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
  },
  echoLabel: { ...type.label, fontSize: 15, color: colors.text },
  replay: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.vibe,
    marginTop: spacing.lg,
  },
  replayText: { ...type.label, color: colors.vibe },

  primary: { width: '100%', marginTop: spacing.sm },
  primaryInner: { paddingVertical: spacing.lg, borderRadius: radius.pill, alignItems: 'center' },
  primaryText: { ...type.label, fontSize: 17, color: '#FFFFFF' },
});
