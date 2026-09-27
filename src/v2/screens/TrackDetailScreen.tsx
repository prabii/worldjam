import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Peaks } from '../components/cards';
import { ConfirmDelete } from '../components/ConfirmDelete';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toasts';
import { Button, Empty, Field, Header, Screen } from '../components/ui';
import { useNav } from '../nav/store';
import { getLibrary, notifyLibraryChanged, useLibraryQuery } from '../services/library';
import { assetUri } from '../services/media';
import { stop, toggle, usePlayer } from '../services/player';
import { openTrackForEditing } from '../services/studio';
import { color, font, formatDate, formatDuration, radius, space } from '../theme';

export function TrackDetailScreen({ id }: { id: string }) {
  const { pop, push, setTab } = useNav();
  const { data: track, loading } = useLibraryQuery((lib) => lib.tracks.get(id), [id]);
  const { data: lyric } = useLibraryQuery(async (lib) => (track?.lyricId ? lib.lyrics.get(track.lyricId) : null), [track?.lyricId]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [uri, setUri] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const state = usePlayer((s) => (s.activeId === id ? s.state : 'idle'));
  const progress = usePlayer((s) => (s.activeId === id && s.durationMs ? s.positionMs / s.durationMs : 0));

  useEffect(() => {
    if (!track) return;
    setName(track.name);
    setDescription(track.description);
    let live = true;
    assetUri(track.audioAssetId).then((u) => live && setUri(u));
    return () => {
      live = false;
    };
  }, [track]);
  useEffect(() => () => void stop(), []);

  if (!track) {
    return (
      <Screen>
        <Header title="Track" onBack={pop} />
        {!loading && <Empty icon="search" title="Not found" body="This track was deleted." />}
      </Screen>
    );
  }

  const dirty = name.trim() !== track.name || description.trim() !== track.description;

  return (
    <Screen scroll>
      <Header title={track.name} subtitle={`${track.mode === 'AI' ? 'AI' : 'Manual'} · ${formatDuration(track.durationMs)} · ${formatDate(track.createdAt)}`} onBack={pop} />
      <View style={styles.player}>
        <Pressable onPress={() => uri && void toggle(id, uri)} style={styles.vinyl} accessibilityRole="button" accessibilityLabel={state === 'playing' ? 'Pause' : 'Play'}>
          <Icon name={state === 'playing' ? 'pause' : 'play'} size={30} color={color.bg} />
        </Pressable>
        <View style={{ alignSelf: 'stretch' }}>
          <Peaks peaks={track.peaks} progress={progress} height={52} tint={color.cyan} />
        </View>
        <Button label="Stop" icon="stop" disabled={state === 'idle'} onPress={() => void stop()} />
        <Text style={font.caption}>
          {[track.style, track.bpm ? `${track.bpm} BPM` : null, track.key ? `${track.key} ${track.scale ?? ''}` : null].filter(Boolean).join(' · ')}
        </Text>
      </View>

      {lyric ? (
        <View style={styles.lyrics}>
          <Text style={font.label}>Lyrics — {lyric.name}</Text>
          <Text style={[font.body, { color: color.text }]}>{lyric.text}</Text>
        </View>
      ) : null}

      <View style={{ gap: space.lg, marginTop: space.xl }}>
        <Field label="Name" value={name} onChangeText={setName} maxLength={60} />
        <Field label="Description" value={description} onChangeText={setDescription} multiline maxLength={240} />
        <Button
          label="Save changes"
          icon="save"
          disabled={!dirty}
          busy={saving}
          onPress={async () => {
            setSaving(true);
            try {
              const lib = await getLibrary();
              await lib.tracks.update(id, { name: name.trim() || track.name, description: description.trim() });
              notifyLibraryChanged();
              toast('Saved', 'success');
            } finally {
              setSaving(false);
            }
          }}
        />
      </View>

      <View style={{ gap: space.md, marginTop: space.xl }}>
        <Button
          label="Open in Studio"
          kind="primary"
          icon="studio"
          onPress={async () => {
            await stop();
            await openTrackForEditing(track);
            pop();
            setTab('studio');
          }}
        />
        <Button label={lyric ? 'Edit lyrics' : 'Write lyrics'} icon="lyrics" onPress={() => push({ name: 'lyricsEditor', id: lyric?.id, trackId: id })} />
        <Button label="Delete" kind="danger" icon="delete" onPress={() => setConfirm(true)} />
      </View>

      <ConfirmDelete
        visible={confirm}
        what={`“${track.name}”`}
        detail="The track and its audio file are removed. Its sounds and lyrics stay in My Jams."
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          await stop();
          const lib = await getLibrary();
          await lib.tracks.softDelete(id);
          notifyLibraryChanged();
          setConfirm(false);
          toast('Deleted', 'success');
          pop();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  player: { alignItems: 'center', gap: space.lg, padding: space.xl, borderRadius: radius.panel, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  vinyl: { width: 96, height: 96, borderRadius: 48, backgroundColor: color.text, alignItems: 'center', justifyContent: 'center', borderWidth: 8, borderColor: color.violet },
  lyrics: { marginTop: space.xl, padding: space.lg, gap: space.sm, borderRadius: radius.card, backgroundColor: color.surface },
});
