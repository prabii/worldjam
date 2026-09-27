import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Audio } from 'expo-av';
import { colors, radius, spacing, type } from '@/theme';

/**
 * Examples of what the on-device music model makes.
 *
 * Each clip was generated on the phone by Stable Audio 3 Small-Music from the
 * prompt shown, in roughly the time it takes to play. They exist so a
 * listener can hear the range before recording anything — the same model
 * builds the bed under their own objects.
 */
const SAMPLES = [
  {
    id: 'phonk',
    name: 'Phonk',
    prompt: 'drift phonk · 808 · cowbell',
    color: '#FF453A',
    src: require('../../assets/samples/phonk.wav'),
  },
  {
    id: 'mass',
    name: 'Mass beat',
    prompt: 'dappankuthu · thappu · nadaswaram',
    color: '#FF9F0A',
    src: require('../../assets/samples/mass_beat.wav'),
  },
  {
    id: 'indian',
    name: 'Indian classical',
    prompt: 'sitar · tabla · tanpura',
    color: '#FFD60A',
    src: require('../../assets/samples/indian_classical.wav'),
  },
  {
    id: 'bolly',
    name: 'Bollywood pop',
    prompt: 'strings · tabla · harmonium',
    color: '#BF5AF2',
    src: require('../../assets/samples/bollywood_pop.wav'),
  },
  {
    id: 'pop',
    name: 'Pop',
    prompt: 'punchy synths · catchy hook',
    color: '#0A84FF',
    src: require('../../assets/samples/pop.wav'),
  },
  {
    id: 'lofi',
    name: 'Lo-fi',
    prompt: 'dusty Rhodes · vinyl',
    color: '#30D158',
    src: require('../../assets/samples/lofi.wav'),
  },
];

export function SampleGallery() {
  const [playing, setPlaying] = useState<string | null>(null);
  const sound = useRef<Audio.Sound | null>(null);

  useEffect(
    () => () => {
      void sound.current?.unloadAsync();
    },
    [],
  );

  const toggle = async (s: (typeof SAMPLES)[number]) => {
    const wasPlaying = playing === s.id;
    await sound.current?.unloadAsync().catch(() => {});
    sound.current = null;
    setPlaying(null);
    if (wasPlaying) return;

    const { sound: snd } = await Audio.Sound.createAsync(s.src, { shouldPlay: true });
    sound.current = snd;
    setPlaying(s.id);
    snd.setOnPlaybackStatusUpdate((st) => {
      if (st.isLoaded && st.didJustFinish) setPlaying(null);
    });
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title}>Made on this phone</Text>
        <Text style={styles.sub}>Stable Audio 3 · 30 s each · tap to hear</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {SAMPLES.map((s) => {
          const on = playing === s.id;
          return (
            <Pressable
              key={s.id}
              onPress={() => void toggle(s)}
              accessibilityRole="button"
              accessibilityLabel={`${on ? 'Stop' : 'Play'} ${s.name} example`}
              style={[styles.card, { borderColor: on ? s.color : colors.border }]}
            >
              <View style={[styles.play, { backgroundColor: on ? s.color : `${s.color}33` }]}>
                <Text style={styles.playGlyph}>{on ? '■' : '▶'}</Text>
              </View>
              <Text style={styles.name}>{s.name}</Text>
              <Text style={styles.prompt} numberOfLines={2}>
                {s.prompt}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  head: { gap: 2 },
  title: { ...type.title, fontSize: 19, color: colors.text },
  sub: { ...type.caption, color: colors.textDim },
  row: { gap: spacing.sm, paddingVertical: spacing.xs },
  card: {
    width: 128,
    padding: spacing.md,
    gap: 6,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    backgroundColor: colors.surfaceSolid,
  },
  play: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyph: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  name: { ...type.label, fontSize: 13, color: colors.text },
  prompt: { ...type.caption, fontSize: 10, color: colors.textDim, lineHeight: 13 },
});
