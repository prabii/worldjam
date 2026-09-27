import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ResizeMode, Video, type AVPlaybackStatus } from 'expo-av';

import type { Capture, Lyric, Track } from '../contracts/library';
import { assetUri, captureAudioPath, capturePeaks } from '../services/media';
import { claimForVideo, stop, toggle, usePlayer } from '../services/player';
import { color, font, formatDate, formatDuration, radius, space } from '../theme';
import { Icon } from './Icon';

const ARTWORK = require('../../../assets/branding/adaptive-foreground.png');

/** Compact bar envelope; bars before `progress` are lit. */
export function Peaks({ peaks, progress = 0, height = 28, tint = color.textSecondary }: { peaks: number[]; progress?: number; height?: number; tint?: string }) {
  if (peaks.length === 0) return <View style={{ height }} />;
  const lit = Math.round(progress * peaks.length);
  return (
    <View style={[styles.peaks, { height }]} accessible={false}>
      {peaks.map((p, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: Math.max(2, p * height),
            borderRadius: 1,
            backgroundColor: i < lit ? color.cyan : tint,
            opacity: i < lit ? 1 : 0.45,
          }}
        />
      ))}
    </View>
  );
}

function PlayButton({ playing, loading, onPress, label }: { playing: boolean; loading?: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={playing ? `Pause ${label}` : `Play ${label}`}
      style={({ pressed }) => [styles.play, pressed && { opacity: 0.7 }]}
    >
      <Icon name={playing ? 'pause' : loading ? 'waveform' : 'play'} size={20} color={color.bg} />
    </Pressable>
  );
}

function useActive(id: string) {
  const active = usePlayer((s) => s.activeId === id);
  const state = usePlayer((s) => (s.activeId === id ? s.state : 'idle'));
  const progress = usePlayer((s) => (s.activeId === id && s.durationMs > 0 ? s.positionMs / s.durationMs : 0));
  return { active, state, progress };
}

const TYPE_LABEL: Record<Capture['type'], string> = { AUDIO: 'Sound', VIDEO: 'Video', HUM: 'Hum', VOCAL: 'Vocal' };

/**
 * A capture in My Jams. Audio plays inline through the shared player; a video
 * card opens into an inline video player with its sound (My Jams only — in
 * Studio a video capture is just its audio).
 */
export function CaptureCard({
  capture,
  onOpen,
  playVideoInline = true,
  right,
}: {
  capture: Capture;
  onOpen?: () => void;
  playVideoInline?: boolean;
  right?: React.ReactNode;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const { active, state, progress } = useActive(capture.id);
  const isVideo = capture.type === 'VIDEO';

  useEffect(() => {
    let live = true;
    if (capture.thumbnailAssetId) assetUri(capture.thumbnailAssetId).then((u) => live && setThumb(u));
    capturePeaks(capture).then((p) => live && setPeaks(p));
    return () => {
      live = false;
    };
  }, [capture]);

  const onPlay = async () => {
    if (isVideo && playVideoInline) {
      if (videoUri && active) {
        setVideoUri(null);
        await stop();
        return;
      }
      const uri = await assetUri(capture.mediaAssetId);
      if (uri) {
        await claimForVideo(capture.id);
        setVideoUri(uri);
      }
      return;
    }
    const path = await captureAudioPath(capture);
    if (path) await toggle(capture.id, path);
  };

  // Another item took the player: fold the inline video away.
  useEffect(() => {
    if (!active && videoUri) setVideoUri(null);
  }, [active, videoUri]);

  return (
    <View style={styles.card}>
      {videoUri ? <InlineVideo uri={videoUri} onEnd={() => { setVideoUri(null); void stop(); }} /> : null}
      <Pressable onPress={onOpen} disabled={!onOpen} style={styles.row} accessibilityRole="button" accessibilityLabel={`${capture.name}, ${TYPE_LABEL[capture.type]}, ${formatDuration(capture.durationMs)}`}>
        <View style={styles.thumbWrap}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, styles.art]}>
              <Image source={ARTWORK} style={styles.artImg} />
            </View>
          )}
          <View style={styles.typeBadge}>
            <Icon name={isVideo ? 'video' : capture.type === 'HUM' || capture.type === 'VOCAL' ? 'hum' : 'mic'} size={12} color={color.text} />
          </View>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={font.heading} numberOfLines={1}>
            {capture.name}
          </Text>
          {capture.description ? (
            <Text style={font.label} numberOfLines={2}>
              {capture.description}
            </Text>
          ) : null}
          <Text style={font.mono}>
            {TYPE_LABEL[capture.type]} · {formatDuration(capture.durationMs)} · {formatDate(capture.createdAt)}
          </Text>
        </View>
        {right ?? <PlayButton playing={state === 'playing'} loading={state === 'loading'} onPress={onPlay} label={capture.name} />}
      </Pressable>
      {!isVideo || !videoUri ? <Peaks peaks={peaks} progress={active ? progress : 0} height={22} /> : null}
    </View>
  );
}

function InlineVideo({ uri, onEnd }: { uri: string; onEnd: () => void }) {
  const ref = useRef<Video>(null);
  return (
    <Video
      ref={ref}
      source={{ uri }}
      style={styles.video}
      resizeMode={ResizeMode.COVER}
      shouldPlay
      useNativeControls
      onPlaybackStatusUpdate={(s: AVPlaybackStatus) => {
        if (s.isLoaded && s.didJustFinish) onEnd();
      }}
    />
  );
}

export function TrackCard({ track, onOpen }: { track: Track; onOpen: () => void }) {
  const [uri, setUri] = useState<string | null>(null);
  const { state, progress } = useActive(track.id);
  useEffect(() => {
    let live = true;
    assetUri(track.audioAssetId).then((u) => live && setUri(u));
    return () => {
      live = false;
    };
  }, [track.audioAssetId]);
  const meta = [track.mode === 'AI' ? 'AI' : 'Manual', track.style, track.bpm ? `${track.bpm} BPM` : null, formatDuration(track.durationMs)]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={styles.card}>
      <Pressable onPress={onOpen} style={styles.row} accessibilityRole="button" accessibilityLabel={`${track.name}, track, ${meta}`}>
        <View style={[styles.thumb, styles.trackArt]}>
          <Icon name={track.mode === 'AI' ? 'ai' : 'pads'} size={26} color={color.text} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={font.heading} numberOfLines={1}>
            {track.name}
          </Text>
          {track.description ? (
            <Text style={font.label} numberOfLines={1}>
              {track.description}
            </Text>
          ) : null}
          <Text style={font.mono} numberOfLines={1}>
            {meta}
          </Text>
          <Text style={font.caption} numberOfLines={1}>
            {track.sources.map((s) => s.name).join(', ')}
          </Text>
        </View>
        <PlayButton
          playing={state === 'playing'}
          loading={state === 'loading'}
          label={track.name}
          onPress={() => uri && void toggle(track.id, uri)}
        />
      </Pressable>
      <Peaks peaks={downsample(track.peaks, 48)} progress={progress} height={22} />
    </View>
  );
}

export function LyricCard({ lyric, onOpen }: { lyric: Lyric; onOpen: () => void }) {
  const firstLines = lyric.text.split('\n').filter((l) => l.trim()).slice(0, 2).join(' / ');
  return (
    <Pressable onPress={onOpen} style={[styles.card, styles.row]} accessibilityRole="button" accessibilityLabel={`${lyric.name}, lyrics`}>
      <View style={[styles.thumb, styles.trackArt]}>
        <Icon name="lyrics" size={24} color={color.text} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={font.heading} numberOfLines={1}>
          {lyric.name}
        </Text>
        <Text style={[font.label, { fontStyle: 'italic' }]} numberOfLines={2}>
          {firstLines || 'Empty'}
        </Text>
        <Text style={font.mono}>
          {[lyric.style, lyric.language.toUpperCase(), formatDate(lyric.updatedAt)].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Icon name="edit" size={20} />
    </Pressable>
  );
}

export function downsample(peaks: number[], n: number): number[] {
  if (peaks.length <= n) return peaks;
  const out: number[] = [];
  const step = peaks.length / n;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) m = Math.max(m, peaks[j]);
    out.push(m);
  }
  return out;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.panel,
    borderWidth: 1,
    borderColor: color.line,
    padding: space.md,
    gap: space.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumbWrap: { position: 'relative' },
  thumb: { width: 64, height: 64, borderRadius: radius.card, backgroundColor: color.elevated },
  art: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  artImg: { width: 52, height: 52, opacity: 0.9 },
  trackArt: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.line },
  typeBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  play: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.text, alignItems: 'center', justifyContent: 'center' },
  peaks: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.card, backgroundColor: '#000' },
});
