import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CaptureCard } from '../components/cards';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toasts';
import { Button, Empty, Header } from '../components/ui';
import type { Capture } from '../contracts/library';
import { useNav } from '../nav/store';
import { useLibraryQuery } from '../services/library';
import { stop } from '../services/player';
import { addSources, useStudio } from '../services/studio';
import { color, font, radius, space } from '../theme';

/**
 * Pick sounds from My Jams for the Studio session. Every row previews its
 * audio (a video capture contributes its sound here — no video in Studio).
 */
export function SourcePickerScreen({ sessionId }: { sessionId: string }) {
  const insets = useSafeAreaInsets();
  const { pop, push } = useNav();
  const inSession = useStudio((s) => new Set(s.session?.sources.map((x) => x.captureId) ?? []));
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => () => void stop(), []);

  const { data } = useLibraryQuery((lib) => lib.captures.list({ search, sort: 'newest', limit: 300 }), [search]);
  const items = (data ?? []).filter((c) => !inSession.has(c.id));

  const toggle = (c: Capture) => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]));

  const add = async () => {
    setBusy(true);
    try {
      await addSources(picked);
      toast(`${picked.length} sound${picked.length === 1 ? '' : 's'} added`, 'success');
      await stop();
      pop();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.md }]}>
      <View style={{ paddingHorizontal: space.lg }}>
        <Header title="Add sounds" subtitle="Tap to select · play to preview" onBack={pop} />
        <View style={styles.search}>
          <Icon name="search" size={18} color={color.textMuted} />
          <TextInput value={text} onChangeText={setText} placeholder="Search your captures" placeholderTextColor={color.textMuted} style={styles.input} accessibilityLabel="Search captures" />
        </View>
        <Button label="Capture a new sound" icon="capture" onPress={() => push({ name: 'capture', sessionId })} style={{ marginTop: space.md }} />
      </View>
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: space.lg, paddingBottom: 140 + insets.bottom, gap: space.md }}
        renderItem={({ item }) => {
          const on = picked.includes(item.id);
          return (
            <Pressable onPress={() => toggle(item)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`Select ${item.name}`} style={[styles.row, on && styles.rowOn]}>
              <View style={[styles.check, on && styles.checkOn]}>{on && <Icon name="check" size={16} color={color.bg} />}</View>
              <View style={{ flex: 1 }}>
                <CaptureCard capture={item} playVideoInline={false} />
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={<Empty icon="capture" title={search ? 'No matches' : 'Nothing to add'} body={search ? undefined : 'Capture a sound first, or everything is already in this session.'} />}
      />
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.lg }]}>
        <Text style={font.label}>{picked.length} selected</Text>
        <Button label={picked.length ? `Add ${picked.length}` : 'Add'} kind="primary" icon="add" onPress={add} disabled={picked.length === 0} busy={busy} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, paddingHorizontal: space.md, borderRadius: radius.round, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  input: { flex: 1, color: color.text, fontSize: 15, paddingVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.panel },
  rowOn: { opacity: 1 },
  check: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: color.line, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: color.cyan, borderColor: color.cyan },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingHorizontal: space.lg, paddingTop: space.md, backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.line },
});
