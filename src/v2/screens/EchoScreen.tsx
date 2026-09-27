import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';

import { toast } from '../components/Toasts';
import { Button, Header, Screen } from '../components/ui';
import type { Capture } from '../contracts/library';
import { echoCheck, growPattern } from '../games/logic';
import { loadKit, pickKitCaptures, playKit, readEchoBest, saveEchoBest } from '../games/kit';
import { useNav } from '../nav/store';
import { color, font, radius, space } from '../theme';

type Phase = 'idle' | 'listen' | 'turn' | 'over';
const TINT = [color.pink, color.cyan, color.violet, '#F5B942'];
const STEP_MS = 520;

/** Echo: the app plays a pattern of your sounds, you tap it back; one hit longer every round. */
export function EchoScreen() {
  const { pop } = useNav();
  const [pads, setPads] = useState<Capture[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [pattern, setPattern] = useState<number[]>([]);
  const [taps, setTaps] = useState<number[]>([]);
  const [lit, setLit] = useState<number | null>(null);
  const [best, setBest] = useState(0);
  const [loading, setLoading] = useState(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const caps = await pickKitCaptures(4);
        await loadKit(caps);
        setPads(caps);
        setBest(await readEchoBest());
      } finally {
        setLoading(false);
      }
    })();
    return () => timers.current.forEach(clearTimeout);
  }, []);

  const flash = (i: number) => {
    setLit(i);
    timers.current.push(setTimeout(() => setLit((x) => (x === i ? null : x)), 260));
  };

  const playPattern = (p: number[]) => {
    setPhase('listen');
    setTaps([]);
    p.forEach((pad, k) => {
      timers.current.push(
        setTimeout(() => {
          playKit(pad);
          flash(pad);
        }, 600 + k * STEP_MS),
      );
    });
    timers.current.push(setTimeout(() => setPhase('turn'), 600 + p.length * STEP_MS));
  };

  const start = () => {
    if (pads.length < 2) {
      toast('Echo needs at least 2 captured sounds', 'error');
      return;
    }
    const p = growPattern(growPattern([], pads.length), pads.length);
    setPattern(p);
    playPattern(p);
  };

  const onPad = (i: number) => {
    playKit(i);
    flash(i);
    if (phase !== 'turn') return;
    const next = [...taps, i];
    const r = echoCheck(pattern, next);
    if (r === 'wrong') {
      setPhase('over');
      const reached = pattern.length - 1;
      if (reached > best) {
        setBest(reached);
        void saveEchoBest(reached);
      }
      return;
    }
    setTaps(next);
    if (r === 'done') {
      const done = pattern.length;
      if (done > best) {
        setBest(done);
        void saveEchoBest(done);
      }
      const p = growPattern(pattern, pads.length);
      setPattern(p);
      timers.current.push(setTimeout(() => playPattern(p), 500));
    }
  };

  const size = (Math.min(Dimensions.get('window').width, 420) - space.lg * 2 - space.md) / 2;
  const status =
    phase === 'listen' ? 'Listen…' : phase === 'turn' ? `Your turn — ${taps.length}/${pattern.length}` : phase === 'over' ? `Wrong pad — you reached ${Math.max(0, pattern.length - 1)}` : 'Tap Start and listen';

  return (
    <Screen scroll>
      <Header title="Echo" subtitle="Hear a pattern of your sounds, tap it back" onBack={pop} />
      <View style={styles.stats}>
        <Text style={font.label}>Length {pattern.length}</Text>
        <Text style={font.label}>Best {best}</Text>
      </View>
      <Text style={[font.title, { textAlign: 'center', marginVertical: space.lg }]} accessibilityLiveRegion="polite">
        {loading ? 'Loading your sounds…' : status}
      </Text>
      <View style={styles.grid}>
        {pads.map((c, i) => (
          <Pressable
            key={`${c.id}${i}`}
            onPressIn={() => onPad(i)}
            accessibilityRole="button"
            accessibilityLabel={`Pad ${c.name}`}
            style={[styles.pad, { width: size, height: size, borderColor: TINT[i] }, lit === i && { backgroundColor: TINT[i] }]}
          >
            <Text style={styles.padText} numberOfLines={2}>{c.name}</Text>
          </Pressable>
        ))}
      </View>
      {!loading && pads.length < 2 && <Text style={[font.body, { textAlign: 'center' }]}>Capture at least 2 sounds to play Echo.</Text>}
      <View style={{ marginTop: space.xl }}>
        {(phase === 'idle' || phase === 'over') && (
          <Button label={phase === 'over' ? 'Try again' : 'Start'} kind="primary" icon="play" disabled={loading || pads.length < 2} onPress={start} />
        )}
      </View>
      <Text style={[font.caption, { marginTop: space.lg }]}>A pad never plays three times in a row. Remember the sounds, not just the positions.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', justifyContent: 'space-between' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, justifyContent: 'center' },
  pad: { borderRadius: radius.panel, borderWidth: 3, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center', padding: space.md },
  padText: { color: color.text, fontWeight: '700', fontSize: 16, textAlign: 'center' },
});
