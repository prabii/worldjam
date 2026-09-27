import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { getGemmaRuntime } from '@/ai/gemma';
import { colors, radius, spacing, type } from '@/theme';
import { gradients } from '@/theme/gradients';

/**
 * The AI guide: a floating button that opens a tutor for the current screen.
 *
 * It opens with the three things worth knowing where the user is standing,
 * then takes free questions, answered by Gemma on the phone. When the model is
 * not loaded the tips still work, so the guide never shows an empty panel.
 */

const TIPS: Record<string, { title: string; steps: string[] }> = {
  home: {
    title: 'Getting started',
    steps: [
      'Tap Scan, point at any object — a mug, a table, your keys.',
      'Hold the red button and hit the object. That real sound becomes an instrument.',
      'Capture 3–4 sounds, then open Studio to turn them into music.',
    ],
  },
  capture: {
    title: 'Capturing a sound',
    steps: [
      'Tap where the object is on screen, then hold the red button.',
      'Hit the object once, firmly, and let it ring before you let go.',
      'Low, dull thuds become kicks; bright clicks become hats. Mix both.',
    ],
  },
  jam: {
    title: 'Making music in Studio',
    steps: [
      'Tap a genre chip — Mass beat, Phonk, Indian classical — to generate instantly.',
      'Or type anything: "sad Bollywood with rain". Your words go to the music model.',
      'Press "Make it a Song" for a two-minute track with an intro, choruses and an ending.',
    ],
  },
  play: {
    title: 'Practising',
    steps: [
      'Rhythm Trainer: tap on the click. Under 25 ms off is PERFECT.',
      'Echo: listen to the pattern, tap it back. It grows every round.',
      'Ear Trainer: learn your kit by ear — it makes jamming faster.',
    ],
  },
  jams: {
    title: 'Your jams',
    steps: [
      'Tap a jam to reopen it in Studio.',
      'Long-press to delete.',
      'Every jam keeps your real recorded sounds.',
    ],
  },
  profile: {
    title: 'Profile',
    steps: [
      'Voice guidance speaks each captured object aloud.',
      'Everything — Gemma and the music model — runs on this phone. Nothing is uploaded.',
    ],
  },
};

/** Answers without the model, for the questions people actually ask first. */
function fallbackAnswer(q: string): string {
  const t = q.toLowerCase();
  if (/genre|phonk|indian|mass|pop|style/.test(t))
    return 'In Studio, tap a genre chip or type a description. The genre goes straight into the prompt for the on-device music model, along with the character of your recorded sounds.';
  if (/record|capture|sound|object/.test(t))
    return 'Tap Scan, tap the object on screen, then hold the red button and hit the object. Let go once it has rung out.';
  if (/song|long|export|share/.test(t))
    return 'Arrange in Studio, then press "Make it a Song". It builds a two-minute track and you can save or share it from the player.';
  if (/game|practice|play/.test(t))
    return 'Open the Play tab. Rhythm Trainer builds timing, Echo builds memory, Ear Trainer teaches you your own sounds.';
  return 'Try asking about capturing sounds, genres, making a song, or the practice games.';
}

interface Props {
  screen: string;
}

export function GuideButton({ screen }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const tips = TIPS[screen] ?? TIPS.home;

  const ask = async () => {
    const question = q.trim();
    if (!question || thinking) return;
    setThinking(true);
    setAnswer(null);
    const rt = getGemmaRuntime();
    try {
      if (!rt || !rt.isReady()) throw new Error('model not ready');
      const prompt = `You are the friendly in-app tutor for WorldJam, a music app. Users record real sounds of everyday objects (mugs, tables, keys) by hitting them, and on-device AI (Gemma plus the Stable Audio music model) turns those sounds into music in any genre — phonk, mass beat, Indian classical, pop, and more. Screens: Home, Capture (hold the red button and hit an object), Studio (genre chips, describe your beat, "Make it a Song"), Play (Rhythm Trainer, Echo, Ear Trainer, Tiles), Profile. The user is on the ${screen} screen.

Answer in at most 3 short sentences, practical and encouraging.

Question: ${question}
Answer:`;
      const out = await Promise.race([
        rt.generate(prompt, 120),
        new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000)),
      ]);
      const text = out.replace(/^\s*answer:\s*/i, '').trim();
      setAnswer(text || fallbackAnswer(question));
    } catch {
      setAnswer(fallbackAnswer(question));
    } finally {
      setThinking(false);
    }
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.fab}
        accessibilityRole="button"
        accessibilityLabel="Open the AI guide"
      >
        <LinearGradient
          colors={['#BF5AF2', '#5E5CE6']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fabInner}
        >
          <Text style={styles.fabGlyph}>?</Text>
        </LinearGradient>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>✦ AI Guide</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={12}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.body} contentContainerStyle={{ gap: spacing.md }}>
              <Text style={styles.tipTitle}>{tips.title}</Text>
              {tips.steps.map((s, i) => (
                <View key={i} style={styles.step}>
                  <View style={styles.stepNum}>
                    <Text style={styles.stepNumText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{s}</Text>
                </View>
              ))}

              {(thinking || answer) && (
                <View style={styles.answer}>
                  {thinking ? (
                    <View style={styles.thinking}>
                      <ActivityIndicator color={colors.ai} size="small" />
                      <Text style={styles.answerText}>Gemma is thinking…</Text>
                    </View>
                  ) : (
                    <Text style={styles.answerText}>{answer}</Text>
                  )}
                </View>
              )}
            </ScrollView>

            <View style={styles.askRow}>
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Ask anything — how do I make phonk?"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                onSubmitEditing={ask}
                returnKeyType="send"
              />
              <Pressable onPress={ask} style={styles.send} disabled={thinking}>
                <LinearGradient
                  colors={gradients.brand}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.sendInner}
                >
                  <Text style={styles.sendText}>Ask</Text>
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: 112,
    zIndex: 50,
    elevation: 12,
  },
  fabInner: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  fabGlyph: { fontSize: 24, fontWeight: '800', color: '#FFFFFF' },

  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '75%',
    backgroundColor: '#111116',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { ...type.title, fontSize: 20, color: colors.ai },
  close: { fontSize: 18, color: colors.textDim },
  body: { flexGrow: 0 },
  tipTitle: { ...type.label, fontSize: 15, color: colors.text },
  step: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(191,90,242,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { ...type.caption, fontWeight: '800', color: colors.ai },
  stepText: { ...type.body, flex: 1, color: colors.textDim, lineHeight: 21 },
  answer: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(191,90,242,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(191,90,242,0.35)',
  },
  thinking: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  answerText: { ...type.body, color: colors.text, lineHeight: 21 },
  askRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  input: {
    flex: 1,
    height: 46,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    ...type.body,
    color: colors.text,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  send: {},
  sendInner: { paddingHorizontal: spacing.lg, height: 46, borderRadius: radius.pill, justifyContent: 'center' },
  sendText: { ...type.label, color: '#FFFFFF' },
});
