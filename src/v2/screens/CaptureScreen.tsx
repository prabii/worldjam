import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type { Camera } from 'react-native-vision-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '../nav/focus';

import { useCaptureTarget } from '@/vision/hooks/useCaptureTarget';
import { namingFor } from '@/vision/captureNaming';

import { CaptureCamera } from '../components/CaptureCamera';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toasts';
import { Button, Field, IconButton, Segmented, Sheet } from '../components/ui';
import type { CaptureType } from '../contracts/library';
import { useNav } from '../nav/store';
import { discard, lastNoiseReduction, normalizeTake, saveAudioCapture, saveVideoCapture, startAudioTake, stopAudioTake, takeLevel } from '../services/capture';
import { stop as stopPlayer, toggle, usePlayer } from '../services/player';
import { addSources } from '../services/studio';
import { accentGradient, color, font, formatDuration, radius, space } from '../theme';

type Mode = 'SOUND' | 'VIDEO' | 'HUM';
type Phase = 'ready' | 'recording' | 'review' | 'saving';

const MAX_AUDIO_MS = 10 * 60 * 1000;
const MAX_VIDEO_MS = 60 * 1000;

interface Pending {
  kind: 'audio' | 'video';
  uri: string;
  durationMs: number;
  suggested: string | null;
  /** Background noise removed (dB); null = nothing to remove / not measured. */
  cleanedDb: number | null;
}

/**
 * Capture: Sound (mic, with the camera suggesting what it is), Video (camera
 * with sound) or Hum (your voice). Record → name + describe → save to My Jams.
 * Opened from Studio (sessionId), it also asks whether to keep the capture in
 * My Jams, and adds it to the session either way.
 */
export function CaptureScreen({ sessionId }: { sessionId?: string }) {
  const insets = useSafeAreaInsets();
  const { pop, setTab } = useNav();
  const focused = useIsFocused();
  const [mode, setMode] = useState<Mode>('SOUND');
  const [phase, setPhase] = useState<Phase>('ready');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [keepInLibrary, setKeepInLibrary] = useState(true);
  const [savedCount, setSavedCount] = useState(0);
  const camera = useRef<Camera>(null);
  const startedAt = useRef(0);
  const suggestion = useRef<string | null>(null);
  const cameraOn = focused && mode !== 'HUM' && phase !== 'review' && phase !== 'saving';
  const vision = useCaptureTarget(cameraOn);
  const preview = usePlayer((s) => (pending && s.activeId === `pending:${pending.uri}` ? s.state : 'idle'));

  // Timer + live level while recording; auto-stop at the limit.
  useEffect(() => {
    if (phase !== 'recording') return;
    const id = setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      if (mode !== 'VIDEO') setLevel(takeLevel());
      if (ms >= (mode === 'VIDEO' ? MAX_VIDEO_MS : MAX_AUDIO_MS)) void stopRecording();
    }, 80);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mode]);

  // Leaving mid-recording must not leave the mic or camera running.
  useEffect(
    () => () => {
      const taken = stopAudioTake();
      if (taken) void discard(taken.uri);
      void camera.current?.stopRecording().catch(() => {});
      stopPlayer();
    },
    [],
  );

  const startRecording = async () => {
    stopPlayer();
    suggestion.current = mode !== 'HUM' ? namingFor(vision.snapshot()).label : null;
    if (suggestion.current === 'Object') suggestion.current = null;
    try {
      if (mode === 'VIDEO') {
        if (!camera.current) throw new Error('Camera is not ready yet');
        camera.current.startRecording({
          fileType: 'mp4',
          onRecordingFinished: (v) => {
            setPending({ kind: 'video', uri: v.path, durationMs: Math.round(v.duration * 1000), suggested: suggestion.current, cleanedDb: null });
            enterReview(suggestion.current, 'Video');
          },
          onRecordingError: (e) => {
            setPhase('ready');
            toast(`Video failed: ${e.message}`, 'error');
          },
        });
      } else {
        await startAudioTake();
      }
      startedAt.current = Date.now();
      setElapsed(0);
      setPhase('recording');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const enterReview = (suggested: string | null, fallback: string) => {
    setName(suggested ?? '');
    setDescription('');
    if (!suggested) setName(`${fallback} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    setKeepInLibrary(true);
    setPhase('review');
  };

  const stopRecording = async () => {
    if (mode === 'VIDEO') {
      setPhase('saving'); // until onRecordingFinished lands
      await camera.current?.stopRecording().catch((e) => {
        setPhase('ready');
        toast(String(e), 'error');
      });
      return;
    }
    const taken = stopAudioTake();
    setLevel(0);
    if (!taken) {
      setPhase('ready');
      toast('Too short — hold the button a little longer.', 'error');
      return;
    }
    setPhase('saving');
    // Level the take now so the review preview is already at full volume.
    await normalizeTake(taken.uri.replace(/^file:\/\//, ''));
    setPending({ kind: 'audio', uri: taken.uri, durationMs: Math.round((taken.info.frames / taken.info.sampleRate) * 1000), suggested: suggestion.current, cleanedDb: lastNoiseReduction() });
    enterReview(suggestion.current, mode === 'HUM' ? 'Hum' : 'Sound');
  };

  const discardPending = async () => {
    stopPlayer();
    if (pending) await discard(pending.kind === 'video' ? `file://${pending.uri.replace(/^file:\/\//, '')}` : pending.uri);
    setPending(null);
    setPhase('ready');
  };

  const save = async () => {
    if (!pending) return;
    stopPlayer();
    setPhase('saving');
    try {
      const meta = { name: name.trim() || 'Untitled sound', description: description.trim(), detectedLabel: pending.suggested, inLibrary: sessionId ? keepInLibrary : true };
      const type: CaptureType = pending.kind === 'video' ? 'VIDEO' : mode === 'HUM' ? 'HUM' : 'AUDIO';
      const c = pending.kind === 'video' ? await saveVideoCapture(pending.uri, meta) : await saveAudioCapture(pending.uri, type as 'AUDIO' | 'HUM', meta, { alreadyClean: true });
      if (sessionId) await addSources([c.id]);
      setSavedCount((n) => n + 1);
      const cleaned = pending.kind === 'video' ? lastNoiseReduction() : pending.cleanedDb;
      const noise = cleaned != null && cleaned >= 1 ? ` · background noise −${Math.round(cleaned)} dB` : '';
      toast(`${sessionId ? (meta.inLibrary ? 'Added to Studio and saved to My Jams' : 'Added to this Studio session') : 'Saved to My Jams'}${noise}`, 'success');
      setPending(null);
      setPhase('ready');
    } catch (err) {
      setPhase('review');
      toast(err instanceof Error ? err.message : 'Could not save', 'error');
    }
  };

  const recording = phase === 'recording';
  const target = mode !== 'HUM' ? vision.target : null;

  return (
    <View style={styles.root}>
      {mode !== 'HUM' ? (
        <CaptureCamera ref={camera} active={cameraOn} video={mode === 'VIDEO'} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.humBg]}>
          <Icon name="hum" size={96} color={recording ? color.cyan : color.line} strokeWidth={1.5} />
          <Text style={[font.body, { textAlign: 'center', marginTop: space.lg }]}>Hum or sing a tune.{'\n'}Your voice becomes the vocal of your track.</Text>
        </View>
      )}
      <LinearGradient colors={['rgba(11,13,18,0.85)', 'transparent']} style={[styles.topFade, { height: insets.top + 140 }]} pointerEvents="none" />
      <LinearGradient colors={['transparent', 'rgba(11,13,18,0.95)']} style={styles.bottomFade} pointerEvents="none" />

      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.topRow}>
          <IconButton icon="close" label="Close capture" onPress={pop} tint={color.text} />
          <Text style={[font.heading, { flex: 1, textAlign: 'center' }]}>{sessionId ? 'Capture for Studio' : 'Capture'}</Text>
          <View style={{ alignItems: 'center' }}>
            <IconButton
              icon="jams"
              label="Go to My Jams"
              tint={color.text}
              disabled={recording || phase === 'saving'}
              onPress={() => {
                stopPlayer();
                setTab('jams');
              }}
            />
            {savedCount > 0 && <Text style={font.caption}>{savedCount} saved</Text>}
          </View>
        </View>
        {!recording && phase === 'ready' && (
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'SOUND', label: 'Sound', icon: 'mic' },
              { value: 'VIDEO', label: 'Video', icon: 'video' },
              { value: 'HUM', label: 'Hum', icon: 'hum' },
            ]}
          />
        )}
        {target && !recording && (
          <View style={styles.detect} accessibilityLiveRegion="polite">
            <Icon name="capture" size={14} color={color.cyan} />
            <Text style={[font.label, { color: color.text }]}>Looks like: {target.spokenLabel}</Text>
          </View>
        )}
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.xl }]}>
        <Text style={[font.mono, { color: recording ? color.text : color.textMuted, fontSize: 16 }]}>
          {recording ? formatDuration(elapsed) : mode === 'VIDEO' ? 'Up to 1 min' : 'Tap to record'}
        </Text>
        <Pressable
          onPress={recording ? stopRecording : startRecording}
          disabled={phase === 'saving'}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop recording' : `Record ${mode.toLowerCase()}`}
          style={styles.recordWrap}
        >
          {/* The halo breathes with the microphone level. */}
          <View style={[styles.halo, { transform: [{ scale: 1 + (recording ? Math.min(0.35, level * 0.8) : 0) }], opacity: recording ? 0.5 : 0 }]} />
          <LinearGradient colors={[...accentGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.ring}>
            <View style={styles.ringInner}>
              <View style={recording ? styles.stopSquare : styles.recordDot} />
            </View>
          </LinearGradient>
        </Pressable>
        {phase === 'saving' && !pending && <Text style={font.caption}>{mode === 'VIDEO' ? 'Finishing video…' : 'Levelling your sound…'}</Text>}
      </View>

      <Sheet visible={phase === 'review' || (phase === 'saving' && !!pending)} onClose={discardPending} title={pending?.kind === 'video' ? 'Name your video' : mode === 'HUM' ? 'Name your hum' : 'Name your sound'}>
        {pending && (
          <View style={{ gap: space.lg }}>
            <View style={styles.reviewRow}>
              <Pressable
                onPress={() => pending.kind === 'audio' && void toggle(`pending:${pending.uri}`, pending.uri)}
                disabled={pending.kind === 'video'}
                style={styles.reviewPlay}
                accessibilityLabel={preview === 'playing' ? 'Pause preview' : 'Play preview'}
              >
                <Icon name={pending.kind === 'video' ? 'video' : preview === 'playing' ? 'pause' : 'play'} size={20} color={color.bg} />
              </Pressable>
              <Text style={font.label}>
                {pending.kind === 'video' ? 'Video' : mode === 'HUM' ? 'Hum' : 'Sound'} · {formatDuration(pending.durationMs)}
                {pending.suggested ? ` · camera saw “${pending.suggested}”` : ''}
                {pending.kind === 'video'
                  ? ' · background noise is removed when you save'
                  : pending.cleanedDb != null && pending.cleanedDb >= 1
                    ? ` · background noise removed −${Math.round(pending.cleanedDb)} dB`
                    : ' · no background noise to remove'}
              </Text>
            </View>
            <Field label="Name" value={name} onChangeText={setName} maxLength={60} returnKeyType="next" />
            <Field
              label="Description (helps the AI)"
              value={description}
              onChangeText={setDescription}
              placeholder={mode === 'HUM' ? 'e.g. slow dreamy melody' : 'e.g. sharp glassy knock on a tumbler'}
              multiline
              maxLength={240}
            />
            {sessionId && (
              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={font.heading}>Also save to My Jams</Text>
                  <Text style={font.caption}>Off: use it only in this Studio session.</Text>
                </View>
                <Switch value={keepInLibrary} onValueChange={setKeepInLibrary} trackColor={{ true: color.violet, false: color.line }} thumbColor={color.text} accessibilityLabel="Also save to My Jams" />
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <Button label="Discard" kind="danger" icon="delete" onPress={discardPending} disabled={phase === 'saving'} style={{ flex: 1 }} />
              <Button label="Save" kind="primary" icon="save" onPress={save} busy={phase === 'saving'} style={{ flex: 1.4 }} />
            </View>
          </View>
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  humBg: { alignItems: 'center', justifyContent: 'center', backgroundColor: color.bg, padding: space.xl },
  topFade: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomFade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 280 },
  top: { paddingHorizontal: space.lg, gap: space.md },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  detect: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.round, backgroundColor: 'rgba(18,21,28,0.85)' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: space.lg },
  recordWrap: { width: 108, height: 108, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 108, height: 108, borderRadius: 54, backgroundColor: color.violet },
  ring: { width: 88, height: 88, borderRadius: 44, padding: 4 },
  ringInner: { flex: 1, borderRadius: 40, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center' },
  recordDot: { width: 34, height: 34, borderRadius: 17, backgroundColor: color.error },
  stopSquare: { width: 28, height: 28, borderRadius: 6, backgroundColor: color.text },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  reviewPlay: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.text, alignItems: 'center', justifyContent: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
