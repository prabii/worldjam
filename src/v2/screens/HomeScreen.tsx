import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { CaptureCard, TrackCard } from '../components/cards';
import { Icon, type IconName } from '../components/Icon';
import { Screen, SectionTitle } from '../components/ui';
import { useNav } from '../nav/store';
import { useLibraryQuery } from '../services/library';
import { color, font, radius, space } from '../theme';

const LOGO = require('../../../assets/branding/adaptive-foreground.png');

export function HomeScreen({ bottomInset }: { bottomInset: number }) {
  const { push, setTab } = useNav();
  const { data } = useLibraryQuery(
    async (lib) => ({
      profile: await lib.profile.get(),
      captures: await lib.captures.list({ sort: 'newest', limit: 3 }),
      tracks: await lib.tracks.list({ sort: 'newest', limit: 3 }),
      counts: { captures: await lib.captures.count(), tracks: await lib.tracks.count(), lyrics: await lib.lyrics.count() },
    }),
    [],
  );
  const name = data?.profile?.name ?? '';

  return (
    <Screen scroll bottomInset={bottomInset}>
      <View style={styles.hero}>
        <View style={{ flex: 1, gap: space.sm }}>
          <Text style={font.caption}>{name ? `Hi, ${name}` : 'WorldJam'}</Text>
          <Text style={font.display}>Make music from your world.</Text>
        </View>
        <Image source={LOGO} style={styles.logo} accessibilityIgnoresInvertColors />
      </View>

      <View style={styles.actions}>
        <Action icon="capture" title="Capture" body="Record a sound, a video or your voice" onPress={() => push({ name: 'capture' })} />
        <Action icon="studio" title="Open Studio" body="Shape your sounds by hand or with AI" onPress={() => setTab('studio')} />
      </View>

      {data && (
        <Text style={[font.caption, { marginTop: space.lg }]}>
          {data.counts.captures} captures · {data.counts.tracks} tracks · {data.counts.lyrics} lyrics
        </Text>
      )}

      <SectionTitle
        title="Recent captures"
        action={data?.captures.length ? <SeeAll onPress={() => setTab('jams')} /> : undefined}
      />
      {data?.captures.length ? (
        <View style={{ gap: space.md }}>
          {data.captures.map((c) => (
            <CaptureCard key={c.id} capture={c} onOpen={() => push({ name: 'captureDetail', id: c.id })} />
          ))}
        </View>
      ) : (
        <Text style={font.body}>Nothing yet. Tap the ring below and record the first sound around you.</Text>
      )}

      {data?.tracks.length ? (
        <>
          <SectionTitle title="Recent tracks" action={<SeeAll onPress={() => setTab('jams')} />} />
          <View style={{ gap: space.md }}>
            {data.tracks.map((t) => (
              <TrackCard key={t.id} track={t} onOpen={() => push({ name: 'trackDetail', id: t.id })} />
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function Action({ icon, title, body, onPress }: { icon: IconName; title: string; body: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={title} accessibilityHint={body}>
      <View style={styles.actionIcon}>
        <Icon name={icon} size={24} color={color.text} />
      </View>
      <Text style={font.heading}>{title}</Text>
      <Text style={font.caption}>{body}</Text>
    </Pressable>
  );
}

function SeeAll({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8}>
      <Text style={[font.label, { color: color.cyan }]}>See all</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginTop: space.lg },
  logo: { width: 72, height: 72 },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.xl },
  action: {
    flex: 1,
    minHeight: 140,
    padding: space.lg,
    gap: space.sm,
    borderRadius: radius.panel,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
});
