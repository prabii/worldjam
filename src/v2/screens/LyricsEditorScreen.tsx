import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ConfirmDelete } from '../components/ConfirmDelete';
import { toast } from '../components/Toasts';
import { Button, Chip, Field, Header, Screen } from '../components/ui';
import { captureRefs } from '../ai/fallback';
import { generateLyrics, lyricsToPlanHints, lyricsToText, rewriteLyrics, textToLyrics, type RewriteAction } from '../ai/lyricsV2';
import type { PlanLyrics } from '../contracts/musicPlan';
import { useNav } from '../nav/store';
import { currentLlm } from '../services/engineLink';
import { getLibrary, notifyLibraryChanged } from '../services/library';
import { plannerCaptures, setBpm, setDuration, setLyrics, setMode, setPrompt, useStudio } from '../services/studio';
import { color, radius, space } from '../theme';

const ACTIONS: Array<{ id: RewriteAction; label: string }> = [
  { id: 'rewrite', label: 'Rewrite' },
  { id: 'shorten', label: 'Shorten' },
  { id: 'emotional', label: 'More emotional' },
  { id: 'rhyme', label: 'Rhyme' },
  { id: 'language', label: 'Change language' },
];

export function LyricsEditorScreen({ id, trackId, captureIds }: { id?: string; trackId?: string; captureIds?: string[] }) {
  const { pop, setTab } = useNav();
  const [lyricId, setLyricId] = useState<string | null>(id ?? null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [text, setText] = useState('');
  const [theme, setTheme] = useState('');
  const [language, setLanguage] = useState('en');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const lib = await getLibrary();
      if (id) {
        const l = await lib.lyrics.get(id);
        if (l && live) {
          setName(l.name);
          setDescription(l.description);
          setText(l.text);
          setLanguage(l.language);
        }
      } else if (trackId) {
        const t = await lib.tracks.get(trackId);
        if (t && live) setName(`${t.name} lyrics`);
      }
    })();
    return () => {
      live = false;
    };
  }, [id, trackId]);

  const structured = (): PlanLyrics => textToLyrics(text, name || 'Untitled', language);
  const caps = () => (useStudio.getState().session ? plannerCaptures() : []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const onGenerate = () =>
    run('generate', async () => {
      const r = await generateLyrics({ plan: useStudio.getState().preview?.plan ?? null, captures: caps(), theme: theme || name || 'my world', style: useStudio.getState().style, language }, currentLlm());
      setText(lyricsToText(r.lyrics));
      if (!name) setName(r.lyrics.title);
      toast(r.source === 'fallback' ? 'Draft lyrics (offline template)' : 'Lyrics written', 'success');
    });

  const onAction = (a: RewriteAction) =>
    run(a, async () => {
      if (!text.trim()) return toast('Write or generate lyrics first');
      const r = await rewriteLyrics(structured(), a, currentLlm(), { language: a === 'language' ? (language === 'en' ? 'es' : 'en') : language });
      setText(lyricsToText(r.lyrics));
      if (a === 'language') setLanguage(r.lyrics.language);
    });

  const save = async (): Promise<string | null> => {
    if (!text.trim()) {
      toast('Nothing to save');
      return null;
    }
    const lib = await getLibrary();
    const fields = { name: name.trim() || 'Untitled lyrics', description: description.trim(), text, structured: structured(), language, style: useStudio.getState().style };
    let lid = lyricId;
    if (lid) await lib.lyrics.update(lid, fields);
    else {
      const l = await lib.lyrics.create({ ...fields, sourceTrackId: trackId ?? null, sourceCaptureIds: captureIds ?? [] });
      lid = l.id;
      setLyricId(lid);
    }
    if (trackId) await lib.tracks.update(trackId, { lyricId: lid });
    notifyLibraryChanged();
    return lid;
  };

  const makeTrack = () =>
    run('track', async () => {
      if (!text.trim()) return toast('Write or generate lyrics first');
      await save();
      const l = structured();
      const hints = lyricsToPlanHints(l, useStudio.getState().style);
      setLyrics(l);
      setBpm(hints.tempoBpm);
      setDuration(hints.durationSec <= 30 ? 30 : hints.durationSec <= 45 ? 45 : 60);
      setPrompt(`A song for these lyrics: ${l.title}${theme ? ` — ${theme}` : ''}`);
      setMode('AI');
      toast('Lyrics loaded in Studio — tap Generate', 'success');
      pop();
      setTab('studio');
    });

  void captureRefs;
  return (
    <Screen scroll>
      <Header title={lyricId ? 'Edit lyrics' : 'New lyrics'} subtitle="Shown as karaoke — you sing them" onBack={pop} />
      <View style={{ gap: space.lg }}>
        <Field label="Name" value={name} onChangeText={setName} maxLength={60} />
        <Field label="Theme (for AI)" value={theme} onChangeText={setTheme} placeholder="e.g. rainy city nights" />
        <Button label="Generate with AI" kind="primary" icon="ai" busy={busy === 'generate'} disabled={!!busy} onPress={onGenerate} />
        <TextInput value={text} onChangeText={setText} multiline placeholder="Write your lyrics here…" placeholderTextColor={color.textMuted} style={styles.editor} accessibilityLabel="Lyrics text" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {ACTIONS.map((a) => (
            <Chip key={a.id} label={busy === a.id ? '…' : a.label} onPress={() => !busy && void onAction(a.id)} />
          ))}
        </ScrollView>
        <Field label="Description" value={description} onChangeText={setDescription} multiline maxLength={240} />
        <Button label="Save lyrics" icon="save" disabled={!!busy} onPress={() => void run('save', async () => { if (await save()) toast('Lyrics saved', 'success'); })} />
        <Button label="Make a track from these lyrics" icon="studio" busy={busy === 'track'} disabled={!!busy} onPress={makeTrack} />
        {lyricId && <Button label="Delete" kind="danger" icon="delete" onPress={() => setConfirm(true)} />}
      </View>
      <ConfirmDelete
        visible={confirm}
        what="these lyrics"
        detail="Tracks that used them keep their audio."
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          const lib = await getLibrary();
          if (lyricId) await lib.lyrics.softDelete(lyricId);
          if (useStudio.getState().lyrics) setLyrics(null);
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
  editor: { minHeight: 220, padding: space.lg, borderRadius: radius.panel, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, color: color.text, fontSize: 17, lineHeight: 26, textAlignVertical: 'top' },
});
