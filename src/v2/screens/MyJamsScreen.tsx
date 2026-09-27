import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Capture, CaptureType, Lyric, SortOrder, Track, TrackMode } from '../contracts/library';
import { CaptureCard, LyricCard, TrackCard } from '../components/cards';
import { Icon } from '../components/Icon';
import { ConfirmDelete } from '../components/ConfirmDelete';
import { toast } from '../components/Toasts';
import { Button, Chip, Empty, IconButton, Segmented, Sheet } from '../components/ui';
import { useNav } from '../nav/store';
import { deleteCapture } from '../services/capture';
import { getLibrary, notifyLibraryChanged, useLibraryQuery } from '../services/library';
import { stop as stopPlayer } from '../services/player';
import { removeSource, setLyrics, useStudio } from '../services/studio';
import { color, font, radius, space } from '../theme';

type Section = 'captures' | 'tracks' | 'lyrics';
const PAGE = 40;

const SORTS: Array<{ value: SortOrder; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name_asc', label: 'Name A–Z' },
  { value: 'name_desc', label: 'Name Z–A' },
];

const CAPTURE_FILTERS: Array<{ label: string; types: CaptureType[] | null }> = [
  { label: 'All', types: null },
  { label: 'Sounds', types: ['AUDIO'] },
  { label: 'Videos', types: ['VIDEO'] },
  { label: 'Voice', types: ['HUM', 'VOCAL'] },
];

const TRACK_FILTERS: Array<{ label: string; modes: TrackMode[] | null }> = [
  { label: 'All', modes: null },
  { label: 'AI', modes: ['AI'] },
  { label: 'Manual', modes: ['MANUAL'] },
];

export function MyJamsScreen({ bottomInset }: { bottomInset: number }) {
  const insets = useSafeAreaInsets();
  const { push } = useNav();
  const [section, setSection] = useState<Section>('captures');
  const [doomed, setDoomed] = useState<{ kind: Section; id: string; name: string } | null>(null);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');
  const [sortOpen, setSortOpen] = useState(false);
  const [captureFilter, setCaptureFilter] = useState(0);
  const [trackFilter, setTrackFilter] = useState(0);
  const [limit, setLimit] = useState(PAGE);

  // Debounce typing so each keystroke is not a query.
  useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => setLimit(PAGE), [section, search, sort, captureFilter, trackFilter]);

  const { data, loading, error } = useLibraryQuery<{ section: Section; items: Array<Capture | Track | Lyric>; total: number }>(
    async (lib) => {
      if (section === 'captures') {
        const q = { search, sort, types: CAPTURE_FILTERS[captureFilter].types ?? undefined };
        return { section: 'captures', items: await lib.captures.list({ ...q, limit }), total: await lib.captures.count(q) };
      }
      if (section === 'tracks') {
        const q = { search, sort, modes: TRACK_FILTERS[trackFilter].modes ?? undefined };
        return { section: 'tracks', items: await lib.tracks.list({ ...q, limit }), total: await lib.tracks.count(q) };
      }
      const q = { search, sort };
      return { section: 'lyrics', items: await lib.lyrics.list({ ...q, limit }), total: await lib.lyrics.count(q) };
    },
    [section, search, sort, captureFilter, trackFilter, limit],
  );

  // Right after a tab switch the previous tab's rows are still in `data`: never render them with the new tab's card.
  const items = data && data.section === section ? data.items : [];
  const header = useMemo(
    () => (
      <View style={{ gap: space.md, paddingBottom: space.md }}>
        <Text style={font.title} accessibilityRole="header">
          My Jams
        </Text>
        <Segmented<Section>
          value={section}
          onChange={setSection}
          options={[
            { value: 'captures', label: 'Captures', icon: 'mic' },
            { value: 'tracks', label: 'Tracks', icon: 'waveform' },
            { value: 'lyrics', label: 'Lyrics', icon: 'lyrics' },
          ]}
        />
        <View style={styles.searchRow}>
          <View style={styles.search}>
            <Icon name="search" size={18} color={color.textMuted} />
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={
                section === 'captures'
                  ? 'Search names and descriptions'
                  : section === 'tracks'
                    ? 'Search tracks, sounds, lyrics, styles'
                    : 'Search lyrics, tracks, sounds'
              }
              placeholderTextColor={color.textMuted}
              style={styles.searchInput}
              accessibilityLabel="Search My Jams"
              returnKeyType="search"
            />
            {text ? (
              <Pressable onPress={() => setText('')} accessibilityLabel="Clear search" hitSlop={8}>
                <Icon name="close" size={18} color={color.textMuted} />
              </Pressable>
            ) : null}
          </View>
          <Pressable onPress={() => setSortOpen(true)} style={styles.sortBtn} accessibilityRole="button" accessibilityLabel={`Sort: ${SORTS.find((s) => s.value === sort)?.label}`}>
            <Icon name="sort" size={20} color={color.text} />
          </Pressable>
        </View>
        {section !== 'lyrics' && (
          <View style={styles.chips}>
            {(section === 'captures' ? CAPTURE_FILTERS : TRACK_FILTERS).map((f, i) => (
              <Chip
                key={f.label}
                label={f.label}
                selected={(section === 'captures' ? captureFilter : trackFilter) === i}
                onPress={() => (section === 'captures' ? setCaptureFilter(i) : setTrackFilter(i))}
              />
            ))}
          </View>
        )}
        <Text style={font.caption}>
          {(loading && !data) || data?.section !== section ? 'Loading…' : `${data?.total ?? 0} ${section}${search ? ` matching “${search}”` : ''} · ${SORTS.find((s) => s.value === sort)?.label}`}
        </Text>
        {error ? <Text style={[font.label, { color: color.error }]}>{error}</Text> : null}
      </View>
    ),
    [section, text, sort, captureFilter, trackFilter, loading, data, search, error],
  );

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, paddingBottom: bottomInset + insets.bottom + space.xxl }}
        ListHeaderComponent={header}
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (data && items.length < data.total) setLimit((l) => l + PAGE);
        }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <View style={styles.itemRow}>
            <View style={{ flex: 1 }}>
              {section === 'captures' ? (
                <CaptureCard capture={item as Capture} onOpen={() => push({ name: 'captureDetail', id: item.id })} />
              ) : section === 'tracks' ? (
                <TrackCard track={item as Track} onOpen={() => push({ name: 'trackDetail', id: item.id })} />
              ) : (
                <LyricCard lyric={item as Lyric} onOpen={() => push({ name: 'lyricsEditor', id: item.id })} />
              )}
            </View>
            <IconButton icon="delete" label={`Delete ${item.name}`} tint={color.error} onPress={() => setDoomed({ kind: section, id: item.id, name: item.name })} />
          </View>
        )}
        ListEmptyComponent={
          loading ? null : search ? (
            <Empty icon="search" title="No matches" body={`Nothing in ${section} matches “${search}”.`} />
          ) : section === 'captures' ? (
            <Empty
              icon="capture"
              title="No captures yet"
              body="Record a sound, a video or your voice — it lands here."
              action={<Button label="Capture" kind="primary" icon="capture" onPress={() => push({ name: 'capture' })} />}
            />
          ) : section === 'tracks' ? (
            <Empty icon="waveform" title="No tracks yet" body="Make one in Studio, by hand or with AI." />
          ) : (
            <Empty
              icon="lyrics"
              title="No lyrics yet"
              body="Write your own or let the AI draft some."
              action={<Button label="Write lyrics" icon="edit" onPress={() => push({ name: 'lyricsEditor' })} />}
            />
          )
        }
      />
      <ConfirmDelete
        visible={!!doomed}
        what={doomed ? `“${doomed.name}”` : ''}
        detail={
          doomed?.kind === 'captures'
            ? 'It disappears from My Jams and any Studio session. Tracks already made with it keep their audio.'
            : doomed?.kind === 'tracks'
              ? 'The track and its audio are removed. Its sounds and lyrics stay.'
              : 'Tracks that used these lyrics keep their audio.'
        }
        onCancel={() => setDoomed(null)}
        onConfirm={async () => {
          if (!doomed) return;
          try {
            await stopPlayer();
            const lib = await getLibrary();
            if (doomed.kind === 'captures') {
              await deleteCapture(doomed.id);
              if (useStudio.getState().session?.sources.some((x) => x.captureId === doomed.id)) await removeSource(doomed.id);
            } else if (doomed.kind === 'tracks') {
              await lib.tracks.softDelete(doomed.id);
            } else {
              await lib.lyrics.softDelete(doomed.id);
              if (useStudio.getState().lyricId === doomed.id) setLyrics(null);
            }
            notifyLibraryChanged();
            toast('Deleted', 'success');
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not delete', 'error');
          } finally {
            setDoomed(null);
          }
        }}
      />
      <Sheet visible={sortOpen} onClose={() => setSortOpen(false)} title="Sort by">
        <View style={{ gap: space.sm }}>
          {SORTS.map((s) => (
            <Pressable
              key={s.value}
              onPress={() => {
                setSort(s.value);
                setSortOpen(false);
              }}
              style={styles.sortRow}
              accessibilityRole="radio"
              accessibilityState={{ checked: sort === s.value }}
            >
              <Text style={[font.body, sort === s.value && { color: color.text, fontWeight: '600' }]}>{s.label}</Text>
              {sort === s.value && <Icon name="check" size={20} color={color.cyan} />}
            </Pressable>
          ))}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  searchRow: { flexDirection: 'row', gap: space.sm },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.round,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
  },
  searchInput: { flex: 1, color: color.text, fontSize: 15, paddingVertical: 0 },
  sortBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sortRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
