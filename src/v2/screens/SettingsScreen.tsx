import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system';

import { describeStatus, getModelStatus, subscribeModelStatus } from '@/ai/modelLoader';

import { Button, Field, Screen, SectionTitle } from '../components/ui';
import { toast } from '../components/Toasts';
import { Icon } from '../components/Icon';
import { useNav } from '../nav/store';
import { getLibrary, notifyLibraryChanged, useLibraryQuery } from '../services/library';
import { PACKS, downloadPack, packSizeGb, pauseDownload, refreshModelStatus, useModels, type ModelPack } from '../services/models';
import { color, font, radius, space } from '../theme';

export function SettingsScreen({ bottomInset }: { bottomInset: number }) {
  const { push } = useNav();
  const { data: profile } = useLibraryQuery((lib) => lib.profile.get(), []);
  const [name, setName] = useState('');
  const [free, setFree] = useState<number | null>(null);
  const [director, setDirector] = useState(describeStatus(getModelStatus()));

  useEffect(() => {
    if (profile?.name) setName(profile.name);
  }, [profile?.name]);
  useEffect(() => {
    void refreshModelStatus();
    FileSystem.getFreeDiskStorageAsync().then(setFree).catch(() => {});
    return subscribeModelStatus((s) => setDirector(describeStatus(s)));
  }, []);

  const saveName = async () => {
    const clean = name.trim();
    if (!clean) return;
    const lib = await getLibrary();
    await lib.profile.setName(clean);
    notifyLibraryChanged();
    toast('Name saved', 'success');
  };

  return (
    <Screen scroll bottomInset={bottomInset}>
      <Text style={font.title} accessibilityRole="header">
        Profile
      </Text>

      <SectionTitle title="You" />
      <View style={styles.row}>
        <Field label="Name" value={name} onChangeText={setName} style={{ flex: 1 }} maxLength={40} />
      </View>
      <Button label="Save name" onPress={saveName} disabled={!name.trim() || name.trim() === profile?.name} style={{ marginTop: space.md }} />

      <SectionTitle title="Games" />
      <Text style={[font.body, { marginBottom: space.md }]}>Play with the sounds you recorded — the better you know your kit, the faster you play in Studio.</Text>
      <GameCard title="Tiles" body="Tiles fall down three lanes in time with your beat. Tap each lane as its tile lands." onPress={() => push({ name: 'tiles' })} />
      <GameCard title="Echo" body="A memory game: hear a pattern of your sounds, tap it back. One hit longer every round." onPress={() => push({ name: 'echo' })} />

      <SectionTitle title="On-device AI" />
      <Text style={[font.body, { marginBottom: space.md }]}>
        Everything runs on this phone. Models download once over Wi-Fi; capture, My Jams and the manual studio work without them.
      </Text>
      <View style={{ gap: space.md }}>
        {PACKS.map((p) => (
          <PackRow key={p.id} pack={p} />
        ))}
      </View>
      <Text style={[font.caption, { marginTop: space.md }]}>Music director: {director}</Text>

      <SectionTitle title="Storage" />
      <Text style={font.body}>{free != null ? `${(free / 1e9).toFixed(1)} GB free on this phone` : 'Checking…'}</Text>

      <SectionTitle title="About" />
      <Text style={font.body}>WorldJam 2.0 — capture your world, shape the sound, make the jam.</Text>
      <Text style={[font.caption, { marginTop: space.sm }]}>
        Team PRXFR · iQOO City Battles 2026 · Gemma 4 · ACE-Step 1.5 · Stable Audio Open Small
      </Text>
    </Screen>
  );
}

function PackRow({ pack }: { pack: ModelPack }) {
  const status = useModels((s) => s[pack.id]);
  const busy = status.state === 'downloading' || status.state === 'verifying';
  const pct = status.state === 'downloading' ? status.received / Math.max(1, status.total) : 0;
  return (
    <View style={styles.pack}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={font.heading}>{pack.title}</Text>
        <Text style={font.label}>{pack.body}</Text>
        <Text style={[font.mono, status.state === 'error' && { color: color.error }]}>
          {status.state === 'installed'
            ? 'Installed'
            : status.state === 'checking'
              ? 'Checking…'
              : status.state === 'downloading'
                ? `Downloading ${Math.round(pct * 100)}% · ${(status.received / 1e9).toFixed(2)} of ${(status.total / 1e9).toFixed(1)} GB`
                : status.state === 'verifying'
                  ? 'Verifying…'
                  : status.state === 'error'
                    ? status.message
                    : `${packSizeGb(pack)} GB download`}
        </Text>
        {status.state === 'downloading' && (
          <View style={styles.bar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}>
            <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
          </View>
        )}
      </View>
      {status.state !== 'installed' && status.state !== 'checking' && (
        <Button
          label={status.state === 'downloading' ? 'Pause' : status.state === 'error' ? 'Retry' : 'Get'}
          kind={status.state === 'downloading' ? 'secondary' : 'primary'}
          busy={status.state === 'verifying'}
          onPress={() => (status.state === 'downloading' ? void pauseDownload(pack.id) : void downloadPack(pack.id))}
          disabled={busy && status.state !== 'downloading'}
          style={{ minWidth: 92 }}
        />
      )}
    </View>
  );
}

function GameCard({ title, body, onPress }: { title: string; body: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.game, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`Play ${title}`}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={font.heading}>{title}</Text>
        <Text style={font.label}>{body}</Text>
      </View>
      <Icon name="play" size={22} color={color.cyan} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  game: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, marginBottom: space.md, borderRadius: radius.panel, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-end' },
  pack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.panel,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
  },
  bar: { height: 4, borderRadius: 2, backgroundColor: color.elevated, overflow: 'hidden', marginTop: 4 },
  barFill: { height: 4, backgroundColor: color.cyan },
});
