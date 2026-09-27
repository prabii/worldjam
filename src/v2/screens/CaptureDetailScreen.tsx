import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ResizeMode, Video } from 'expo-av';

import { Peaks } from '../components/cards';
import { ConfirmDelete } from '../components/ConfirmDelete';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toasts';
import { Button, Empty, Field, Header, Screen } from '../components/ui';
import { roleForCapture, describeFeatures } from '../ai/kb/rules';
import { useNav } from '../nav/store';
import { deleteCapture } from '../services/capture';
import { getLibrary, notifyLibraryChanged, useLibraryQuery } from '../services/library';
import { assetUri, captureAudioPath, capturePeaks } from '../services/media';
import { claimForVideo, stop, toggle, usePlayer } from '../services/player';
import { addSources, openSession, removeSource, useStudio } from '../services/studio';
import { color, font, formatDate, formatDuration, radius, space } from '../theme';

const ARTWORK = require('../../../assets/branding/adaptive-foreground.png');

export function CaptureDetailScreen({ id }: { id: string }) {
  const { pop, setTab } = useNav();
  const { data: capture, loading } = useLibraryQuery((lib) => lib.captures.get(id), [id]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const playState = usePlayer((s) => (s.activeId === id ? s.state : 'idle'));
  const progress = usePlayer((s) => (s.activeId === id && s.durationMs ? s.positionMs / s.durationMs : 0));

  useEffect(() => {
    if (!capture) return;
    setName(capture.name);
    setDescription(capture.description);
    let live = true;
    capturePeaks(capture, 96).then((p) => live && setPeaks(p));
    if (capture.type === 'VIDEO') assetUri(capture.mediaAssetId).then((u) => live && setVideoUri(u));
    if (capture.thumbnailAssetId) assetUri(capture.thumbnailAssetId).then((u) => live && setThumb(u));
    return () => {
      live = false;
    };
  }, [capture]);

  useEffect(() => () => void stop(), []);

  if (!capture) {
    return (
      <Screen>
        <Header title="Capture" onBack={pop} />
        {!loading && <Empty icon="search" title="Not found" body="This capture was deleted." />}
      </Screen>
    );
  }

  const dirty = name.trim() !== capture.name || description.trim() !== capture.description;

  const save = async () => {
    setSaving(true);
    try {
      const lib = await getLibrary();
      await lib.captures.update(id, { name: name.trim() || capture.name, description: description.trim() });
      notifyLibraryChanged();
      toast('Saved', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const useInStudio = async () => {
    if (!useStudio.getState().session) await openSession();
    await addSources([id]);
    toast(`${capture.name} added to Studio`, 'success');
    pop();
    setTab('studio');
  };

  return (
    <Screen scroll>
      <Header title={capture.name} subtitle={`${capture.type === 'VIDEO' ? 'Video' : capture.type === 'HUM' ? 'Hum' : 'Sound'} · ${formatDuration(capture.durationMs)} · ${formatDate(capture.createdAt)}`} onBack={pop} />

      {capture.type === 'VIDEO' && videoUri ? (
        <Video
          source={{ uri: videoUri }}
          style={styles.video}
          resizeMode={ResizeMode.CONTAIN}
          useNativeControls
          posterSource={thumb ? { uri: thumb } : undefined}
          usePoster={!!thumb}
          onPlaybackStatusUpdate={(s) => {
            if (s.isLoaded && s.isPlaying && usePlayer.getState().activeId !== id) void claimForVideo(id);
          }}
        />
      ) : (
        <View style={styles.audioCard}>
          <Image source={ARTWORK} style={styles.art} />
          <Pressable
            onPress={async () => {
              const p = await captureAudioPath(capture);
              if (p) await toggle(id, p);
            }}
            style={styles.play}
            accessibilityRole="button"
            accessibilityLabel={playState === 'playing' ? 'Pause' : 'Play'}
          >
            <Icon name={playState === 'playing' ? 'pause' : 'play'} size={26} color={color.bg} />
          </Pressable>
          <View style={{ alignSelf: 'stretch' }}>
            <Peaks peaks={peaks} progress={progress} height={44} />
          </View>
        </View>
      )}

      <View style={{ gap: space.lg, marginTop: space.xl }}>
        <Field label="Name" value={name} onChangeText={setName} maxLength={60} />
        <Field label="Description" value={description} onChangeText={setDescription} multiline maxLength={240} placeholder="What is it? How does it sound?" />
        <Button label="Save changes" icon="save" onPress={save} disabled={!dirty} busy={saving} />
      </View>

      <View style={styles.facts}>
        <Text style={font.caption}>Sound: {describeFeatures(capture.features)}</Text>
        <Text style={font.caption}>Likely role in a track: {roleForCapture(capture)}</Text>
        {capture.detectedLabel ? <Text style={font.caption}>Camera saw: {capture.detectedLabel}</Text> : null}
        {capture.features?.melody?.key ? <Text style={font.caption}>Key: {capture.features.melody.key}</Text> : null}
      </View>

      <View style={{ gap: space.md, marginTop: space.xl }}>
        <Button label="Use in Studio" kind="primary" icon="studio" onPress={useInStudio} />
        <Button label="Delete" kind="danger" icon="delete" onPress={() => setConfirm(true)} />
      </View>

      <ConfirmDelete
        visible={confirm}
        what={`“${capture.name}”`}
        detail="It disappears from My Jams and from any Studio session. Tracks already made with it keep their audio."
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          await stop();
          await deleteCapture(id);
          const st = useStudio.getState();
          if (st.session?.sources.some((s) => s.captureId === id)) await removeSource(id);
          setConfirm(false);
          toast('Deleted', 'success');
          pop();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  video: { width: '100%', aspectRatio: 9 / 12, borderRadius: radius.panel, backgroundColor: '#000' },
  audioCard: { alignItems: 'center', gap: space.lg, padding: space.xl, borderRadius: radius.panel, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  art: { width: 120, height: 120 },
  play: { width: 64, height: 64, borderRadius: 32, backgroundColor: color.text, alignItems: 'center', justifyContent: 'center' },
  facts: { gap: 4, marginTop: space.xl, padding: space.lg, borderRadius: radius.card, backgroundColor: color.surface },
});
